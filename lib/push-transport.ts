import type { PushProvider } from "./push-config.ts";
import { configuredRustoreTransport } from "./push-rustore.ts";

// What the sender needs from a provider (#342), and nothing else. A provider is
// one adapter of this interface; the queue knows no vendor, no endpoint and no
// key. The adapter gets everything it needs in the message and returns what
// happened in the words below: "accepted" means the provider took the message,
// not that the phone received it, showed it, or that anyone read it.

export interface PushMessage {
  provider: PushProvider;
  projectId: string;
  /** The address of the device. A secret: it is not logged and not stored by the adapter. */
  token: string;
  /** The envelope as one JSON string, carried in the data part and never as a ready-made notification. */
  data: string;
  /** Seconds the provider may keep the message. At least 1: an expired one is not sent. */
  ttlSeconds: number;
}

export type PushOutcome =
  /** The provider took it. */
  | { kind: "accepted" }
  /** The address is gone for good (unregistered, uninstalled): the device is revoked. */
  | { kind: "invalid_token" }
  /** Try again later: a timeout, a server error, a limit (`retryAfterSeconds` if the provider said). */
  | { kind: "temporary"; retryAfterSeconds?: number }
  /** The server's own key or project is wrong: the operator's fault, never the device's. */
  | { kind: "auth" }
  /** The provider will never take this message. */
  | { kind: "rejected" };

export interface PushTransport {
  send(message: PushMessage): Promise<PushOutcome>;
}

/**
 * The transport of the configured provider, or null while there is none: without
 * one nothing is sent and nothing queues up (see `runPushBatch`).
 */
export function pushTransport(
  env: NodeJS.ProcessEnv = process.env,
): PushTransport | null {
  return configuredRustoreTransport(env);
}
