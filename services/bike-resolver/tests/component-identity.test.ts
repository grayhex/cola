import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import pino from "pino";
import { parseDocument } from "../src/extract.js";
import { normalizeSpecification } from "../src/normalize.js";
import { CanyonAdapter } from "../src/adapters/canyon.js";
import { ManufacturerHttpClient } from "../src/http.js";
const doc = (body: string) => ({
  body,
  url: "https://www.canyon.com/example",
  hash: "fixture",
  fetchedAt: "2026-09-27T00:00:00Z",
});
it("Canyon's real fixture keeps the component title before prose and structured identity", async () => {
  const adapter = new CanyonAdapter(
    new ManufacturerHttpClient(pino({ level: "silent" }), 0),
  );
  const parsed = await adapter.parse(
    doc(
      readFileSync(
        new URL("./fixtures/canyon/product.html", import.meta.url),
        "utf8",
      ),
    ),
    { brand: "Canyon", model: "Grail", trim: null, year: 2026 },
  );
  const bar = parsed.components.find((c) => c.type === "handlebar")!;
  expect(bar.brand).toBe("Canyon");
  expect(bar.model).toBe("Cockpit CP0039");
  expect(bar.description).toMatch(
    /^Canyon Cockpit CP0039; One-piece carbon cockpit/,
  );
});
it("nested tire rows do not also create a concatenated parent component", () => {
  const parsed = parseDocument(
    doc(
      `<h2>Specifications</h2><section><h4>Tires</h4><div><div><p>Front Tire</p><p>Butcher, GRID TRAIL, 29x2.4</p></div><div><p>Rear Tire</p><p>Eliminator, GRID TRAIL, 27.5x2.4</p></div></div><div><p>Brakes</p><p>Shimano Deore M6100, hydraulic, 180mm</p></div><div><p>Pedals</p><p>Not Available</p></div></section>`,
    ),
  );
  expect(parsed.components.map((c) => c.type)).toEqual([
    "front_tire",
    "rear_tire",
    "brake",
  ]);
  expect(parsed.components[0].model).toBe("Butcher");
  expect(parsed.components[1].model).toBe("Eliminator");
  expect(parsed.components[2].model).toBe("Deore M6100");
});
it("saved raw specification splits labelled subfields, decodes entities and drops placeholders", () => {
  const parts = normalizeSpecification({
    Tires: "Front Tire: Butcher, 29x2.4; Rear Tire: Eliminator, 27.5x2.4",
    Brakes: "Shimano&#x20;Deore M6100, hydraulic, 160mm",
    Pedals: "None included",
  });
  expect(parts.map((c) => c.type)).toEqual([
    "front_tire",
    "rear_tire",
    "brake",
  ]);
  expect(parts[2].description).toBe("Shimano Deore M6100, hydraulic, 160mm");
});
