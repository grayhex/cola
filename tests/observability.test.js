import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  errorDetails,
  logError,
  routeTemplate,
  scrub,
  stackFrames,
  traced,
} from "../lib/observability.js";
import {
  envelopeBody,
  parseDsn,
  reportError,
  trackerEvent,
} from "../lib/error-tracker.js";
import { validateRuntime } from "../lib/runtime-config.js";

function capture(method, run) {
  const original = console[method];
  const lines = [];
  console[method] = (line) => lines.push(line);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console[method] = original;
    })
    .then(() => lines.map((line) => JSON.parse(line)));
}

test("scrub removes personal data and secrets but keeps identifiers", () => {
  const text = scrub(
    "User alice@example.com from 203.0.113.7 token " +
      "q2Vt3xZ8k1LmN0pQrS5tU7vW9yA_bC-dE " +
      "bike 8f6827b6-0c56-484d-9fe0-2fbe12345678 " +
      "GET https://colabike.ru/api/photos/x?width=320&token=abc " +
      'duplicate key value violates unique constraint "users_email_key" ' +
      'invalid input syntax for type uuid: "not a uuid <b>"',
  );
  assert.doesNotMatch(
    text,
    /alice|203\.0\.113\.7|q2Vt3x|8f6827b6|token=abc|not a uuid/,
  );
  assert.match(text, /\[email\]/);
  assert.match(text, /\[ip\]/);
  assert.match(text, /\[token\]/);
  assert.match(text, /\[id\]/);
  assert.match(text, /https:\/\/colabike\.ru\/api\/photos\/x\?\[query\]/);
  assert.match(text, /"users_email_key"/, "constraint names help diagnosis");
  assert.match(text, /uuid: "\[value\]"/);
  assert.equal(scrub("x".repeat(400)).length, 301);
});

test("stack frames keep code locations for Node and browsers", () => {
  const node = [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    `    at saveRide (${process.cwd()}/lib/rides.js:120:14)`,
    "    at async handler (file:///app/.next/server/app/api/rides/route.js:3:99)",
  ].join("\n");
  assert.deepEqual(stackFrames(node), [
    "saveRide (lib/rides.js:120:14)",
    "async handler (/app/.next/server/app/api/rides/route.js:3:99)",
  ]);
  const browser =
    "render@https://colabike.ru/_next/static/chunks/0abc.js?v=1:1:2345\n" +
    "    at Garage (https://colabike.ru/_next/static/chunks/1def.js:2:10)";
  assert.deepEqual(stackFrames(browser), [
    "render@/_next/static/chunks/0abc.js:1:2345",
    "Garage (/_next/static/chunks/1def.js:2:10)",
  ]);
  assert.deepEqual(stackFrames(undefined), []);
});

test("error details include scrubbed message, code, stack and cause", () => {
  const cause = new Error("connect ECONNREFUSED 10.0.0.5:5432");
  const error = Object.assign(
    new Error("failed for bob@example.org", { cause }),
    {
      code: "ECONNREFUSED",
    },
  );
  const details = errorDetails(error);
  assert.equal(details.errorType, "Error");
  assert.equal(details.code, "ECONNREFUSED");
  assert.equal(details.message, "failed for [email]");
  assert.ok(details.stack.length > 0);
  assert.equal(details.cause.message, "connect ECONNREFUSED [ip]:5432");
  assert.equal(errorDetails({ code: "not a code!" }).code, undefined);
});

test("traced requests carry IDs into error logs and report slow or failed requests", async () => {
  const previous = process.env.SLOW_REQUEST_MS;
  process.env.SLOW_REQUEST_MS = "1";
  try {
    const url =
      "http://app.test/api/bikes/8f6827b6-0c56-484d-9fe0-2fbe12345678/photos/7?x=secret";
    let response;
    const errors = await capture("error", async () => {
      response = await traced(async () => {
        logError("inner_failure", new Error("mail to eve@example.net failed"));
        return Response.json({ ok: false }, { status: 503 });
      })(new Request(url));
    });
    const id = response.headers.get("X-Request-ID");
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(errors[0].event, "inner_failure");
    assert.equal(errors[0].requestId, id);
    assert.equal(errors[0].route, "/api/bikes/:id/photos/:n");
    assert.equal(errors[0].message, "mail to [email] failed");
    assert.ok(
      errors[0].stack.some((frame) =>
        frame.includes("tests/observability.test.js"),
      ),
    );
    assert.equal(errors[1].event, "request_failed");
    assert.equal(errors[1].status, 503);
    assert.doesNotMatch(JSON.stringify(errors), /secret|eve@/);

    const warnings = await capture("warn", () =>
      traced(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return Response.json({ ok: true });
      })(new Request("http://app.test/api/showcase?q=private")),
    );
    assert.equal(warnings[0].event, "slow_request");
    assert.equal(warnings[0].route, "/api/showcase");
    assert.ok(warnings[0].durationMs >= 1);

    // Redirect/fetch responses have immutable headers; tracing must not break them.
    const redirected = await traced(async () =>
      Response.redirect("http://app.test/next", 302),
    )(new Request("http://app.test/api/redirect"));
    assert.equal(redirected.status, 302);
    assert.ok(redirected.headers.get("X-Request-ID"));

    const crashed = await capture("error", async () => {
      const res = await traced(async () => {
        throw new TypeError("boom");
      })(new Request("http://app.test/api/crash"));
      assert.equal(res.status, 500);
      assert.equal(
        (await res.json()).requestId,
        res.headers.get("X-Request-ID"),
      );
    });
    assert.equal(crashed[0].event, "unhandled_request");
    assert.equal(crashed[0].errorType, "TypeError");
  } finally {
    if (previous === undefined) delete process.env.SLOW_REQUEST_MS;
    else process.env.SLOW_REQUEST_MS = previous;
  }
});

