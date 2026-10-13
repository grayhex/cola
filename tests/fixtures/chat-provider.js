import { createHmac } from "node:crypto";
// Deterministic vendor double. Test-only Node preload; never copied to images.
// Native Stream JWT creation is retained. No production flag or test URL exists.
import { StreamChat } from "stream-chat";
import { createRequire } from "node:module";
import {
  CHAT_ROLE,
  CHAT_MEMBER_ROLE,
  chatMemberGrants,
  chatUploads,
} from "../../lib/chat-config.ts";
export const policy = () => ({
  app: {
    disable_auth_checks: false,
    disable_permissions_checks: false,
    grants: { [CHAT_ROLE]: [], [CHAT_MEMBER_ROLE]: [] },
    file_upload_config: structuredClone(chatUploads),
    image_upload_config: structuredClone(chatUploads),
  },
  type: {
    grants: {
      [CHAT_ROLE]: [],
      [CHAT_MEMBER_ROLE]: [...chatMemberGrants],
      user: [],
      guest: [],
      anonymous: [],
      channel_member: [],
      channel_moderator: [],
    },
    commands: [],
    url_enrichment: false,
    max_message_length: 4000,
    read_events: true,
    typing_events: true,
    reactions: true,
    replies: true,
    uploads: true,
    polls: false,
    shared_locations: false,
  },
});
export function fixtureMethods() {
  const users = new Map(),
    channels = new Map(),
    calls = [],
    revoked = new Map(),
    messages = new Map();
  return {
    users,
    channels,
    calls,
    messages,
    getAppSettings: async () => ({ app: policy().app }),
    getChannelType: async () => policy().type,
    async upsertUsers(list) {
      for (const user of list) {
        if (user.name.startsWith("vendor-failure"))
          throw new Error(
            "vendor secret=do-not-leak headers authorization=do-not-leak",
          );
        users.set(user.id, { ...users.get(user.id), ...user });
      }
      return { users: Object.fromEntries(users) };
    },
    async upsertUser(user) {
      return this.upsertUsers([user]);
    },
    async queryUsers({ id }) {
      return { users: users.has(id) ? [users.get(id)] : [] };
    },
    async revokeUserToken(id, time) {
      calls.push(["revoke", id, time]);
      revoked.set(id, new Date(time || Date.now()).getTime());
    },
    async deactivateUser(id) {
      calls.push(["deactivate", id]);
      if (users.has(id))
        users.get(id).deactivated_at = new Date().toISOString();
    },
    async reactivateUser(id) {
      calls.push(["reactivate", id]);
      delete users.get(id).deactivated_at;
    },
    async deleteUser(id, options) {
      calls.push(["delete", id, options]);
      users.delete(id);
      return {};
    },
    async blockUser(blockedId, byId) {
      calls.push(["block", blockedId, byId]);
      return {};
    },
    async unBlockUser(blockedId, byId) {
      calls.push(["unblock", blockedId, byId]);
      return {};
    },
    async getTask() {
      return { status: "completed" };
    },
    channel(type, id, data) {
      const cid = type + ":" + id;
      const current = () => channels.get(cid);
      return {
        cid,
        create: async () => {
          if (!channels.has(cid))
            channels.set(cid, { members: [], ...structuredClone(data) });
          return { channel: current() };
        },
        queryMembers: async (filter = {}, sort = {}, options = {}) => {
          const sorted = (current()?.members || [])
            .filter(
              (m) => !options.user_id_gt || m.user_id > options.user_id_gt,
            )
            .sort(
              (a, b) =>
                (sort.user_id === -1 ? -1 : 1) *
                a.user_id.localeCompare(b.user_id),
            );
          const matching = filter.id
            ? sorted.filter(
                (m) => m.user_id === filter.id || m.user_id === filter.id.$eq,
              )
            : sorted;
          return {
            members: matching.slice(
              options.offset || 0,
              (options.offset || 0) + (options.limit || 100),
            ),
          };
        },
        removeMembers: async (ids) => {
          calls.push(["removeMembers", cid, ids]);
          current().members = current().members.filter(
            (m) => !ids.includes(m.user_id),
          );
          return {};
        },
        addMembers: async (list) => {
          calls.push(["addMembers", cid, list]);
          for (const m of list) {
            const uid = typeof m === "string" ? m : m.user_id;
            if (!current().members.some((p) => p.user_id === uid))
              current().members.push(
                typeof m === "string" ? { user_id: m } : structuredClone(m),
              );
          }
          return {};
        },
        updateMemberPartial: async (update, options) => {
          calls.push(["memberRole", cid, options.userId, update]);
          const m = current().members.find((p) => p.user_id === options.userId);
          if (!m) throw new Error("Member missing");
          Object.assign(m, update.set);
          return { channel_member: m };
        },
        updatePartial: async (update) => {
          Object.assign(current(), update.set);
          return { channel: current() };
        },
      };
    },
    async queryChannels(filter, sort, options = {}) {
      const me = filter.members?.$in?.[0] || options.user_id;
      const list = [...channels].filter(
        ([cid, data]) =>
          (!filter.cid || cid === filter.cid) &&
          (!me || data.members.some((m) => m.user_id === me)),
      );
      return list.slice(0, options.limit || 20).map(([cid, data]) => ({
        cid,
        data,
        state: {
          members: Object.fromEntries(data.members.map((m) => [m.user_id, m])),
          read: {},
        },
        queryMembers: (filter, sort, options) =>
          this.channel(...cid.split(":")).queryMembers(filter, sort, options),
        removeMembers: (ids) =>
          this.channel(...cid.split(":")).removeMembers(ids),
      }));
    },
    async getMessage(id) {
      if (!messages.has(id)) throw new Error("Message missing");
      return { message: messages.get(id) };
    },
    async deleteMessage(id) {
      calls.push(["deleteMessage", id]);
      messages.delete(id);
      return {};
    },
    asClient(token) {
      // This is a test-only vendor policy simulator, not a claim of live Stream.
      const parts = token.split(".");
      if (
        parts.length !== 3 ||
        createHmac("sha256", "test-secret")
          .update(parts[0] + "." + parts[1])
          .digest("base64url") !== parts[2]
      )
        throw new Error("Provider authentication denied");
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
      const uid = claims.user_id;
      const read = (cid) => {
        const data = channels.get(cid),
          u = users.get(uid),
          m = data?.members.find((p) => p.user_id === uid);
        if (
          !u ||
          u.deactivated_at ||
          claims.iat * 1000 <= (revoked.get(uid) || 0) ||
          claims.exp * 1000 <= Date.now() ||
          !m ||
          m.banned ||
          m.channel_role !== "colabike_member"
        )
          throw new Error("Provider read denied");
        return data;
      };
      return {
        channel: (type, id) => ({
          watch: async () => ({
            channel: structuredClone(read(type + ":" + id)),
          }),
          query: async () => ({
            channel: structuredClone(read(type + ":" + id)),
            messages: [...messages.values()].filter(
              (m) => m.cid === type + ":" + id,
            ),
          }),
          sendMessage: async (body) => {
            const cid = type + ":" + id;
            if (read(cid).frozen) throw new Error("Provider frozen");
            const message = {
              ...body,
              id: "fixture-" + messages.size,
              cid,
              user: { id: uid },
              created_at: new Date().toISOString(),
            };
            messages.set(message.id, message);
            return { message };
          },
        }),
        queryChannels: async (filter) => {
          read(filter.cid);
          return [structuredClone(channels.get(filter.cid))];
        },
      };
    },
    async getUnreadCount() {
      return { total_unread_count: 2 };
    },
    async exportUser(id) {
      return { user: users.get(id), messages: [], reactions: [] };
    },
  };
}
export function fixtureProvider() {
  return Object.assign(
    new StreamChat("test-key", "test-secret", { logger: () => {} }),
    fixtureMethods(),
  );
}
if (process.env.COLA_CHAT_FIXTURE === "1") {
  if (
    process.env.DEPLOYMENT_MODE === "production" ||
    process.env.APP_ORIGIN !== "http://localhost:3100"
  )
    throw new Error("Disposable localhost test process required");
  const methods = fixtureMethods();
  const require = createRequire(import.meta.url);
  for (const cls of new Set([StreamChat, require("stream-chat").StreamChat])) {
    for (const [key, value] of Object.entries(methods))
      if (typeof value === "function") cls.prototype[key] = value;
  }
}
