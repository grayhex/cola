import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocument } from "../src/extract.js";
import { decodeDocument } from "../src/charset.js";
import { sourceIdentity } from "../src/source-url.js";
import { withResolution, abortable } from "../src/context.js";
import { SourcePlanner } from "../src/planner.js";
const doc = (body: string, url = "https://example.com/bike") => ({
  body,
  url,
  hash: "fixture",
  fetchedAt: "2026-09-19T00:00:00Z",
});
const fixture = (name: string) =>
  readFileSync(
    new URL("./fixtures/layouts/" + name + ".html", import.meta.url),
    "utf8",
  );
const pairs = [
  ["Frame", "Alloy"],
  ["Fork", "Fox Rhythm"],
  ["Rear Derailleur", "Shimano XT"],
];
it("extracts the live Specialized semantic layout independent of generated class names", () => {
  const result = parseDocument(
    doc(
      fixture("specialized").replace(/class="[^"]*"/g, ""),
      "https://www.specialized.com/product",
    ),
  );
  expect(result.components.map((c) => c.type)).toEqual(
    expect.arrayContaining([
      "frame",
      "rear_shock",
      "fork",
      "front_brake",
      "rear_brake",
      "shifter",
      "rear_derailleur",
      "cassette",
      "chain",
      "crankset",
      "bottom_bracket",
      "rim",
      "front_hub",
      "rear_hub",
      "front_tire",
      "rear_tire",
      "stem",
      "handlebar",
      "grips",
      "saddle",
      "seatpost",
      "seat_clamp",
    ]),
  );
  expect(result.suggestedMetadata?.weight).toBe(16.55);
  expect(result.quality?.level).toBe("complete");
  expect(
    result.components.every((c) => c.provenance?.rawValue === c.raw.value),
  ).toBe(true);
});
it("extracts real Trial-Sport Russian table including separate brakes", () => {
  const result = parseDocument(doc(fixture("trial")));
  expect(result.components).toHaveLength(19);
  expect(result.components.map((c) => c.type)).toEqual(
    expect.arrayContaining([
      "frame",
      "fork",
      "front_brake",
      "rear_brake",
      "rear_derailleur",
    ]),
  );
});
it("extracts generic Shopify heading/bullet lists without product URL rules", () => {
  const result = parseDocument(
    doc(fixture("twitter"), "https://another-shop.example/products/bike"),
  );
  expect(result.components.map((c) => c.type)).toEqual(
    expect.arrayContaining([
      "frame",
      "fork",
      "rear_derailleur",
      "crankset",
      "cassette",
      "chain",
      "brake",
      "hub",
      "rim",
      "tire",
    ]),
  );
  expect(result.components).toHaveLength(17);
  expect(result.year).toBeNull();
  expect(result.suggestedMetadata?.weight).toBeUndefined();
});
for (const [name, body] of [
  [
    "table",
    "<table><tr><td><table>" +
      pairs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("") +
      "</table></td></tr></table>",
  ],
  [
    "definition-list",
    "<dl>" +
      pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") +
      "</dl>",
  ],
  [
    "repeated-block",
    pairs.map(([k, v]) => `<div><p>${k}</p><p>${v}</p></div>`).join(""),
  ],
  [
    "structured",
    '<script type="application/ld+json">' +
      JSON.stringify({
        "@type": "ProductGroup",
        additionalProperty: pairs.map(([name, value]) => ({ name, value })),
      }) +
      "</script>",
  ],
  [
    "embedded",
    '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify({
        props: {
          product: {
            specifications: pairs.map(([name, value]) => ({ name, value })),
          },
        },
      }) +
      "</script>",
  ],
  [
    "bullet-list",
    pairs.map(([k, v]) => `<p><b>${k}</b></p><ul><li>${v}</li></ul>`).join(""),
  ],
] as const)
  it("extracts " + name + " with an honest partial quality", () => {
    const result = parseDocument(doc(body));
    expect(result.components).toHaveLength(3);
    expect(result.quality?.level).toBe("partial");
    expect(result.quality?.strategies).toContain(name);
  });
