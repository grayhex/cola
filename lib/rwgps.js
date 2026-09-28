import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { activityKey } from "./activity-credentials.js";

export class ActivityError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export function rwgpsConfig(env = process.env) {
  if (env.RWGPS_ENABLED !== "true") return null;
  if (!env.RWGPS_CLIENT_ID || !env.RWGPS_CLIENT_SECRET || !env.RWGPS_API_KEY)
    throw new ActivityError("Ride with GPS ещё не настроен", 503);
  activityKey(env);
  const origin = new URL(env.APP_ORIGIN || "http://localhost:3000");
  if (
    origin.origin !== (env.APP_ORIGIN || "http://localhost:3000") ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname))
  )
    throw new ActivityError("Некорректный адрес приложения", 503);
  return {
    clientId: env.RWGPS_CLIENT_ID,
    secret: env.RWGPS_CLIENT_SECRET,
    apiKey: env.RWGPS_API_KEY,
    redirectUri: origin.origin + "/api/activity-sync/rwgps/callback",
  };
}
export const externalId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const date = z.string().refine((v) => Number.isFinite(Date.parse(v)));
export const syncItem = z.object({
  item_type: z.string(),
  item_id: externalId,
  item_user_id: externalId,
  action: z.string(),
  datetime: date,
});
const notifications = z.object({
  notifications: z
    .array(
      z.object({
        user_id: externalId,
        item_type: z.string(),
        item_id: externalId,
        item_user_id: externalId,
        action: z.string(),
      }),
    )
    .max(100),
});
export function verifyRwgpsWebhook(bytes, signature, apiKey, config) {
  if (apiKey !== config.apiKey || !/^[a-f0-9]{64}$/i.test(signature || ""))
    throw new ActivityError("Подпись не прошла проверку", 401);
  const expected = createHmac("sha256", config.secret).update(bytes).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new ActivityError("Подпись не прошла проверку", 401);
  return notifications.parse(JSON.parse(bytes.toString("utf8"))).notifications;
}
/** Bounded HTTPS transport. Never follow upstream URLs or redirects with tokens.
 * @param {string} path
 * @param {{token?: string, body?: Record<string,unknown>, limit?: number, binary?: boolean}} options
 */
export async function rwgpsRequest(
  path,
  {
    token = "",
    body = undefined,
    limit = 8 * 1024 * 1024,
    binary = false,
  } = {},
  config = rwgpsConfig(),
) {
  if (!config) throw new ActivityError("Ride with GPS выключен", 503);
  if (!/^\/(api\/v1\/|oauth\/)[a-z0-9/_.?=&:%+-]+$/i.test(path))
    throw new ActivityError("Недопустимый API endpoint");
  let response;
  try {
    response = await fetch("https://ridewithgps.com" + path, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: binary
          ? "application/vnd.ant.fit,application/tcx+xml"
          : "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ActivityError("Ride with GPS временно недоступен");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ActivityError(
      response.status === 401
        ? "Доступ Ride with GPS отозван. Подключите заново."
        : "Ошибка Ride with GPS (" + response.status + ")",
      response.status,
    );
  }
  const reader = response.body?.getReader(),
    chunks = [];
  let size = 0;
  if (!reader) throw new ActivityError("Пустой ответ Ride with GPS");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ActivityError("Ответ Ride with GPS превышает лимит");
      }
      chunks.push(value);
    }
  } catch {
    throw new ActivityError("Не удалось получить полный ответ Ride with GPS");
  }
  const bytes = Buffer.concat(chunks);
  if (binary) return bytes;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ActivityError("Некорректный ответ Ride with GPS");
  }
}
export async function exchangeRwgpsCode(code, config) {
  return z
    .object({
      access_token: z.string().min(1).max(4096),
      user_id: externalId,
      token_type: z.string().regex(/^bearer$/i),
    })
    .parse(
      await rwgpsRequest(
        "/oauth/token.json",
        {
          body: {
            grant_type: "authorization_code",
            code,
            client_id: config.clientId,
            client_secret: config.secret,
            redirect_uri: config.redirectUri,
          },
        },
        config,
      ),
    );
}
export async function revokeRwgpsToken(token, config) {
  await rwgpsRequest(
    "/oauth/revoke.json",
    {
      body: { client_id: config.clientId, client_secret: config.secret, token },
    },
    config,
  );
}
export async function rwgpsChanges(token, since) {
  return z
    .object({
      items: z.array(syncItem).max(50000),
      meta: z.object({ rwgps_datetime: date }),
    })
    .parse(
      await rwgpsRequest(
        "/api/v1/sync.json?assets=trips&since=" + encodeURIComponent(since),
        { token },
      ),
    );
}
const metric = z
  .number()
  .finite()
  .min(0)
  .max(2_000_000_000)
  .nullable()
  .optional();
export const rwgpsTripSchema = z.object({
  id: externalId,
  user_id: externalId,
  name: z.string().max(10000),
  activity_type: z.string().nullable(),
  departed_at: date.nullable(),
  stationary: z.boolean(),
  distance: metric,
  duration: metric,
  moving_time: metric,
  elevation_gain: metric,
  elevation_loss: metric,
  avg_speed: metric,
  max_speed: metric,
  avg_hr: metric,
  max_hr: metric,
  avg_cad: metric,
  max_cad: metric,
  avg_watts: metric,
  max_watts: metric,
  calories: metric,
});
export async function rwgpsTrip(token, id) {
  const response = await rwgpsRequest(
    "/api/v1/trips/" + externalId.parse(Number(id)) + ".json",
    { token, limit: 24 * 1024 * 1024 },
  );
  return rwgpsTripSchema.parse(response.trip);
}
export async function rwgpsTrack(token, id, limit) {
  const path = "/api/v1/trips/" + externalId.parse(Number(id));
  try {
    return await rwgpsRequest(path + ".fit", { token, limit, binary: true });
  } catch (e) {
    if (![404, 406, 422].includes(e.status)) throw e;
  }
  return rwgpsRequest(path + ".tcx", { token, limit, binary: true });
}
export function rwgpsMetrics(trip) {
  const names = {
    distance: "distanceM",
    duration: "elapsedTimeS",
    moving_time: "movingTimeS",
    elevation_gain: "elevationGainM",
    elevation_loss: "elevationLossM",
    avg_speed: "avgSpeedMps",
    max_speed: "maxSpeedMps",
    avg_hr: "avgHr",
    max_hr: "maxHr",
    avg_cad: "avgCadence",
    max_cad: "maxCadence",
    avg_watts: "avgPower",
    max_watts: "maxPower",
    calories: "calories",
  };
  return Object.fromEntries(
    Object.entries(names)
      .filter(([key]) => trip[key] != null)
      .map(([key, name]) => [name, trip[key]]),
  );
}
