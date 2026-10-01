import { db } from "../lib/db.ts";
import {
  runNotificationEmailBatch,
  notificationEmailStatus,
} from "../lib/notification-email.ts";
import { rideReminderScheduleStatus } from "../lib/ride-notifications.ts";
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
  });
try {
  if (process.argv.includes("--status"))
    console.log(
      JSON.stringify({
        event: "notification_email_status",
        statuses: await notificationEmailStatus(db),
        reminders: await rideReminderScheduleStatus(db),
      }),
    );
  else
    do {
      try {
        console.log(
          JSON.stringify({
            event: "notification_email_batch",
            ...(await runNotificationEmailBatch(db)),
          }),
        );
      } catch {
        console.error(
          JSON.stringify({ event: "notification_email_unavailable" }),
        );
        if (process.argv.includes("--once")) process.exitCode = 1;
      }
      if (process.argv.includes("--once")) break;
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 10000));
    } while (!stopped);
} finally {
  await db.end();
}
