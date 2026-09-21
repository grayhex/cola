import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { wizardInput, createWizardBike } from "../lib/bike-wizard.js";
import { limitedOptions, bicycleName, draftId } from "../lib/wizard-options.js";
import { settingsInput } from "../lib/admin-validation.js";
import { defaultSettings } from "../lib/site-defaults.js";
test("compact catalogues filter, deduplicate and cap suggestions; optional name uses identity", () => {
  assert.match(
    draftId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(
    limitedOptions(
      Array.from({ length: 100 }, (_, i) => "Part " + i),
      "",
    ).length,
    8,
  );
  assert.deepEqual(limitedOptions(["Shimano", "Shimano", "SRAM"], "shim"), [
    "Shimano",
  ]);
  assert.equal(
    bicycleName({
      name: "",
      brand: "CUBE",
      model: "Travel",
      trim: "SL",
      year: 2020,
    }),
    "CUBE Travel SL 2020",
  );
  assert.equal(bicycleName({ name: "  Мой велосипед  " }), "Мой велосипед");
  for (const bikeLayout of ["dense", "balanced", "spacious"])
    assert(settingsInput.safeParse({ ...defaultSettings, bikeLayout }).success);
  assert(
    !settingsInput.safeParse({ ...defaultSettings, bikeLayout: "arbitrary" })
      .success,
  );
});
test("wizard atomically saves edited components, trusted provenance, mileage/privacy and deduplicates retries", async () => {
  const db = new PGlite();
  try {
    for (const m of [
      "001_initial",
      "002_admin",
      "003_factory_spec",
      "004_garage_layout",
      "005_bike_wizard",
      "006_compact_defaults",
      "007_showcase",
      "008_beta_limits",
      "009_social_core",
      "010_community",
      "011_gamification",
      "012_rides",
      "014_journal",
      "015_discovery",
      "016_product_ui",
      "017_rides_market",
    "018_articles_rsvp",
    ])
      await db.exec(
        await readFile(new URL("../db/" + m + ".sql", import.meta.url), "utf8"),
      );
    const owner = randomUUID(),
      other = randomUUID(),
      preview = randomUUID();
    for (const id of [owner, other])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [id, id + "@example.test", "Test", "hash"],
      );
    const query = { brand: "CUBE", model: "Travel", trim: "SL", year: 2020 };
    await db.query(
      "INSERT INTO resolver_previews(id,owner_id,response) VALUES($1,$2,$3)",
      [
        preview,
        owner,
        {
          status: "resolved",
          query,
          components: [{ raw: { label: "SADDLE", value: "Factory saddle" } }],
        },
      ],
    );
    const input = wizardInput.parse({
      requestId: randomUUID(),
      previewId: preview,
      bike: {
        ...query,
        name: "Cube",
        category: "road",
        description: "",
        color: "",
        size: "L",
        weight: null,
        mileage: 1234,
        is_public: true,
      },
      components: [
        {
          section: "build",
          category: "Седло",
          name: "My custom saddle",
          notes: "",
          price: 1000,
          group_id: "cockpit",
        },
      ],
    });
    const first = await createWizardBike(db, owner, input),
      again = await createWizardBike(db, owner, input);
    assert.equal(first.id, again.id);
    assert(again.repeated);
    const bike = (await db.query("SELECT * FROM bikes WHERE id=$1", [first.id]))
      .rows[0];
    assert.equal(bike.mileage, 1234);
    assert.equal(bike.is_public, true);
    assert.equal(bike.factory_spec.components[0].raw.value, "Factory saddle");
    const parts = (
      await db.query("SELECT * FROM components WHERE bike_id=$1", [first.id])
    ).rows;
    assert.equal(parts.length, 1);
    assert.equal(parts[0].name, "My custom saddle");
    await assert.rejects(
      createWizardBike(db, other, input),
      /REQUEST_CONFLICT/,
    );
    await assert.rejects(
      createWizardBike(db, other, { ...input, requestId: randomUUID() }),
      /PREVIEW_EXPIRED/,
    );
    await assert.rejects(
      createWizardBike(db, owner, {
        ...input,
        requestId: randomUUID(),
        bike: { ...input.bike, year: 2021 },
      }),
      /PREVIEW_EXPIRED/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM bikes")).rows[0].n,
      1,
    );
    await db.query(
      "UPDATE resolver_previews SET response=response || $1::jsonb WHERE id=$2",
      [JSON.stringify({ warnings: ["identity_mismatch"] }), preview],
    );
    await assert.rejects(
      createWizardBike(db, owner, { ...input, requestId: randomUUID() }),
      /Подтвердите/,
    );
    const acknowledged = await createWizardBike(db, owner, {
      ...input,
      requestId: randomUUID(),
      identityConfirmed: true,
    });
    assert(acknowledged.id);
  } finally {
    await db.close();
  }
});
