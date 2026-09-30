export const CHAT_TYPE = "colabike";
export const CHAT_ROLE = "colabike_user";
export const CHAT_MEMBER_ROLE = "colabike_member";
export const CHAT_FILE_BYTES = 5 * 1024 * 1024;
export const CHAT_TOKEN_SECONDS = 300;
export const chatMemberGrants = [
  "read-channel",
  "read-channel-members",
  "create-message",
  "create-attachment",
  "upload-attachment",
  "create-reaction",
  "delete-reaction-owner",
  "update-message-owner",
  "delete-message-owner",
  "delete-attachment-owner",
  "add-links",
  "flag-message",
  "mute-channel",
  "send-custom-event",
];
export function chatConfig(env = process.env) {
  if (env.STREAM_CHAT_ENABLED !== "true") return null;
  const key = env.STREAM_CHAT_API_KEY || env.NEXT_PUBLIC_STREAM_CHAT_API_KEY;
  if (!key || !env.STREAM_CHAT_API_SECRET) return null;
  return { key, secret: env.STREAM_CHAT_API_SECRET };
}
export function chatCredentials(env = process.env) {
  // Disabling the UI must not stop removal of data already sent to the vendor.
  return chatConfig({ ...env, STREAM_CHAT_ENABLED: "true" });
}
export const streamUserId = (id: string) => "cola_" + id.replaceAll("-", "");
export const chatUploads = {
  allowed_file_extensions: [".jpg", ".jpeg", ".png", ".webp"],
  allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  size_limit: CHAT_FILE_BYTES,
};
