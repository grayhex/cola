import test from "node:test";
import assert from "node:assert/strict";
import {
  GeocoderError,
  geocoderConfig,
  parseNominatim,
  parseYandex,
  resetGeocoder,
  searchPlaces,
} from "../lib/geocoding.ts";

// #370: the place search. It asks only what was typed, answers with a name and
// a coarse centre, keeps nothing about the person, and fails into a message.
const nominatim = [
  {
    name: "Измайловский парк",
    display_name: "Измайловский парк, Москва, Россия",
    lat: "55.7934",
    lon: "37.7512",
    boundingbox: ["55.77", "55.82", "37.70", "37.78"],
    address: { city: "Москва", state: "Россия" },
  },
  // The same park twice (a relation and a way): one line.
  {
    name: "Измайловский парк",
    display_name: "Измайловский парк, Москва, Россия",
    lat: "55.7935",
    lon: "37.7513",
    boundingbox: ["55.77", "55.82", "37.70", "37.78"],
    address: { city: "Москва" },
  },
  // No name of its own: the first words of the full name.
  { display_name: "Тропа, Лосиный остров, Москва", lat: "55.85", lon: "37.8" },
  // Not a place: no coordinates, a coordinate out of the world.
  { name: "Нигде", lat: "x", lon: "y" },
  { name: "Далеко", lat: "95", lon: "10" },
  null,
  "text",
];
const env = {
  GEOCODER_URL: "https://geo.example/",
  PUBLIC_SITE_URL: "https://cola.example",
};
const reply = (body: unknown, init: ResponseInit = {}) =>
  Promise.resolve(Response.json(body, init));

test.beforeEach(() => resetGeocoder());

test("Nominatim answers become names with coarse centres and a radius that covers the box", () => {
  const places = parseNominatim(nominatim);
  assert.equal(places.length, 3);
  assert.deepEqual(places[0], {
    label: "Измайловский парк",
    detail: "Москва, Россия",
    center: [37.75, 55.79],
    radiusM: 3000,
  });
  assert.equal(places[2].label, "Тропа");
  assert.equal(places[2].radiusM, 3000, "no box: the default radius");
  assert.deepEqual(parseNominatim({ not: "a list" }), []);
});

test("Yandex answers are read the same way", () => {
  const places = parseYandex({
    response: {
      GeoObjectCollection: {
        featureMember: [
          {
            GeoObject: {
              name: "Парк Горького",
              description: "Москва, Россия",
              Point: { pos: "37.6012 55.7312" },
              boundedBy: {
                Envelope: {
                  lowerCorner: "37.58 55.72",
                  upperCorner: "37.62 55.74",
                },
              },
            },
          },
          { GeoObject: { name: "Без точки" } },
          {},
        ],
      },
    },
  });
  assert.deepEqual(places, [
    {
      label: "Парк Горького",
      detail: "Москва, Россия",
      center: [37.6, 55.73],
      radiusM: 1000,
    },
  ]);
  assert.deepEqual(parseYandex(null), []);
});

test("the configuration: Nominatim by default, Yandex only with its key, off when told", () => {
  assert.equal(geocoderConfig({}).provider, "nominatim");
  assert.equal(geocoderConfig({}).url, "https://nominatim.openstreetmap.org");
  assert.equal(geocoderConfig(env).url, "https://geo.example");
  assert.match(
    geocoderConfig(env).userAgent,
    /^ColaBike\/.+ \(\+https:\/\/cola\.example\)$/,
  );
  assert.equal(geocoderConfig({ GEOCODER: "yandex" }).provider, "off");
  assert.equal(
    geocoderConfig({ GEOCODER: "yandex", YANDEX_GEOCODER_KEY: "k" }).provider,
    "yandex",
  );
  assert.equal(geocoderConfig({ GEOCODER: "off" }).provider, "off");
  assert.equal(
    geocoderConfig({ COLA_GEOCODER_FIXTURE: "1" }).provider,
    "fixture",
  );
});

