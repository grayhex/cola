// Browser protocol fixture for the real, bundled Stream React/JS SDK. This is
// deliberately not evidence that a live vendor app has the required permissions.
import { randomUUID } from "node:crypto";
import { policy } from "./chat-provider.js";
export function chatBrowserFixture(users) {
  const profiles = users.map((u) => ({
    id: "cola_" + u.id.replaceAll("-", ""),
    name: u.name,
    role: "colabike_user",
    online: true,
    created_at: new Date().toISOString(),
  }));
  const channels = new Map(),
    sockets = new Map(),
    reads = [],
    events = [],
    unexpected = [];
  const now = () => new Date().toISOString();
  function emit(event, ids = profiles.map((u) => u.id)) {
    for (const id of ids)
      sockets.get(id)?.send(JSON.stringify({ created_at: now(), ...event }));
  }
  function state(channel) {
    return {
      channel,
      members: channel.members,
      messages: channel.messages,
      pinned_messages: [],
      read: channel.members.map((m) => ({
        user: m.user,
        last_read: now(),
        unread_messages: 0,
      })),
      watcher_count: 2,
      watchers: profiles,
    };
  }
  async function install(page, person) {
    const me = profiles.find(
      (u) => u.id === "cola_" + person.id.replaceAll("-", ""),
    );
    await page.routeWebSocket("wss://chat.stream-io-api.com/**", (ws) => {
      sockets.set(me.id, ws);
      ws.send(
        JSON.stringify({
          type: "health.check",
          connection_id: randomUUID(),
          created_at: now(),
          me: {
            ...me,
            devices: [],
            mutes: [],
            channel_mutes: [],
            total_unread_count: 0,
            unread_channels: 0,
          },
        }),
      );
      ws.onMessage(() =>
        ws.send(JSON.stringify({ type: "health.check", created_at: now() })),
      );
    });
    await page.route("**/api/chat/channels", async (route) => {
      const request = route.request().postDataJSON(),
        response = await route.fetch(),
        result = await response.json();
      if (response.status() === 201 && !channels.has(result.cid)) {
        const id = result.cid.split(":")[1],
          ids = [person.id, ...request.members].map(
            (id) => "cola_" + id.replaceAll("-", ""),
          );
        channels.set(result.cid, {
          id,
          cid: result.cid,
          type: "colabike",
          ...(request.name ? { name: request.name } : {}),
          created_at: now(),
          updated_at: now(),
          created_by: me,
          frozen: false,
          disabled: false,
          member_count: ids.length,
          members: profiles
            .filter((u) => ids.includes(u.id))
            .map((user) => ({
              user,
              user_id: user.id,
              channel_role: "colabike_member",
              created_at: now(),
              updated_at: now(),
            })),
          config: { ...policy().type, name: "colabike" },
          own_capabilities: [
            "read-events",
            "read-channel",
            "send-message",
            "send-reply",
            "send-reaction",
            "send-typing-events",
            "upload-file",
            "flag-message",
            "update-own-message",
            "delete-own-message",
            "quote-message",
          ],
          messages: [],
        });
      }
      await route.fulfill({ response, json: result });
    });
    await page.route("https://chat.stream-io-api.com/**", async (route) => {
      const url = new URL(route.request().url()),
        path = url.pathname,
        data = route.request().postDataJSON() || {};
      const reply = (json) =>
        route.fulfill({ json: { duration: "1ms", ...json } });
      if (path === "/app") return reply({ app: policy().app });
      if (path === "/channels")
        return reply({
          channels: [...channels.values()]
            .filter((c) => c.members.some((m) => m.user_id === me.id))
            .map(state),
        });
      const channelMatch = path.match(
        /^\/channels\/colabike\/([^/]+)\/(query|message|read|event|stop-watching)$/,
      );
      if (channelMatch) {
        const c = channels.get("colabike:" + channelMatch[1]);
        if (!c)
          return route.fulfill({
            status: 404,
            json: { code: 16, message: "Fixture channel missing" },
          });
        if (channelMatch[2] === "query") return reply(state(c));
        if (channelMatch[2] === "message") {
          const message = {
            ...data.message,
            id: data.message.id || randomUUID(),
            cid: c.cid,
            type: "regular",
            user: me,
            created_at: now(),
            updated_at: now(),
            attachments: data.message.attachments || [],
            own_reactions: [],
            latest_reactions: [],
            reaction_counts: {},
            reaction_scores: {},
            reply_count: 0,
          };
          c.messages.push(message);
          c.last_message_at = message.created_at;
          emit(
            {
              type: "message.new",
              cid: c.cid,
              channel_type: c.type,
              channel_id: c.id,
              message,
              user: me,
              total_unread_count: 1,
            },
            c.members.map((m) => m.user_id),
          );
          return reply({ message });
        }
        if (channelMatch[2] === "read") {
          reads.push(me.id);
          const event = {
            type: "message.read",
            cid: c.cid,
            user: me,
            created_at: now(),
            total_unread_count: 0,
          };
          emit(event);
          return reply({ event });
        }
        if (channelMatch[2] === "event") {
          events.push(data.event);
          const event = { ...data.event, cid: c.cid, user: me };
          emit(event);
          return reply({ event });
        }
        return reply({});
      }
      if (path === "/channels/delivered")
        return reply({
          event: { type: "message.delivered", user: me, created_at: now() },
        });
      unexpected.push(path);
      return route.fulfill({
        status: 400,
        json: { code: 4, message: "Unhandled chat fixture endpoint" },
      });
    });
  }
  return { install, channels, reads, events, unexpected };
}
