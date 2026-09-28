// Node preload used only by disposable test harnesses, never shipped to production.
import { readFile } from "node:fs/promises";
import { fit, loop } from "../ride-fixtures.js";
const realFetch = globalThis.fetch;
if (process.env.COLA_RWGPS_FIXTURE === "1")
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url || input);
    if (url.origin !== "https://ridewithgps.com")
      return realFetch(input, options);
    if (url.pathname === "/oauth/token.json") {
      const { code } = JSON.parse(options.body);
      const id = Number(code);
      if (!Number.isSafeInteger(id) || id < 1)
        return new Response("", { status: 400 });
      return Response.json({
        access_token: "fixture-rwgps-" + id,
        token_type: "Bearer",
        user_id: id,
      });
    }
    if (url.pathname === "/oauth/revoke.json") return Response.json({});
    const id = Number(
      new Headers(options.headers)
        .get("authorization")
        ?.replace("Bearer fixture-rwgps-", ""),
    );
    if (!id) return new Response("", { status: 401 });
    let control = {};
    try {
      control = JSON.parse(
        await readFile(process.env.RWGPS_FIXTURE_FILE, "utf8"),
      );
    } catch {}
    const state = control[id] || {},
      tripId = id * 10 + 1;
    if (url.pathname === "/api/v1/sync.json")
      return Response.json({
        items: state.items || [
          {
            item_type: "trip",
            item_id: tripId,
            item_user_id: id,
            action: "created",
            datetime: new Date().toISOString(),
          },
        ],
        meta: { rwgps_datetime: new Date().toISOString() },
      });
    if (url.pathname === `/api/v1/trips/${tripId}.json`)
      return Response.json({
        trip: {
          id: tripId,
          user_id: id,
          name: state.name || "Тестовая велопоездка RWGPS",
          activity_type: state.activity_type || "cycling:road",
          stationary: false,
          departed_at: new Date(Date.now() - 86400000).toISOString(),
          distance: 1000,
          duration: 2400,
        },
      });
    if (url.pathname === `/api/v1/trips/${tripId}.fit`)
      return new Response(
        fit(loop.map((p) => [p[0] + (id % 1000) / 10000, p[1], p[2], p[3]])),
      );
    return new Response("", { status: 404 });
  };
