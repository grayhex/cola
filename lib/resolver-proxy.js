import { randomUUID } from "node:crypto";
import { bikeResolverClient } from "./bike-resolver-client.js";
import { db } from "./db.js";
// Caller must authenticate, validate origin/input and consume the resolver rate limit.
export function resolverProxy(req, input, ownerId, preview = true) {
  const abort = new AbortController(),
    signal = AbortSignal.any([req.signal, abort.signal]);
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          for await (const item of bikeResolverClient.stream(input, signal)) {
            signal.throwIfAborted();
            if (
              preview &&
              item.type === "result" &&
              item.result.status === "resolved"
            ) {
              const previewId = randomUUID();
              await db.query(
                "DELETE FROM resolver_previews WHERE expires_at<now()",
              );
              await db.query(
                "INSERT INTO resolver_previews(id,owner_id,response) VALUES($1,$2,$3)",
                [previewId, ownerId, item.result],
              );
              item.result = { ...item.result, previewId };
            }
            if (!signal.aborted)
              controller.enqueue(encoder.encode(JSON.stringify(item) + "\n"));
          }
          if (!signal.aborted) controller.close();
        } catch {
          if (!signal.aborted) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "result",
                  result: {
                    status: "upstream_unavailable",
                    query: input,
                    brand: input.brand,
                    retryable: true,
                    cached: false,
                    reason: "connection_failed",
                  },
                }) + "\n",
              ),
            );
            controller.close();
          }
        }
      },
      cancel() {
        abort.abort();
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
