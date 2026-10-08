import { coarsePoint } from "./map-settings.ts";
import {
  areaLabelMax,
  cleanLabel,
  defaultAreaRadiusM,
  nearestRadiusM,
  radiusForBox,
} from "./ride-area.ts";
import { appVersion } from "./version.js";

// Place search for choosing the area of a ride (#370). The browser asks the
// site (never a third party), the site asks the configured service: an
// OpenStreetMap Nominatim-compatible one by default, Yandex Geocoder when its
// key is set, nothing when it is off — then the area is chosen on the map or
// named by hand. What leaves the site is the typed words only, never a
// person's position; what comes back is a name and a coarse centre (0.01°).

/** One place for the list of results: a name, a line that tells it from others, a coarse area. */
export type Place = {
  label: string;
  detail: string;
  center: [number, number];
  radiusM: number;
};
export class GeocoderError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.status = status;
  }
}
type Provider = "nominatim" | "yandex" | "fixture" | "off";
export type GeocoderConfig = {
  provider: Provider;
  url: string;
  key: string;
  userAgent: string;
};
const resultLimit = 5;
export const queryMax = 100;
export const queryMin = 2;

export function geocoderConfig(
  env: Record<string, string | undefined> = process.env,
): GeocoderConfig {
  const origin = env.PUBLIC_SITE_URL || env.APP_ORIGIN || "http://localhost";
  const userAgent = `ColaBike/${appVersion?.version || "dev"} (+${origin})`;
  if (env.COLA_GEOCODER_FIXTURE === "1")
    return { provider: "fixture", url: "", key: "", userAgent };
  const wanted = (env.GEOCODER || "nominatim").toLowerCase();
  if (wanted === "off") return { provider: "off", url: "", key: "", userAgent };
  if (wanted === "yandex")
    // Without its key the service answers nothing: the search is off, not guessed.
    return env.YANDEX_GEOCODER_KEY
      ? {
          provider: "yandex",
          url: "https://geocode-maps.yandex.ru/v1/",
          key: env.YANDEX_GEOCODER_KEY,
          userAgent,
        }
      : { provider: "off", url: "", key: "", userAgent };
  return {
    provider: "nominatim",
    url: (env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(
      /\/+$/,
      "",
    ),
    key: "",
    userAgent,
  };
}

const number = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? Number(value)
    : Number.NaN;
const valid = (lon: number, lat: number) =>
  Number.isFinite(lon) &&
  Number.isFinite(lat) &&
  Math.abs(lon) <= 180 &&
  Math.abs(lat) <= 90;
const text = (value: unknown, max = 200) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

function place(
  label: string,
  detail: string,
  lon: number,
  lat: number,
  radiusM: number,
): Place | null {
  const name = cleanLabel(label).slice(0, areaLabelMax);
  if (!name || !valid(lon, lat)) return null;
  const [x, y] = coarsePoint([lon, lat]);
  return {
    label: name,
    detail: text(detail, 120),
    center: [x, y],
    radiusM: nearestRadiusM(radiusM),
  };
}
/** The answer of a Nominatim-compatible `search` (jsonv2, addressdetails). */
export function parseNominatim(rows: unknown): Place[] {
  if (!Array.isArray(rows)) return [];
  const found: Place[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const address = (
      r.address && typeof r.address === "object" ? r.address : {}
    ) as Record<string, unknown>;
    const full = text(r.display_name);
    const name = text(r.name) || text(full.split(",")[0]);
    const town = text(
      address.city || address.town || address.village || address.hamlet,
    );
    const detail =
      [town, text(address.state)].filter(Boolean).join(", ") ||
      full.split(",").slice(1).join(",").trim();
    const box = Array.isArray(r.boundingbox) ? r.boundingbox.map(number) : [];
    const item = place(
      name,
      detail,
      number(r.lon),
      number(r.lat),
      box.length === 4 ? radiusForBox(box) : defaultAreaRadiusM,
    );
    if (item) found.push(item);
  }
  return found;
}
/** The answer of the Yandex Geocoder HTTP API (format=json). */
export function parseYandex(body: unknown): Place[] {
  const members = (
    body as {
      response?: {
        GeoObjectCollection?: { featureMember?: { GeoObject?: unknown }[] };
      };
    }
  )?.response?.GeoObjectCollection?.featureMember;
  if (!Array.isArray(members)) return [];
  const found: Place[] = [];
  for (const member of members) {
    const geo = member?.GeoObject as
      | {
          name?: unknown;
          description?: unknown;
          Point?: { pos?: unknown };
          boundedBy?: {
            Envelope?: { lowerCorner?: unknown; upperCorner?: unknown };
          };
        }
      | undefined;
    if (!geo) continue;
    const [lon, lat] = text(geo.Point?.pos).split(" ").map(Number);
    const corner = (value: unknown) => text(value).split(" ").map(Number);
    const low = corner(geo.boundedBy?.Envelope?.lowerCorner),
      high = corner(geo.boundedBy?.Envelope?.upperCorner);
    const radius =
      low.length === 2 && high.length === 2
        ? radiusForBox([low[1], high[1], low[0], high[0]])
        : defaultAreaRadiusM;
    const item = place(text(geo.name), text(geo.description), lon, lat, radius);
    if (item) found.push(item);
  }
  return found;
}

// Test mode (COLA_GEOCODER_FIXTURE=1): a few places of Moscow in the shape of
// a real answer, so the parser runs too; two words make it fail or stay silent.
const fixtureRows = [
  ["Измайловский парк", "Москва", 37.75, 55.79, [55.77, 55.81, 37.71, 37.79]],
  ["Сокольники", "Москва", 37.67, 55.79, [55.78, 55.81, 37.65, 37.7]],
  ["Парк Горького", "Москва", 37.6, 55.73, [55.72, 55.74, 37.58, 37.62]],
  ["Коломенское", "Москва", 37.67, 55.67, [55.66, 55.68, 37.65, 37.7]],
  ["Крылатские холмы", "Москва", 37.43, 55.76, [55.74, 55.78, 37.4, 37.46]],
  ["Парк Победы", "Санкт-Петербург", 30.32, 59.87, [59.86, 59.88, 30.3, 30.34]],
] as const;
function fixtureAnswer(query: string) {
  const wanted = query.toLowerCase();
  if (wanted.includes("сбой"))
    throw new GeocoderError("Поиск мест временно недоступен", 502);
  return fixtureRows
    .filter(([name]) => name.toLowerCase().includes(wanted))
    .map(([name, region, lon, lat, box]) => ({
      name,
      display_name: `${name}, ${region}, Россия`,
      lon: String(lon),
      lat: String(lat),
      boundingbox: box.map(String),
      address: { city: region, state: "Россия" },
    }));
}

type Deps = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};
// The same words asked again within a few minutes are answered from memory:
// one key stroke more or less must not become a request to a shared service.
const cache = new Map<string, { at: number; places: Place[] }>();
const cacheTtl = 10 * 60 * 1000,
  cacheMax = 200;
