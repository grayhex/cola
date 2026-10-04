import { pushConfig } from "./push-config.ts";
import type {
  PushMessage,
  PushOutcome,
  PushTransport,
} from "./push-transport.ts";

// The RuStore adapter of the push transport (#342): the HTTP API of RuStore Push
// (POST /v1/projects/{projectId}/messages:send, `Authorization: Bearer <service
// token>`). The host is a constant of this file and the project comes from the
// allow-list of the server; a client names neither. The message is **data
// only**: the `notification` field is never filled, because the provider's own
// library could then show a second notification, or one meant for a previous
// account. The envelope travels as one string under one key, and the app builds
// the only notification there is.
//
// What is never done here: logging a token, a response body or the service
// token; following a redirect; waiting longer than a few seconds. An error of
// the network is "try again", never "forget the device".

export const RUSTORE_PUSH_HOST = "https://vkpns.rustore.ru";
/** The key under which the envelope is carried in `data`. */
export const ENVELOPE_KEY = "envelope";
/** The provider's own limit for a whole message. */
export const RUSTORE_MAX_BYTES = 4096;
const TIMEOUT_MS = 8000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Seconds as the provider reads a duration: `86400s`. At least one second. */
const ttl = (seconds: number) => `${Math.max(1, Math.floor(seconds))}s`;

export function rustoreRequestBody(message: PushMessage) {
  return JSON.stringify({
    message: {
      token: message.token,
      data: { [ENVELOPE_KEY]: message.data },
      android: { ttl: ttl(message.ttlSeconds) },
    },
  });
}

/** The status the provider reports in the error body, or null. Nothing else is read from it. */
async function statusOf(response: Response) {
  try {
    const body = (await response.json()) as { error?: { status?: unknown } };
    return typeof body?.error?.status === "string" ? body.error.status : null;
  } catch {
    return null;
  }
}

function retryAfter(response: Response) {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function rustoreTransport(
  serviceToken: string,
  fetchImpl: Fetch = fetch,
): PushTransport {
  return {
    async send(message): Promise<PushOutcome> {
      if (message.provider !== "rustore") return { kind: "rejected" };
      const body = rustoreRequestBody(message);
      // The message is never cut to fit: an envelope that is too big is a defect
      // of the sender, and no provider will take it.
      if (Buffer.byteLength(body, "utf8") > RUSTORE_MAX_BYTES)
        return { kind: "rejected" };
      let response: Response;
      try {
        response = await fetchImpl(
          `${RUSTORE_PUSH_HOST}/v1/projects/${encodeURIComponent(message.projectId)}/messages:send`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: {
              Authorization: `Bearer ${serviceToken}`,
              "Content-Type": "application/json",
            },
            body,
          },
        );
      } catch {
        // A timeout, a reset, a name that did not resolve: nobody answered.
        return { kind: "temporary" };
      }
      if (response.ok) return { kind: "accepted" };
      const status = await statusOf(response);
      if (response.status === 401 || response.status === 403)
        return { kind: "auth" };
      // The address is gone for good (uninstalled, expired, turned off).
      if (response.status === 404 || status === "UNREGISTERED")
        return { kind: "invalid_token" };
      if (response.status === 429)
        return { kind: "temporary", retryAfterSeconds: retryAfter(response) };
      if (response.status >= 500) return { kind: "temporary" };
      // 400 and the rest: the provider will never take this message.
      return { kind: "rejected" };
    },
  };
}

/** The transport for the server's configuration, or null while push is not set up. */
export function configuredRustoreTransport(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: Fetch,
): PushTransport | null {
  const config = pushConfig(env);
  const token = env.RUSTORE_PUSH_SERVICE_TOKEN?.trim();
  return config.sender && token ? rustoreTransport(token, fetchImpl) : null;
}