test("route templates hide IDs, numbers and long tokens", () => {
  assert.equal(
    routeTemplate("/b/fe4c58f7-e696-491f-9bd8-dc0f633309e8?x=1"),
    "/b/:id",
  );
  assert.equal(
    routeTemplate("http://h/api/rides/12/comments"),
    "/api/rides/:n/comments",
  );
  assert.equal(routeTemplate("/reset?token=" + "a".repeat(43)), "/reset");
  assert.equal(routeTemplate("/x/" + "a1".repeat(30)), "/x/:param");
});

test("DSN parsing, event format and envelope follow the Sentry protocol", () => {
  assert.deepEqual(parseDsn("https://pub@errors.example.com/42"), {
    key: "pub",
    endpoint: "https://errors.example.com/api/42/envelope/",
    secure: true,
  });
  assert.equal(
    parseDsn("https://pub@errors.example.com/glitchtip/7").endpoint,
    "https://errors.example.com/glitchtip/api/7/envelope/",
  );
  for (const bad of [
    "",
    "not a url",
    "https://errors.example.com/42",
    "https://pub@errors.example.com/abc",
    "ftp://pub@h/1",
  ])
    assert.equal(parseDsn(bad), null, bad);

  const event = trackerEvent(
    {
      event: "rides_failed",
      requestId: "req-1",
      route: "/api/rides",
      errorType: "TypeError",
      message: "boom",
      stack: [
        "saveRide (lib/rides.js:120:14)",
        "handler (app/api/rides/route.js:3:9)",
      ],
    },
    new Date("2026-09-23T00:00:00Z"),
    { DEPLOYMENT_MODE: "production" },
  );
  assert.match(event.event_id, /^[0-9a-f]{32}$/);
  assert.equal(event.environment, "production");
  assert.equal(event.platform, "node");
  assert.deepEqual(event.tags, {
    event: "rides_failed",
    source: "server",
    route: "/api/rides",
    request_id: "req-1",
  });
  const frames = event.exception.values[0].stacktrace.frames;
  assert.equal(
    frames.at(-1).function,
    "saveRide",
    "Sentry frames are oldest first",
  );
  assert.deepEqual(
    {
      filename: frames.at(-1).filename,
      lineno: frames.at(-1).lineno,
      colno: frames.at(-1).colno,
    },
    { filename: "lib/rides.js", lineno: 120, colno: 14 },
  );
  const lines = envelopeBody(event)
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines[0].event_id, event.event_id);
  assert.deepEqual(lines[1], { type: "event" });
  assert.equal(lines[2].exception.values[0].value, "boom");
});

test("reports reach a Sentry-compatible endpoint and stay rate limited", async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ url: req.url, auth: req.headers["x-sentry-auth"], body });
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    ERROR_TRACKER_DSN: `http://public-key@127.0.0.1:${server.address().port}/9`,
  };
  try {
    assert.equal(reportError({ event: "x" }, {}), null, "no DSN, no request");
    const delivered = await reportError(
      {
        event: "journal_failed",
        requestId: "r-9",
        ...errorDetails(new Error("failed for zoe@example.com")),
      },
      env,
    );
    assert.equal(delivered, true);
    assert.equal(received[0].url, "/api/9/envelope/");
    assert.match(received[0].auth, /sentry_key=public-key/);
    const event = JSON.parse(received[0].body.split("\n")[2]);
    assert.equal(event.tags.request_id, "r-9");
    assert.equal(event.exception.values[0].value, "failed for [email]");
    assert.ok(event.exception.values[0].stacktrace.frames.length > 0);
    assert.doesNotMatch(received[0].body, /zoe@example\.com/);
    // The per-minute budget (30) drops the rest of a burst.
    const results = [];
    const warnings = await capture("warn", async () => {
      for (let i = 0; i < 40; i++)
        results.push(reportError({ event: "burst" }, env));
      await Promise.all(results.filter(Boolean));
    });
    assert.ok(results.filter((r) => r === null).length >= 10);
    assert.equal(warnings.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production requires an HTTPS tracker DSN when one is configured", () => {
  const base = {
    DEPLOYMENT_MODE: "production",
    POSTGRES_PASSWORD: "a".repeat(32),
    APP_ORIGIN: "https://colabike.ru",
    COOKIE_SECURE: "true",
    TRUSTED_PROXY_KEY: "b".repeat(32),
    BIKE_RESOLVER_TOKEN: "c".repeat(32),
    DATABASE_URL: "postgres://x",
    BIKE_RESOLVER_URL: "http://r",
  };
  assert.equal(validateRuntime(base).mode, "production");
  assert.equal(
    validateRuntime({
      ...base,
      ERROR_TRACKER_DSN: "https://k@errors.example.com/1",
    }).mode,
    "production",
  );
  assert.throws(
    () =>
      validateRuntime({
        ...base,
        ERROR_TRACKER_DSN: "http://k@errors.example.com/1",
      }),
    /ERROR_TRACKER_DSN/,
  );
  assert.throws(
    () => validateRuntime({ ...base, ERROR_TRACKER_DSN: "nonsense" }),
    /ERROR_TRACKER_DSN/,
  );
});
