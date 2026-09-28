import { StreamChat } from "stream-chat";
import {
  chatCredentials,
  CHAT_TYPE,
  CHAT_ROLE,
  CHAT_MEMBER_ROLE,
  chatMemberGrants,
  CHAT_FILE_BYTES,
  chatUploads,
} from "./chat-config.js";

let cached;
export function chatProvider() {
  const config = chatCredentials();
  if (!config) throw new ChatError("Сообщения временно недоступны", 503);
  if (!cached || cached.key !== config.key || cached.secret !== config.secret) {
    policyUntil = 0;
    cached = {
      ...config,
      client: new StreamChat(config.key, config.secret, {
        timeout: 5000,
        logger: () => {},
      }),
    };
  }
  return cached.client;
}
export class ChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const same = (a, b) =>
  Array.isArray(a) &&
  a.length === b.length &&
  [...a].sort().join() === [...b].sort().join();
export function assertChatPolicy(app, type) {
  const grants = type.grants || {};
  if (
    app.disable_auth_checks ||
    app.disable_permissions_checks ||
    !same(app.grants?.[CHAT_ROLE], []) ||
    !same(app.grants?.[CHAT_MEMBER_ROLE], []) ||
    !same(grants[CHAT_ROLE], []) ||
    !same(grants[CHAT_MEMBER_ROLE], chatMemberGrants) ||
    !same(grants.user, []) ||
    !same(grants.guest, []) ||
    !same(grants.anonymous, []) ||
    !same(grants.channel_member, []) ||
    !same(grants.channel_moderator, []) ||
    type.commands?.length ||
    type.url_enrichment ||
    type.max_message_length !== 4000 ||
    !type.read_events ||
    !type.typing_events ||
    !type.reactions ||
    !type.replies ||
    !type.uploads ||
    type.polls ||
    type.shared_locations
  ) {
    throw new ChatError("Сообщения ещё не настроены", 503);
  }
  for (const uploads of [app.file_upload_config, app.image_upload_config]) {
    if (
      !uploads ||
      uploads.size_limit !== CHAT_FILE_BYTES ||
      !same(
        uploads.allowed_file_extensions,
        chatUploads.allowed_file_extensions,
      ) ||
      !same(uploads.allowed_mime_types, chatUploads.allowed_mime_types)
    )
      throw new ChatError("Сообщения ещё не настроены", 503);
  }
}
let policyUntil = 0;
export async function ensureChatPolicy(provider = chatProvider()) {
  if (provider === cached?.client && Date.now() < policyUntil) return;
  const [settings, type] = await Promise.all([
    provider.getAppSettings(),
    provider.getChannelType(CHAT_TYPE),
  ]);
  assertChatPolicy(settings.app, type);
  if (provider === cached?.client) policyUntil = Date.now() + 30000;
}