it("retains unknown fields, ignores marketing and metadata, and preserves conflicting evidence", () => {
  const html =
    "<h2>Specifications</h2><section><dl>" +
    [
      ...pairs,
      ["Mystery fitting", "ACME 42"],
      ["Weight", "12.5 kg"],
      ["Color", "Red"],
      ["Shipping", "Free"],
      ["Warranty", "Lifetime"],
      ["Reviews", "Wonderful"],
      ["Geometry", "Long"],
    ]
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("") +
    '</dl></section><script type="application/ld+json">' +
    JSON.stringify({
      "@type": "Product",
      additionalProperty: [{ name: "Fork", value: "Suntour Other" }],
    }) +
    "</script>";
  const result = parseDocument(doc(html));
  expect(result.components).toHaveLength(3);
  expect(result.components.find((c) => c.type === "fork")?.raw.value).toBe(
    "Fox Rhythm",
  );
  expect(result.unknownFields?.map((f) => f.value)).toEqual(
    expect.arrayContaining(["ACME 42", "Suntour Other"]),
  );
  expect(result.warnings).toContain("conflicting_sources");
  expect(result.suggestedMetadata).toMatchObject({
    weight: 12.5,
    color: "Red",
  });
  expect(result.rawSpecification).not.toHaveProperty("Shipping");
});
it("refuses marketing-only pages and identifies a JS shell", () => {
  expect(() =>
    parseDocument(
      doc(
        "<h1>Dream bike</h1><h2>Shipping</h2><p>Fork out less money</p><h2>Geometry</h2><p>Great bike</p>",
      ),
    ),
  ).toThrow();
  try {
    parseDocument(doc('<div id="app"></div><script src="app.js"></script>'));
  } catch (e: any) {
    expect(e.reason).toBe("js_shell");
  }
});
it("decodes Windows-1251 from meta and honors header precedence; unsupported charset is explicit", () => {
  const bytes = Buffer.concat([
    Buffer.from('<meta charset="windows-1251"><dl><dt>'),
    Buffer.from("d0e0ece0", "hex"),
    Buffer.from("</dt><dd>Alloy</dd></dl>"),
  ]);
  expect(decodeDocument(bytes, "text/html").body).toContain("Рама");
  expect(
    decodeDocument(
      Buffer.from('<meta charset="windows-1251">Рама'),
      "text/html; charset=utf-8",
    ).body,
  ).toContain("Рама");
  expect(() => decodeDocument(bytes, "text/html; charset=unknown")).toThrow();
});
it("strips tracking without losing variant or product identity", () => {
  expect(
    sourceIdentity(
      "https://example.com/b?a=42&utm_source=x&srsltid=y&color=blue#spec",
    ),
  ).toBe("https://example.com/b?a=42&color=blue");
});
it("bounds source fanout, falls back, and stops after a useful result", async () => {
  const query = { brand: "Test", model: "Bike", trim: null, year: 2026 },
    events: any[] = [],
    called: string[] = [];
  const result = await withResolution(
    new AbortController().signal,
    (e) => events.push(e),
    () =>
      new SourcePlanner().resolve(query, [
        {
          id: "manual",
          kind: "manual",
          resolve: async () => {
            called.push("manual");
            return { status: "resolved", query, cached: false } as any;
          },
        },
        {
          id: "official",
          kind: "manufacturer",
          resolve: async () => {
            called.push("official");
            return {
              status: "parse_error",
              query,
              brand: "Test",
              cached: false,
              retryable: false,
              reason: "spec_fields_not_found",
            };
          },
        },
      ]),
  );
  expect(result.status).toBe("resolved");
  expect(called).toEqual(["official", "manual"]);
  expect(events.map((e) => e.event)).toContain("fallback_started");
});
it("abort cancels a pending operation promptly", async () => {
  const controller = new AbortController();
  const pending = abortable(new Promise(() => {}), controller.signal);
  controller.abort();
  await expect(pending).rejects.toBeDefined();
});
