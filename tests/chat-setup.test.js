import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatUploads, CHAT_TYPE } from "../lib/chat-config.js";
import { assertChatPolicy, ensureChatPolicy } from "../lib/chat-provider.js";
import { policy } from "./fixtures/chat-provider.js";

test("Stream upload extensions use dotted values for both configs and policy", async () => {
  const extensions = [".jpg", ".jpeg", ".png", ".webp"];
  assert.deepEqual(chatUploads.allowed_file_extensions, extensions);
  const valid = policy();
  for (const config of ["file_upload_config", "image_upload_config"])
    assert.deepEqual(valid.app[config].allowed_file_extensions, extensions);
  await assert.doesNotReject(
    ensureChatPolicy({
      getAppSettings: async () => ({ app: valid.app }),
      getChannelType: async (type) => {
        assert.equal(type, CHAT_TYPE);
        return valid.type;
      },
    }),
  );
  for (const config of ["file_upload_config", "image_upload_config"]) {
    const invalid = policy();
    invalid.app[config].allowed_file_extensions = extensions.map((ext) =>
      ext.slice(1),
    );
    assert.throws(
      () => assertChatPolicy(invalid.app, invalid.type),
      (error) => error.status === 503,
    );
  }
});

test("chat-setup --apply creates or updates colabike, then dry-run verifies policy", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cola-chat-setup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stateFile = join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({
      roles: [],
      app: { grants: {} },
      channel_types: {},
      operations: [],
    }),
  );
  const fixture = fileURLToPath(
    new URL("./fixtures/chat-setup.js", import.meta.url),
  );
  const script = fileURLToPath(
    new URL("../scripts/chat-setup.js", import.meta.url),
  );
  const invoke = (...args) => {
    const result = spawnSync(
      process.execPath,
      ["--import", fixture, script, ...args],
      {
        env: {
          ...process.env,
          COLA_CHAT_SETUP_STATE: stateFile,
          DEPLOYMENT_MODE: "test",
          STREAM_CHAT_API_KEY: "test-key",
          STREAM_CHAT_API_SECRET: "test-secret",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Stream Chat policy verified/);
  };
  invoke("--apply");
  invoke();
  invoke("--apply");
  invoke();
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.deepEqual(state.operations, ["create", "update"]);
  assert.ok(state.channel_types[CHAT_TYPE]);
  assert.doesNotThrow(() =>
    assertChatPolicy(state.app, state.channel_types[CHAT_TYPE]),
  );
});
