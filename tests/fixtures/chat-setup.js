// Test-only Stream double for the real chat-setup CLI. Persist settings so
// separate --apply and read-only invocations see the same vendor state.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { StreamChat } from "stream-chat";

const stateFile = process.env.COLA_CHAT_SETUP_STATE;
if (!stateFile || process.env.DEPLOYMENT_MODE === "production")
  throw new Error("Disposable chat setup test state required");

const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
const update = (change) => {
  const state = read();
  change(state);
  writeFileSync(stateFile, JSON.stringify(state));
};
// Stream can omit explicitly empty grants when reading settings back.
const responseSettings = (settings) => ({
  ...settings,
  grants: Object.fromEntries(
    Object.entries(settings.grants).filter(
      ([, permissions]) => permissions.length,
    ),
  ),
});
const methods = {
  async listRoles() {
    return { roles: read().roles.map((name) => ({ name })) };
  },
  async createRole(name) {
    update((state) => state.roles.push(name));
  },
  async getAppSettings() {
    return { app: responseSettings(read().app) };
  },
  async updateAppSettings(settings) {
    for (const config of [
      settings.file_upload_config,
      settings.image_upload_config,
    ]) {
      if (!config.allowed_file_extensions.every((ext) => ext.startsWith(".")))
        throw new Error("Stream rejects extensions without a leading dot");
    }
    update((state) => Object.assign(state.app, settings));
  },
  async listChannelTypes() {
    return { channel_types: read().channel_types };
  },
  async createChannelType(settings) {
    update((state) => {
      state.channel_types[settings.name] = settings;
      state.operations.push("create");
    });
  },
  async updateChannelType(name, settings) {
    update((state) => {
      state.channel_types[name] = settings;
      state.operations.push("update");
    });
  },
  async getChannelType(name) {
    return responseSettings(read().channel_types[name]);
  },
};
const require = createRequire(import.meta.url);
for (const cls of new Set([StreamChat, require("stream-chat").StreamChat])) {
  Object.assign(cls.prototype, methods);
}
