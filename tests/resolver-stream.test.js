import test from "node:test";
import assert from "node:assert/strict";
import { safeTrace, readResolverStream } from "../lib/resolver-stream.js";
test("trace whitelist strips internal metadata and unsafe hostnames", () => {
  assert.deepEqual(
    safeTrace({
      type: "event",
      event: "source_connected",
      elapsedMs: 2,
      host: "127.0.0.1",
      stack: "secret",
      html: "<p>secret</p>",
      reason: "unknown",
      ip: "10.0.0.1",
    }),
    { type: "event", event: "source_connected", elapsedMs: 2 },
  );
  assert.equal(safeTrace({ type: "event", event: "arbitrary" }), null);
});
test("NDJSON decoder handles split UTF-8 and cancels reader after final consumption", async () => {
  const bytes = new TextEncoder().encode(
    '{"type":"result","result":{"name":"Велосипед"}}\n',
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(new Uint8Array([b]));
    },
    cancel() {
      cancelled = true;
    },
  });
  for await (const value of readResolverStream(stream)) {
    assert.equal(value.result.name, "Велосипед");
    break;
  }
  assert.equal(cancelled, true);
});
test("decoder rejects truncated streams", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"partial":'));
      c.close();
    },
  });
  await assert.rejects(async () => {
    for await (const value of readResolverStream(stream)) void value;
  }, /Incomplete/);
});
