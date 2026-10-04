import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pushEnvelopeSchema } from "../lib/notification-envelope.ts";
import { pushTransport, type PushMessage } from "../lib/push-transport.ts";
import {
  configuredRustoreTransport,
  ENVELOPE_KEY,
  RUSTORE_MAX_BYTES,
  rustoreRequestBody,
  rustoreTransport,
} from "../lib/push-rustore.ts";
import { processEnv } from "./support/env.ts";

// The RuStore adapter (#342): what is sent (data only, one key, the host and the
// project of the server), and what each answer of the provider means for the
// queue. No network: the provider is a function.

const envelope = pushEnvelopeSchema.parse({
  v: 1,
  deliveryId: "00000000-0000-4000-8000-0000000000ca",
  eventId: "00000000-0000-4000-8000-000000000066",
  bindingGeneration: 4,
  category: "discussions",
  type: "reply",
  createdAt: "2026-10-04T09:00:00.000Z",
  expiresAt: "2026-10-05T09:00:00.000Z",
  neutral: false,
  title: "Ответ на ваш комментарий",
  body: "К велосипеду «Gravel Nuroad»",
  group: "bike:00000000-0000-4000-8000-00000000000a",
  target: {
    type: "bike",
    id: "00000000-0000-4000-8000-00000000000a",
    commentId: "00000000-0000-4000-8000-000000000014",
    occurrenceAt: null,
    agreementRevision: null,
  },
});
const message: PushMessage = {
  provider: "rustore",
  projectId: "project-a",
  token: "secret-device-address",
  data: JSON.stringify(envelope),
  ttlSeconds: 3600.9,
};
const serviceToken = "secret-service-token";

function provider(
  answer: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = rustoreTransport(serviceToken, async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  });
  return { calls, transport };
}
const error = (
  status: number,
  name: string,
  headers: Record<string, string> = {},
) =>
  new Response(
    JSON.stringify({ error: { code: status, message: "x", status: name } }),
    {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    },
  );

test("a message is data only: one key, no notification, the host and project of the server", async () => {
  const { calls, transport } = provider(() => Response.json({}));
  assert.deepEqual(await transport.send(message), { kind: "accepted" });
  const [call] = calls;
  assert.equal(
    call.url,
    "https://vkpns.rustore.ru/v1/projects/project-a/messages:send",
  );
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "error");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer " + serviceToken);
  assert.equal(headers["Content-Type"], "application/json");
  const body = JSON.parse(String(call.init.body));
  assert.deepEqual(Object.keys(body), ["message"]);
  assert.deepEqual(Object.keys(body.message).sort(), [
    "android",
    "data",
    "token",
  ]);
  assert.equal("notification" in body.message, false);
  assert.equal("notification" in body.message.android, false);
  assert.equal(body.message.token, message.token);
  assert.deepEqual(Object.keys(body.message.data), [ENVELOPE_KEY]);
  assert.deepEqual(
    pushEnvelopeSchema.parse(JSON.parse(body.message.data[ENVELOPE_KEY])),
    envelope,
  );
  // The time to live is what is left, in whole seconds.
  assert.equal(body.message.android.ttl, "3600s");
  // The service token goes in the header and nowhere else.
  assert.ok(!String(call.init.body).includes(serviceToken));
});

test("the project in the path is encoded, not trusted", async () => {
  const { calls, transport } = provider(() => Response.json({}));
  await transport.send({ ...message, projectId: "a/../b?c" });
  assert.equal(
    calls[0].url,
    "https://vkpns.rustore.ru/v1/projects/a%2F..%2Fb%3Fc/messages:send",
  );
});

test("each answer of the provider means one thing for the queue", async () => {
  const cases: [Response, object][] = [
    [Response.json({}), { kind: "accepted" }],
    [error(404, "NOT_FOUND"), { kind: "invalid_token" }],
    [error(400, "UNREGISTERED"), { kind: "invalid_token" }],
    [error(401, "PERMISSION_DENIED"), { kind: "auth" }],
    [error(403, "PERMISSION_DENIED"), { kind: "auth" }],
    [
      error(429, "TOO_MANY_REQUESTS", { "Retry-After": "120" }),
      { kind: "temporary", retryAfterSeconds: 120 },
    ],
    [
      error(429, "TOO_MANY_REQUESTS"),
      { kind: "temporary", retryAfterSeconds: undefined },
    ],
    [error(500, "INTERNAL"), { kind: "temporary" }],
    [error(503, "UNAVAILABLE"), { kind: "temporary" }],
    [error(400, "INVALID_ARGUMENT"), { kind: "rejected" }],
    [new Response("not json", { status: 400 }), { kind: "rejected" }],
  ];
  for (const [response, expected] of cases) {
    const { transport } = provider(() => response.clone());
    assert.deepEqual(
      await transport.send(message),
      expected,
      String(response.status),
    );
  }
});

test("a network that does not answer is a try again, never a forgotten device; no secret leaves in the outcome", async () => {
  for (const failure of [
    new TypeError("fetch failed"),
    new DOMException("timed out", "TimeoutError"),
    new Error("redirect mode is set to error"),
  ]) {
    const transport = rustoreTransport(serviceToken, async () => {
      throw failure;
    });
    const outcome = await transport.send(message);
    assert.deepEqual(outcome, { kind: "temporary" });
    assert.ok(!JSON.stringify(outcome).includes(serviceToken));
    assert.ok(!JSON.stringify(outcome).includes(message.token));
  }
});

test("a message that does not fit the provider is refused, not cut", async () => {
  const { calls, transport } = provider(() => Response.json({}));
  const big = {
    ...message,
    data: JSON.stringify({ ...envelope, body: "я".repeat(3000) }),
  };
  assert.ok(Buffer.byteLength(rustoreRequestBody(big)) > RUSTORE_MAX_BYTES);
  assert.deepEqual(await transport.send(big), { kind: "rejected" });
  assert.equal(calls.length, 0, "nothing left the server");
  // Another provider's message is not this adapter's.
  assert.deepEqual(
    await transport.send({
      ...message,
      provider: "fcm" as unknown as "rustore",
    }),
    { kind: "rejected" },
  );
  assert.equal(calls.length, 0);
});

test("the transport exists only for a complete configuration", () => {
  const key = randomBytes(32).toString("base64");
  assert.equal(configuredRustoreTransport(processEnv()), null);
  assert.equal(
    configuredRustoreTransport(
      processEnv({ PUSH_TOKEN_KEY: key, RUSTORE_PUSH_PROJECTS: "p" }),
    ),
    null,
    "no service token",
  );
  const full = processEnv({
    PUSH_TOKEN_KEY: key,
    RUSTORE_PUSH_PROJECTS: "p",
    RUSTORE_PUSH_SERVICE_TOKEN: serviceToken,
  });
  assert.ok(configuredRustoreTransport(full));
  assert.ok(pushTransport(full));
  assert.equal(pushTransport(processEnv()), null);
});
