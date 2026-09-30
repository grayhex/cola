import test from "node:test";
import assert from "node:assert/strict";
import { factoryEntries } from "../lib/factory-components.ts";
import {
  componentIdentity,
  componentText,
} from "../services/bike-resolver/src/component-identity.js";

const part = (type, value, extra = {}) => ({
  type,
  description: value,
  raw: { label: type, value },
  attributes: {},
  ...extra,
});
test("factory identities separate model names from dimensions, descriptions and missing equipment", () => {
  for (const size of [160, 180])
    assert.equal(
      componentIdentity(
        part("brake", `Shimano Deore M6100, гидравлический, диск ${size}мм`),
      ).name,
      "Shimano Deore M6100",
    );
  assert.equal(
    componentIdentity(
      part(
        "tire",
        '"Maxxis Icon 29x2.2" EXO/TR 60TPI, возможно использовать бескамерно',
      ),
    ).name,
    "Maxxis Icon",
  );
  assert.equal(
    componentIdentity(part("tire", "Schwalbe G-One RS Evo, 40-622")).name,
    "Schwalbe G-One RS Evo",
  );
  assert.equal(
    componentIdentity(part("rear_hub", "Shimano Alfine SG-S7001-11, 11-speed"))
      .name,
    "Shimano Alfine SG-S7001-11",
  );
  const canyon = factoryEntries({
    components: [
      part(
        "handlebar",
        "Canyon Cockpit CP0039; One-piece carbon cockpit with specialist gravel ergonomics and design; Material: Carbon (CF)",
      ),
    ],
  })[0];
  assert.equal(canyon.value.name, "Canyon Cockpit CP0039");
  assert.match(canyon.value.notes, /One-piece carbon cockpit/);
  assert.equal(
    componentIdentity(
      part(
        "handlebar",
        "One-piece carbon cockpit with specialist gravel ergonomics",
        { brand: "Canyon", model: "Cockpit CP0039" },
      ),
    ).name,
    "Canyon Cockpit CP0039",
  );
  for (const v of ["Not Available", "Unspecified", "None included", "N/A", "-"])
    assert.equal(
      factoryEntries({ components: [part("headset", v)] }).length,
      0,
      v,
    );
  assert.equal(
    componentText("Shimano&#x20;Deore&nbsp;M6100 &amp; &#32; XT™"),
    "Shimano Deore M6100 & XT",
  );
  for (const value of [
    "интегрированная, внутренняя проводка, закрытый подшипник",
    "Specialized, 6061 alloy",
    "Canyon One-piece carbon cockpit with specialist gravel ergonomics and design",
  ]) {
    const entry = factoryEntries({ components: [part("headset", value)] })[0];
    assert.equal(entry.value.name, value);
    assert.equal(entry.brand, "");
  }
});
test("flattened front/rear tires are distinct installations with short product identities", () => {
  const entries = factoryEntries({
    components: [
      part(
        "tire",
        "Front Tire: Butcher, GRID TRAIL casing, Gripton T9 compound, 29X2.4: : Rear Tire: Eliminator, GRID TRAIL casing, GRIPTON® T7 compound, TLR, S1-S2: 27.5",
      ),
    ],
  });
  assert.deepEqual(
    entries.map((e) => [e.value.category, e.value.name]),
    [
      ["Передняя покрышка", "Specialized Butcher"],
      ["Задняя покрышка", "Specialized Eliminator"],
    ],
  );
  assert.match(entries[0].value.notes, /29X2.4/);
  assert.doesNotMatch(entries[0].value.notes, /Eliminator|Rear Tire/);
  assert.doesNotMatch(entries[1].value.notes, /Butcher|Front Tire/);
});
