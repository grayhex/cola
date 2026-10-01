import { db, transaction } from "../lib/db.ts";
import { selectBikeWeek } from "../lib/bike-week.ts";
let stopped = false;
let wake;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopped = true;
    wake?.();
  });
try {
  do {
    try {
      const result = await transaction((q) => selectBikeWeek(q));
      console.log(
        JSON.stringify({
          event: "bike_week_tick",
          week: result?.week,
          status: result?.status,
        }),
      );
    } catch {
      console.error(JSON.stringify({ event: "bike_week_unavailable" }));
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (process.argv.includes("--once") || stopped) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 60000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } while (!stopped);
} finally {
  await db.end();
}
