// Operator-only: default is a read-only check. Use a dedicated EU West app.
import { chatProvider, ensureChatPolicy } from "../lib/chat-provider.js";
import {
  CHAT_TYPE,
  CHAT_ROLE,
  CHAT_MEMBER_ROLE,
  chatMemberGrants,
  chatUploads,
} from "../lib/chat-config.js";
try {
  const client = chatProvider();
  if (process.argv.includes("--apply")) {
    const { roles } = await client.listRoles();
    for (const name of [CHAT_ROLE, CHAT_MEMBER_ROLE]) {
      if (!roles.some((role) => role.name === name))
        await client.createRole(name);
    }
    const { app } = await client.getAppSettings();
    await client.updateAppSettings({
      disable_auth_checks: false,
      disable_permissions_checks: false,
      grants: { ...app.grants, [CHAT_ROLE]: [], [CHAT_MEMBER_ROLE]: [] },
      image_upload_config: chatUploads,
      file_upload_config: chatUploads,
    });
    const { channel_types: types } = await client.listChannelTypes();
    const settings = {
      commands: [],
      grants: {
        [CHAT_ROLE]: [],
        [CHAT_MEMBER_ROLE]: chatMemberGrants,
        user: [],
        guest: [],
        anonymous: [],
        channel_member: [],
        channel_moderator: [],
      },
      read_events: true,
      typing_events: true,
      reactions: true,
      replies: true,
      uploads: true,
      mutes: true,
      url_enrichment: false,
      max_message_length: 4000,
      polls: false,
      shared_locations: false,
      push_notifications: false,
    };
    if (types[CHAT_TYPE]) await client.updateChannelType(CHAT_TYPE, settings);
    else await client.createChannelType({ name: CHAT_TYPE, ...settings });
  }
  await ensureChatPolicy(client);
  console.log(
    "Stream Chat policy verified. Complete the two-user acceptance in docs/integrations/chat.md before enabling.",
  );
} catch {
  // Provider errors may embed credentials and request headers.
  console.error(
    "Stream Chat policy check failed. Check credentials, roles and channel settings in the dashboard; see docs/integrations/chat.md.",
  );
  process.exitCode = 1;
}
