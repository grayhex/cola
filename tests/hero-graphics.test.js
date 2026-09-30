import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migrateHeroGraphics } from "../lib/hero-graphics.ts";
import { prepareRive } from "../lib/rive-upload.ts";
import { settingsInput } from "../lib/admin-validation.ts";
import { defaultSettings } from "../lib/site-defaults.ts";
import { getSite } from "../lib/site.ts";
import { bikeInput } from "../lib/validation.ts";

test("legacy graphics migrate to independent references without losing themed uploads", () => {
  const light = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    dark = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.deepEqual(
    migrateHeroGraphics({
      heroGraphicMode: "custom",
      heroAnimationLightId: light,
      heroAnimationDarkId: dark,
    }),
    {
      heroTitleAnimation: null,
      heroStageAnimation: { kind: "svg", assetId: light },
      heroStageDarkAnimation: { kind: "svg", assetId: dark },
    },
  );
  assert.deepEqual(migrateHeroGraphics({ heroGraphicMode: "custom" }), {
    heroTitleAnimation: null,
    heroStageAnimation: null,
    heroStageDarkAnimation: null,
  });
  assert.deepEqual(
    migrateHeroGraphics({ heroGraphicMode: "rive" }).heroStageAnimation,
    defaultSettings.heroStageAnimation,
  );
  assert.deepEqual(migrateHeroGraphics({ heroStageAnimation: null }), {});
});
test("settings accept local animation IDs and bounded colours; reject external sources, unknown slots and retired modes", () => {
  const valid = {
    ...defaultSettings,
    heroAnimationsEnabled: true,
    heroStageAnimation: {
      kind: "rive",
      assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    iconColors: { bike: "#Bb55Dd" },
  };
  assert.ok(settingsInput.safeParse(valid).success);
  for (const patch of [
    {
      heroStageAnimation: {
        kind: "rive",
        assetId: "https://example.com/art.riv",
      },
    },
    { heroStageAnimation: { kind: "builtin", name: "arbitrary" } },
    {
      heroStageAnimation: {
        ...valid.heroStageAnimation,
        url: "https://example.com",
      },
    },
    { heroAnimationsEnabled: "true" },
    { heroGraphicMode: "rive" },
    { iconColors: { arbitrary: "#ffffff" } },
    { iconColors: { bike: "red;display:none" } },
  ])
    assert.equal(
      settingsInput.safeParse({ ...valid, ...patch }).success,
      false,
    );
});
test("Rive upload preserves the bounded binary export and rejects disguised or oversized files", () => {
  const bytes = readFileSync(
    new URL("../assets/rive/transparent-bike.source.riv", import.meta.url),
  );
  assert.deepEqual(prepareRive(bytes), bytes);
  for (const bytes of [
    Buffer.from("<script>alert(1)</script>"),
    Buffer.from("RIVE"),
    Buffer.concat([Buffer.from([0xd2, 0xc9, 0xd6, 0xc5]), Buffer.alloc(16)]),
    Buffer.concat([Buffer.from("RIVE"), Buffer.alloc(1024 * 1024)]),
  ])
    assert.throws(() => prepareRive(bytes), /Rive/);
});
test("new bikes are public unless explicitly private; price sharing stays opt-in", () => {
  const input = {
    name: "Tourer",
    description: "",
    color: "",
    size: "",
    weight: null,
    brand: "Cube",
    model: "Travel",
    year: 2024,
    category: "road",
  };
  const bike = bikeInput.parse(input);
  assert.equal(bike.is_public, true);
  assert.equal(bike.show_bike_price, false);
  assert.equal(bike.show_component_prices, false);
  assert.equal(
    bikeInput.parse({ ...input, is_public: false }).is_public,
    false,
  );
});

test("site read upgrades old fields but an explicit new assignment wins", async () => {
  const oldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const site = await getSite({
    query: async (sql) => ({
      rows: [
        {
          version: 4,
          value: sql.includes("site_settings")
            ? {
                heroGraphicMode: "custom",
                heroAnimationLightId: oldId,
                heroStageAnimation: null,
                heroImageId: oldId,
                heroAnimationsEnabled: true,
              }
            : {},
        },
      ],
    }),
  });
  assert.equal(site.settings.heroStageAnimation, null);
  assert.equal(site.settings.heroImageId, oldId);
  assert.equal(site.settings.heroAnimationsEnabled, true);
  assert.equal("heroGraphicMode" in site.settings, false);
  assert.equal("heroAnimationLightId" in site.settings, false);
});