test("a search asks the service with the typed words only and identifies the site", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const places = await searchPlaces("  Измайловский   парк ", {
    env,
    now: () => 0,
    sleep: async () => {},
    fetch: ((url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return reply(nominatim);
    }) as unknown as typeof fetch,
  });
  assert.equal(places.length, 2, "the park once, and the path");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://geo.example/search");
  assert.equal(url.searchParams.get("q"), "Измайловский парк");
  assert.equal(url.searchParams.get("format"), "jsonv2");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.match(calls[0].headers["User-Agent"], /^ColaBike\//);
  // Nothing about the person goes along: only the words and the site's name.
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "accept-language",
    "addressdetails",
    "dedupe",
    "format",
    "limit",
    "q",
  ]);
});

test("the same words asked again are answered from memory; too short asks nothing", async () => {
  let asked = 0;
  const fetcher = (() => {
    asked++;
    return reply(nominatim);
  }) as unknown as typeof fetch;
  const deps = { env, now: () => 1000, sleep: async () => {}, fetch: fetcher };
  await searchPlaces("Сокольники", deps);
  await searchPlaces("сокольники ", deps);
  assert.equal(asked, 1);
  // After the memory has run out it asks again.
  await searchPlaces("Сокольники", {
    ...deps,
    now: () => 1000 + 11 * 60 * 1000,
  });
  assert.equal(asked, 2);
  assert.deepEqual(await searchPlaces("а", deps), []);
  assert.deepEqual(await searchPlaces("   ", deps), []);
  assert.equal(asked, 2);
  await assert.rejects(
    searchPlaces("я".repeat(101), deps),
    (e: unknown) => e instanceof GeocoderError && e.status === 400,
  );
});

test("the service failing, slow or refusing is a message, never the question", async () => {
  const deps = (fetcher: unknown) => ({
    env,
    now: () => 0,
    sleep: async () => {},
    fetch: fetcher as typeof fetch,
  });
  for (const [label, fetcher, status] of [
    ["a 500", () => reply({}, { status: 500 }), 502],
    ["a 429", () => reply({}, { status: 429 }), 429],
    ["a network error", () => Promise.reject(new Error("ECONNRESET")), 502],
    [
      "not JSON",
      () => Promise.resolve(new Response("<html>", { status: 200 })),
      502,
    ],
  ] as const) {
    resetGeocoder();
    await assert.rejects(
      searchPlaces("Секретный парк", deps(fetcher)),
      (e: unknown) =>
        e instanceof GeocoderError &&
        e.status === status &&
        !/Секретный/.test(e.message),
      label,
    );
  }
  await assert.rejects(
    searchPlaces("Парк", { env: { GEOCODER: "off" } }),
    (e: unknown) => e instanceof GeocoderError && e.status === 503,
  );
});

test("the public service is asked once a second at most", async () => {
  let clock = 0;
  const slept: number[] = [];
  const deps = {
    env,
    now: () => clock,
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    fetch: (() => reply([])) as unknown as typeof fetch,
  };
  await searchPlaces("Первый", deps);
  await searchPlaces("Второй", deps);
  await searchPlaces("Третий", deps);
  assert.deepEqual(slept, [1100, 1100]);
  // A queue longer than a few seconds is refused, not waited for.
  clock = 0;
  resetGeocoder();
  for (const word of ["a1", "a2", "a3", "a4", "a5"])
    await searchPlaces(word + "x", { ...deps, sleep: async () => {} }).catch(
      () => {},
    );
  await assert.rejects(
    searchPlaces("Лишний", { ...deps, sleep: async () => {} }),
    (e: unknown) => e instanceof GeocoderError && e.status === 429,
  );
});

test("fixture mode answers from a built-in list through the same parser", async () => {
  const fixture = { env: { COLA_GEOCODER_FIXTURE: "1" } };
  const found = await searchPlaces("измайл", fixture);
  assert.deepEqual(
    found.map((p) => [p.label, p.center, p.radiusM]),
    [["Измайловский парк", [37.75, 55.79], 3000]],
  );
  assert.deepEqual(await searchPlaces("нет такого места", fixture), []);
  await assert.rejects(
    searchPlaces("сбой поиска", fixture),
    (e: unknown) => e instanceof GeocoderError && e.status === 502,
  );
});
