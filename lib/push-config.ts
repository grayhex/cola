// What the server needs to push (#342), read from the environment like SMTP and
// the chat keys are: a missing or half-set value means "off", never a guess. The
// secrets live only in the environment of the server; none of them is shown to
// the admin, logged, or sent to a client, and the client never names an endpoint.

export type PushProvider = "rustore";
export const pushProviders: readonly PushProvider[] = ["rustore"];

export interface PushConfig {
  /** The key that seals the addresses in the registry (32 bytes), or null. */
  key: Buffer | null;
  /** The key before the current one, kept while the registry is re-sealed. */
  previousKey: Buffer | null;
  /** RuStore push projects the app may register with; nothing else is accepted. */
  projects: string[];
  /** The service token of the RuStore send API is set (its value is not read here). */
  senderToken: boolean;
  /** Registrations are accepted: a key and at least one allowed project. */
  registry: boolean;
  /** A message can be sent: the registry and the provider's service token. */
  sender: boolean;
}

function keyOf(raw: string | undefined) {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), "base64");
  return key.length === 32 ? key : null;
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const key = keyOf(env.PUSH_TOKEN_KEY);
  const projects = (env.RUSTORE_PUSH_PROJECTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9._-]{1,100}$/.test(value));
  const senderToken = !!env.RUSTORE_PUSH_SERVICE_TOKEN?.trim();
  const registry = !!key && projects.length > 0;
  return {
    key,
    previousKey: keyOf(env.PUSH_TOKEN_KEY_PREVIOUS),
    projects,
    senderToken,
    registry,
    sender: registry && senderToken,
  };
}

/**
 * Whether push can carry a message at all: what the settings say to a client.
 * Until the owner has set the keys, nobody can consent to push, exactly as
 * nobody can consent to e-mail while SMTP is not configured.
 */
export const pushAvailable = (env: NodeJS.ProcessEnv = process.env) =>
  pushConfig(env).sender;
