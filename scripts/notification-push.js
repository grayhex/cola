import { db } from "../lib/db.ts";
import { pushConfig } from "../lib/push-config.ts";
import { runPushBatch, pushStatus } from "../lib/push-delivery.ts";
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
  });
try {
  if (process.argv.includes("--status"))
    console.log(
      JSON.stringify({
        event: "notification_push_status",
        configured: {
          registry: pushConfig().registry,
          sender: pushConfig().sender,
        },
        ...(await pushStatus(db)),
      }),
    );
  else
    do {
      try {
        console.log(
          JSON.stringify({
            event: "notification_push_batch",
            ...(await runPushBatch(db)),
          }),
        );
      } catch {
        // Never the message: a provider's error can carry an address.
        console.error(
          JSON.stringify({ event: "notification_push_unavailable" }),
        );
        if (process.argv.includes("--once")) process.exitCode = 1;
      }
      if (process.argv.includes("--once")) break;
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 5000));
    } while (!stopped);
} finally {
  await db.end();
}
