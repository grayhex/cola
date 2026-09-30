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
    calls = [];
  return {
    users,
    channels,
    calls,
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
    async getTask() {
      return { status: "completed" };
    },
    channel(type, id, data) {
      return {
        create: async () => {
          channels.set(type + ":" + id, data);
          return {};
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