// Public Nominatim allows one request a second for the whole site.
let nextSlot = 0;
const gap = 1100,
  longestWait = 3000;
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Forget what was asked: for tests. */
export function resetGeocoder() {
  cache.clear();
  nextSlot = 0;
}

/**
 * Places by name. An empty list for a too short question; a `GeocoderError`
 * when the service is off, busy, slow or wrong — the caller shows a message
 * and the person goes on by hand.
 */
export async function searchPlaces(
  query: string,
  deps: Deps = {},
): Promise<Place[]> {
  const words = query.replace(/\s+/g, " ").trim();
  if (words.length < queryMin) return [];
  if (words.length > queryMax)
    throw new GeocoderError("Запрос слишком длинный", 400);
  const config = geocoderConfig(deps.env),
    now = deps.now || Date.now;
  if (config.provider === "off")
    throw new GeocoderError("Поиск мест не настроен", 503);
  const key = config.provider + "|" + words.toLowerCase();
  const hit = cache.get(key);
  if (hit && now() - hit.at < cacheTtl) return hit.places;
  let places: Place[];
  if (config.provider === "fixture")
    places = parseNominatim(fixtureAnswer(words.toLowerCase())).slice(
      0,
      resultLimit,
    );
  else {
    const call = deps.fetch || fetch;
    if (config.provider === "nominatim") {
      const wait = Math.max(0, nextSlot - now());
      if (wait > longestWait)
        throw new GeocoderError("Поиск мест занят. Повторите чуть позже.", 429);
      nextSlot = Math.max(now(), nextSlot) + gap;
      if (wait) await (deps.sleep || pause)(wait);
    }
    const url =
      config.provider === "yandex"
        ? config.url +
          "?" +
          new URLSearchParams({
            apikey: config.key,
            geocode: words,
            format: "json",
            results: String(resultLimit),
            lang: "ru_RU",
          })
        : config.url +
          "/search?" +
          new URLSearchParams({
            q: words,
            format: "jsonv2",
            limit: String(resultLimit),
            addressdetails: "1",
            dedupe: "1",
            "accept-language": "ru",
          });
    let body: unknown;
    try {
      const response = await call(url, {
        headers: {
          "User-Agent": config.userAgent,
          Accept: "application/json",
          "Accept-Language": "ru",
        },
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok)
        throw new GeocoderError(
          "Поиск мест временно недоступен",
          response.status === 429 ? 429 : 502,
        );
      body = await response.json();
    } catch (error) {
      // Never the question or the address in the message: both are the person's.
      if (error instanceof GeocoderError) throw error;
      throw new GeocoderError("Поиск мест временно недоступен", 502);
    }
    places = (
      config.provider === "yandex" ? parseYandex(body) : parseNominatim(body)
    ).slice(0, resultLimit);
  }
  // The same place twice (a park and its relation) is one line.
  const seen = new Set<string>();
  places = places.filter((p) => {
    const id = p.label.toLowerCase() + p.center.join(",");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (cache.size >= cacheMax) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now(), places });
  return places;
}
