import test from "node:test";
import assert from "node:assert/strict";
import {
  rasterViewport,
  mapDefaults,
  mapStyle,
  tileTemplate,
} from "../lib/map-settings.js";
import { mapInput, settingsInput } from "../lib/admin-validation.js";
import { defaultSettings } from "../lib/site-defaults.js";
import { preferencesInput } from "../lib/social-validation.js";
test("map configuration requires safe browser URLs and compatible templates", () => {
  assert.equal(mapInput.safeParse(mapDefaults).success, true);
  for (const tileUrl of [
    "javascript:alert(1)",
    "https://user:pass@tiles.test/{z}/{x}/{y}",
    "http://tiles.test/{z}/{x}/{y}",
    "https://tiles.test/missing",
  ])
    assert.equal(
      mapInput.safeParse({ ...mapDefaults, provider: "raster", tileUrl })
        .success,
      false,
    );
  assert.equal(
    mapInput.safeParse({ ...mapDefaults, provider: "style", styleUrl: "" })
      .success,
    false,
  );
  assert.equal(mapStyle({ ...mapDefaults, enabled: false }), null);
  assert.ok(
    tileTemplate({
      ...mapDefaults,
      provider: "raster",
      tileUrl: "https://tiles.test/{z}/{x}/{y}?key={key}",
      publicKey: "a&b",
    }).endsWith("key=a%26b"),
  );
  assert.equal(
    preferencesInput.safeParse({
      preferences: {
        rideListMode: "auto",
        rideMapView: "map",
        mapScrollZoom: false,
      },
    }).success,
    true,
  );
  const oldAbout = {
    ...defaultSettings.about,
    sections: [
      ...defaultSettings.about.sections,
      { id: "history", title: "Old", visible: true, showIllustration: true },
    ],
    hiddenItems: ["metrics"],
  };
  assert.equal(
    settingsInput.safeParse({ ...defaultSettings, about: oldAbout }).success,
    true,
  );
});
test("raster preview bounds visible tiles and preserves separate privacy segments", () => {
  assert.equal(rasterViewport([]), null);
  const v = rasterViewport([
    [
      [37.5, 55.7],
      [37.51, 55.71],
    ],
    [
      [37.52, 55.72],
      [37.53, 55.73],
    ],
  ]);
  assert.equal(v.paths.length, 2);
  assert.ok(v.tiles.length <= 12);
  assert.ok(v.paths.every((p) => p.startsWith("M") && !p.includes("NaN")));
  for (const t of v.tiles) {
    assert.ok(t.x >= 0 && t.y >= 0);
    assert.ok(t.z <= 15);
  }
});

test("Yandex settings use the existing public key and validate enabled state", () => {
  const config = { ...mapDefaults, provider: "yandex", publicKey: " test-key " };
  const parsed = mapInput.parse(config);
  assert.equal(parsed.publicKey, "test-key");
  assert.equal(mapInput.safeParse({ ...config, publicKey: "  " }).success, false);
  assert.equal(mapInput.safeParse({ ...config, publicKey: "", enabled: false }).success, true);
  assert.equal(mapInput.safeParse({ ...config, publicKey: "x".repeat(501) }).success, false);
  assert.equal(mapInput.safeParse({ ...config, sdkUrl: "https://evil.test/sdk.js" }).success, false);
  assert.equal(mapInput.safeParse({ ...config, provider: "unknown" }).success, false);
  const settings = settingsInput.parse({ ...defaultSettings, map: parsed });
  assert.deepEqual(JSON.parse(JSON.stringify(settings)).map, parsed);
  assert.equal(settingsInput.safeParse(defaultSettings).success, true);
});
