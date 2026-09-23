// Runs inside the integration harness; the app gets ERROR_TRACKER_DSN pointing
// at the fake tracker started here (see scripts/test-resolver-integration.js).
import assert from "node:assert/strict";
import http from "node:http";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const trackerPort = Number(new URL(process.env.ERROR_TRACKER_DSN).port);

const received = [];
const tracker = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push({ url: req.url, auth: req.headers["x-sentry-auth"], body });
    res.end("{}");
  });
});
await new Promise((resolve) =>
  tracker.listen(trackerPort, "127.0.0.1", resolve),
);

const post = (body, origin = base) =>
  fetch(base + "/api/client-errors", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
try {
  const report = {
    kind: "boundary",
    message:
      "Cannot read properties of undefined (reading 'id') for kim@example.com",
    stack:
      "TypeError: boom\n    at Garage (https://colabike.ru/_next/static/chunks/0abc.js:1:2345)\n" +
      "    at renderWithHooks (https://colabike.ru/_next/static/chunks/1def.js?v=2:2:10)",
    digest: "1234567890",
    path: "/b/fe4c58f7-e696-491f-9bd8-dc0f633309e8?token=secret",
  };
  assert.equal((await post(report, "https://evil.example")).status, 403);
  assert.equal((await post("{not json")).status, 400);
  assert.equal((await post({ ...report, kind: "other" })).status, 400);
  assert.equal(
    (await post({ ...report, stack: "x".repeat(20000) })).status,
    400,
  );
  const accepted = await post(report);
  assert.equal(accepted.status, 204);
  assert.match(accepted.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);

  for (let i = 0; i < 50 && !received.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(received.length, 1, "the report reaches the tracker");
  assert.match(received[0].url, /\/api\/\d+\/envelope\/$/);
  assert.match(received[0].auth, /sentry_key=/);
  const event = JSON.parse(received[0].body.split("\n")[2]);
  assert.equal(event.platform, "javascript");
  assert.equal(event.tags.source, "browser");
  assert.equal(event.tags.route, "/b/:id");
  assert.match(event.tags.request_id, /^[0-9a-f-]{36}$/);
  assert.match(event.exception.values[0].value, /\[email\]/);
  assert.equal(
    event.exception.values[0].stacktrace.frames.at(-1).function,
    "Garage",
  );
  assert.doesNotMatch(
    received[0].body,
    /kim@example\.com|token=secret|colabike\.ru\/_next|cola_session/,
  );

  // Every API family now carries a request ID for log correlation.
  for (const path of [
    "rides",
    "journal",
    "market",
    "articles",
    "discovery/home",
    "showcase",
  ]) {
    const response = await fetch(base + "/api/" + path);
    assert.match(
      response.headers.get("x-request-id") || "",
      /^[0-9a-f-]{36}$/,
      path,
    );
  }
  console.log(
    "Observability HTTP: client error intake, origin/size checks, scrubbed tracker envelope and request IDs passed.",
  );
} finally {
  await new Promise((resolve) => tracker.close(resolve));
}
