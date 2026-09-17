import { load, type CheerioAPI } from "cheerio";
import { componentType, normalizeSpecification } from "./normalize.js";
import {
  ResolverError,
  type ParsedBike,
  type SourceDocument,
} from "./domain.js";
export const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export function jsonObjects($: CheerioAPI): any[] {
  const out: any[] = [];
  const walk = (v: any, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 30) return;
    if (!Array.isArray(v)) out.push(v);
    for (const x of Object.values(v)) walk(x, depth + 1);
  }; // Parse JSON payloads only; never evaluate manufacturer JavaScript.
  $("script:not([src])").each((_, e) => {
    const text = $(e).text();
    for (const m of text.matchAll(/self\.__next_f\.push\((\[.*\])\)/g)) {
      try {
        const chunk = JSON.parse(m[1])[1];
        if (typeof chunk === "string")
          for (const line of chunk.split("\n")) {
            const colon = line.indexOf(":");
            if (colon >= 0)
              try {
                walk(JSON.parse(line.slice(colon + 1)));
              } catch {}
          }
      } catch {}
    }
  });
  $(
    'script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]',
  ).each((_, e) => {
    try {
      walk(JSON.parse($(e).text()));
    } catch {}
  });
  return out;
}
export function extractMetadata(
  doc: SourceDocument,
  options: { name?: string; year?: number | null; id?: string } = {},
): Omit<ParsedBike, "components" | "rawSpecification"> {
  const $ = load(doc.body),
    objects = jsonObjects($);
  const products = objects.filter((o) =>
    ["Product", "ProductGroup", "Bicycle"].includes(o["@type"]),
  );
  const product = products[0];
  const name = clean(
    options.name ||
      $("h1").first().text() ||
      product?.name ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().split("|")[0],
  );
  // Never use copyright, publication, crawl or request year as model year.
  const yearText = String(
    options.year ||
      product?.modelYear ||
      products
        .flatMap((p) => p.additionalProperty || [])
        .find((p) => /^(model year|year)$/i.test(p.name))?.value ||
      "",
  );
  const titleYear = (name + " " + $("title").text()).match(
    /\b(19\d{2}|20\d{2})\b/,
  );
  return {
    canonicalName: name,
    year:
      Number(yearText.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || titleYear?.[1]) ||
      null,
    manufacturerProductId:
      options.id ||
      product?.productID ||
      product?.productGroupID ||
      product?.sku,
  };
}
export function extractSpecification(
  doc: SourceDocument,
  rows?: { row: string; label: string; value: string },
): Record<string, string> {
  const $ = load(doc.body),
    raw: Record<string, string> = Object.create(null);
  const add = (label: string, value: string) => {
    label = clean(label);
    value = clean(value);
    if (!label || !value || label.length > 120 || value.length > 6000) return;
    if (raw[label] && !raw[label].split(" | ").includes(value))
      raw[label] += " | " + value;
    else if (!raw[label]) raw[label] = value;
  };
  const products = jsonObjects($).filter((o) =>
    ["Product", "ProductGroup", "Bicycle"].includes(o["@type"]),
  );
  const primary =
    products.find((p) => p["@type"] === "ProductGroup") || products[0];
  for (const v of primary?.additionalProperty || [])
    if (
      typeof v.name === "string" &&
      ["string", "number", "boolean"].includes(typeof v.value)
    )
      add(v.name, String(v.value));
  for (const p of jsonObjects($)) {
    if (Array.isArray(p.specs))
      for (const spec of p.specs)
        if (
          typeof spec.name === "string" &&
          typeof spec.description === "string"
        )
          add(spec.name, spec.description);
  }
  if (
    Object.keys(raw).filter((k) => componentType(k) !== "other").length < 3 &&
    rows
  )
    $(rows.row).each((_, e) => {
      const el = $(e);
      add(
        el.find(rows.label).first().text(),
        el
          .find(rows.value)
          .map((_, v) => $(v).text())
          .get()
          .join(" "),
      );
    });
  if (Object.keys(raw).filter((k) => componentType(k) !== "other").length < 3) {
    $("tr").each((_, e) => {
      const cols = $(e).children("th,td");
      if (
        cols.length === 2 &&
        (componentType(cols.first().text()) !== "other" ||
          /^(дополнительные аксессуары|accessories)$/i.test(
            clean(cols.first().text()),
          ))
      )
        add(cols.first().text(), cols.last().text());
    });
    $("dt").each((_, e) => {
      if (componentType($(e).text()) !== "other")
        add($(e).text(), $(e).next("dd").text());
    });
  }
  if (Object.keys(raw).filter((k) => componentType(k) !== "other").length < 3) {
    for (const p of jsonObjects($)) {
      if (Array.isArray(p.specs))
        for (const spec of p.specs)
          if (
            typeof spec.name === "string" &&
            typeof spec.description === "string"
          )
            add(spec.name, spec.description);
    }
  }
  return raw;
}
export function parseDocument(
  doc: SourceDocument,
  rows?: { row: string; label: string; value: string },
  meta: Parameters<typeof extractMetadata>[1] = {},
): ParsedBike {
  const rawSpecification = extractSpecification(doc, rows);
  const components = normalizeSpecification(rawSpecification);
  if (components.filter((c) => c.type !== "other").length < 3)
    throw new ResolverError(
      "parse_error",
      "No recognizable factory specification in manufacturer document",
    );
  return { ...extractMetadata(doc, meta), rawSpecification, components };
}
