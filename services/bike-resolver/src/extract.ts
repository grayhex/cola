import { load, type CheerioAPI } from "cheerio";
import { componentType, normalize, normalizeComponent } from "./normalize.js";
import {
  ResolverError,
  type ParsedBike,
  type SourceDocument,
  type RawField,
} from "./domain.js";
import { trace, EXTRACTOR_VERSION } from "./context.js";
import { profileFor } from "./profiles.js";
export { EXTRACTOR_VERSION };
export const QUALITY = {
  minimumComponents: 3,
  completeComponents: 8,
  completeCoverage: 0.65,
} as const;
export const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const sectionName =
  /^(technical specifications|specifications|specs|components|componentry|build|equipment|технические характеристики|характеристики|комплектация|компоненты|оборудование|spezifikationen|ausstattung|komponenten)$/i;
const excluded =
  /^(geometry|shipping|delivery|warranty|reviews|description|sizing guide|доставка|гарантия|отзывы|геометрия)$/i;
const metadataName =
  /^(weight|net weight|вес|weight size|available sizes|sizes|размеры|wheel size|диаметр кол[её]с|color|colour|bike color|цвет|product id|model year|year|сезон|год)$/i;
type Rows = { row: string; label: string; value: string };
export function jsonObjects($: CheerioAPI): any[] {
  const out: any[] = [];
  let visited = 0;
  const walk = (v: any, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 30 || visited++ > 30000) return;
    if (!Array.isArray(v)) out.push(v);
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  $("script:not([src])").each((_, e) => {
    const text = $(e).text();
    if (
      $(e).is(
        'script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]',
      )
    ) {
      try {
        walk(JSON.parse(text));
      } catch {}
    }
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
  return out;
}
const isProduct = (o: any) =>
  [o["@type"]]
    .flat()
    .some((t) => ["Product", "ProductGroup", "Bicycle"].includes(t));
function metadata(
  doc: SourceDocument,
  $: CheerioAPI,
  objects: any[],
  options: { name?: string; year?: number | null; id?: string } = {},
) {
  const products = objects.filter(isProduct),
    product =
      products.find((p) => p["@type"] === "ProductGroup") || products[0];
  const name = clean(
    options.name ||
      $("h1").first().text() ||
      product?.name ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().split("|")[0],
  );
  const yearText = String(
    options.year ||
      product?.modelYear ||
      products
        .flatMap((p) =>
          Array.isArray(p.additionalProperty) ? p.additionalProperty : [],
        )
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
export function extractMetadata(
  doc: SourceDocument,
  options: Parameters<typeof metadata>[3] = {},
): Omit<ParsedBike, "components" | "rawSpecification"> {
  const $ = load(doc.body);
  return metadata(doc, $, jsonObjects($), options);
}
function pipeline(doc: SourceDocument, rows?: Rows) {
  const $ = load(doc.body),
    objects = jsonObjects($),
    profile = profileFor(doc.url, doc.body);
  // Explanatory popovers are not part of a specification label/value.
  $('[role="tooltip"], .tooltip, script, style')
    .filter((_, el) => !$(el).is("script"))
    .remove();
  let primarySpecTable: any = null;
  const fields: RawField[] = [],
    sections = new Set<any>();
  const known = (label: string) =>
    componentType(label) !== "other" || metadataName.test(label);
  const validLabel = (label: string) =>
    label.length <= 120 && !excluded.test(label);
  const inSection = (el: any) =>
    $(el)
      .parents()
      .addBack()
      .toArray()
      .some((e) => sections.has(e));
  // Explicit profiles remain tiny semantic hints; generic strategies do the extraction.
  for (const selector of profile.sections || [])
    $(selector).each((_, e) => {
      sections.add(e);
    });
  $("h1,h2,h3,h4,h5,h6,summary").each((_, el) => {
    if (!sectionName.test(clean($(el).text()))) return;
    const level = Number(el.tagName?.slice(1)) || 3;
    let node = $(el).next();
    while (node.length) {
      const tag =
        node.get(0)?.type === "tag" ? (node.get(0) as any).tagName : "";
      if (/^h[1-6]$/.test(tag) && Number(tag.slice(1)) <= level) break;
      sections.add(node.get(0));
      node = node.next();
    }
    // Accordion headings often sit inside a small title wrapper; find the nearest
    // bounded container with real key/value content, never the entire body.
    let parent = $(el).parent();
    for (
      let i = 0;
      i < 3 && parent.length && !parent.is("body,html,main");
      i++, parent = parent.parent()
    ) {
      const labels = parent
        .find("p,dt,th,strong,b")
        .filter((_, x) => known(clean($(x).text()))).length;
      if (labels >= 3) {
        sections.add(parent.get(0));
        break;
      }
    }
  });
  if (sections.size) trace("spec_section_found", { count: sections.size });
  if (objects.length) trace("structured_data_found", { count: objects.length });
  const add = (
    label: string,
    value: string,
    strategy: string,
    confidence: number,
    context = false,
  ) => {
    label = clean(label).replace(/[:：]\s*$/, "");
    value = clean(value);
    if (
      !label ||
      !value ||
      known(value) ||
      !validLabel(label) ||
      value.length > 6000 ||
      label === value ||
      fields.length >= 600
    )
      return;
    if (!known(label) && !context) return;
    fields.push({
      label,
      value,
      strategy,
      confidence,
      ...(context ? { section: "specification" } : {}),
    });
  };
  const run = (name: string, fn: () => void) => {
    trace("extractor_started", { strategy: name });
    const n = fields.length;
    fn();
    trace("fields_extracted", { strategy: name, count: fields.length - n });
  };
  run("structured", () => {
    const products = objects.filter(isProduct),
      primary =
        products.find((p) => p["@type"] === "ProductGroup") || products[0];
    for (const v of Array.isArray(primary?.additionalProperty)
      ? primary.additionalProperty
      : [])
      if (
        typeof v.name === "string" &&
        ["string", "number", "boolean"].includes(typeof v.value)
      )
        add(v.name, String(v.value), "structured", 0.82, true);
  });
  run("embedded", () => {
    for (const p of objects)
      for (const key of [
        "specs",
        "specifications",
        "technicalSpecifications",
      ]) {
        if (!Array.isArray(p[key])) continue;
        for (const v of p[key]) {
          const label = v?.name || v?.label;
          const value = v?.description || v?.value;
          if (typeof label === "string" && typeof value === "string")
            add(label, value, "embedded", 0.8, true);
        }
      }
  });
  run("table", () => {
    const tables = $("table")
      .toArray()
      .map((table) => ({
        table,
        score: $(table)
          .find("tr")
          .filter(
            (_, row) =>
              $(row).closest("table").get(0) === table &&
              componentType(clean($(row).children("td,th").first().text())) !==
                "other",
          ).length,
      }))
      .sort((a, b) => b.score - a.score);
    const primary = tables[0]?.score >= 3 ? tables[0].table : null;
    primarySpecTable = primary;
    $("tr").each((_, el) => {
      if (
        primary &&
        $(el).closest("table").get(0) !== primary &&
        !inSection(el)
      )
        return;
      const cols = $(el).children("td,th");
      if (
        cols.length !== 2 ||
        cols.first().find("table").length ||
        cols.last().find("table").length
      )
        return;
      add(
        cols.first().text(),
        cols.last().text(),
        "table",
        0.95,
        inSection(el),
      );
    });
  });
  run("definition-list", () => {
    $("dt").each((_, el) =>
      add(
        $(el).text(),
        $(el).next("dd").text(),
        "definition-list",
        0.95,
        inSection(el),
      ),
    );
  });
  run("repeated-block", () => {
    $("div,li").each((_, el) => {
      const children = $(el).children();
      if (
        children.length !== 2 ||
        !children.first().is("p,span,dt,th,strong,b") ||
        children
          .first()
          .find("div,ul,table,p,h1,h2,h3,h4,h5,input,button,select").length ||
        children.last().find("input,button,select").length
      )
        return;
      const label = clean(children.first().text()).replace(/[:：]\s*$/, "");
      if (metadataName.test(label) && !inSection(el)) return;
      if (
        metadataName.test(label) &&
        primarySpecTable &&
        $(el).closest("table").get(0) !== primarySpecTable
      )
        return;
      if (label.length <= 120)
        add(
          label,
          children.last().text(),
          "repeated-block",
          0.92,
          inSection(el),
        );
    });
  });
  run("heading-value", () => {
    $("h3,h4,h5,strong,b,p").each((_, el) => {
      const label = clean($(el).text());
      if (!known(label)) return;
      let anchor = $(el);
      if (anchor.is("b,strong") && anchor.parent().is("p"))
        anchor = anchor.parent();
      const next = anchor.next();
      if (!next.length || next.is("script,style,h1,h2,h3,h4,h5,h6")) return;
      if (next.is("ul,ol")) {
        add(
          label,
          next
            .children("li")
            .map((_, li) => $(li).text())
            .get()
            .join("; "),
          "bullet-list",
          0.93,
          inSection(el),
        );
        return;
      }
      if (inSection(el)) add(label, next.text(), "heading-value", 0.9, true);
    });
  });
  // Shopify and other stores place HTML descriptions inside JSON product data.
  // Parse that inert HTML, never evaluate a script or fetch embedded resources.
  run("shopify-description", () => {
    if (profile.framework !== "shopify") return;
    for (const product of objects.filter(isProduct)) {
      const html = product.description;
      if (
        typeof html !== "string" ||
        html.length > 100000 ||
        !/<(?:p|ul|strong|b)\b/i.test(html)
      )
        continue;
      const fragment = load(html);
      fragment("p,strong,b").each((_, el) => {
        const label = clean(fragment(el).text());
        if (!known(label)) return;
        let anchor = fragment(el);
        if (anchor.is("b,strong") && anchor.parent().is("p"))
          anchor = anchor.parent();
        if (anchor.next().is("ul,ol"))
          add(label, anchor.next().text(), "shopify-description", 0.72);
      });
    }
  });
  if (rows)
    run("profile", () => {
      let n = 0;
      $(rows.row).each((_, el) => {
        const e = $(el);
        const label = e.find(rows.label).first().text(),
          value = e
            .find(rows.value)
            .map((_, v) => $(v).text())
            .get()
            .join(" ");
        if (label && value) n++;
        add(label, value, "profile", 0.9, true);
      });
      if (!n) trace("fallback_started", { reason: "selector_profile_failed" });
    });
  const chosen = new Map<string, RawField>(),
    conflicts: RawField[] = [];
  for (const field of fields) {
    const type = componentType(field.label),
      key = type === "other" ? normalize(field.label) : type;
    const old = chosen.get(key);
    if (!old) {
      chosen.set(key, field);
      continue;
    }
    if (normalize(old.value) === normalize(field.value)) {
      if (field.confidence > old.confidence) chosen.set(key, field);
      continue;
    }
    const loser = field.confidence > old.confidence ? old : field;
    if (field.confidence > old.confidence) chosen.set(key, field);
    if (
      !conflicts.some((c) => c.label === loser.label && c.value === loser.value)
    )
      conflicts.push(loser);
  }
  return { $, objects, chosen: [...chosen.values()], conflicts };
}
export function extractSpecification(
  doc: SourceDocument,
  rows?: Rows,
): Record<string, string> {
  return Object.fromEntries(
    pipeline(doc, rows).chosen.map((f) => [f.label, f.value]),
  );
}
export function parseDocument(
  doc: SourceDocument,
  rows?: Rows,
  meta: Parameters<typeof extractMetadata>[1] = {},
): ParsedBike {
  const result = pipeline(doc, rows),
    rawSpecification = Object.fromEntries(
      result.chosen.map((f) => [f.label, f.value]),
    );
  trace("normalization_started");
  const componentFields = result.chosen.filter(
    (f) => componentType(f.label) !== "other",
  );
  const unknownFields = result.chosen.filter(
    (f) => componentType(f.label) === "other" && !metadataName.test(f.label),
  );
  if (componentFields.length < QUALITY.minimumComponents) {
    const bodyText = clean(result.$("body").text());
    const reason =
      !componentFields.length &&
      bodyText.length < 300 &&
      result.$("script").length
        ? "js_shell"
        : componentFields.length
          ? "labels_unrecognized"
          : "spec_fields_not_found";
    throw new ResolverError(
      "parse_error",
      "No useful product specification",
      false,
      reason,
    );
  }
  const components = componentFields.map((f) => ({
    ...normalizeComponent(f.label, f.value),
    provenance: {
      sourceUrl: doc.url,
      strategy: f.strategy,
      confidence: f.confidence,
      rawLabel: f.label,
      rawValue: f.value,
    },
  }));
  const totalFields = componentFields.length + unknownFields.length,
    coverage = components.length / totalFields;
  const quality = {
    level:
      components.length >= QUALITY.completeComponents &&
      coverage >= QUALITY.completeCoverage
        ? ("complete" as const)
        : ("partial" as const),
    totalFields,
    recognizedComponents: components.length,
    unknownFields: unknownFields.length,
    coverage,
    strategies: [...new Set(result.chosen.map((f) => f.strategy))],
  };
  const suggestedMetadata: Record<string, string | number> = {};
  for (const f of result.chosen.filter((f) => metadataName.test(f.label))) {
    const key = normalize(f.label);
    if (/^(weight|net weight|вес)$/.test(key)) {
      suggestedMetadata.weightText = f.value;
      const weights = [
        ...f.value.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:kg|кг)\b/gi),
      ].map((m) => Number(m[1].replace(",", ".")));
      if (weights.length === 1 && weights[0] >= 1 && weights[0] <= 100)
        suggestedMetadata.weight = weights[0];
    } else if (/^(sizes|available sizes|размеры)$/.test(key))
      suggestedMetadata.sizes = f.value;
    else if (/^(wheel size|диаметр кол[её]с)$/.test(key))
      suggestedMetadata.wheelSize = f.value;
    else if (/^(color|colour|bike color|цвет)$/.test(key))
      suggestedMetadata.color = f.value;
    else if (key === "product id")
      suggestedMetadata.manufacturerProductId = f.value;
  }
  const warnings = result.conflicts.length
    ? ["conflicting_sources" as const]
    : [];
  if (warnings.length)
    trace("conflict_found", {
      count: result.conflicts.length,
      reason: "conflicting_sources",
    });
  trace("components_recognized", {
    count: components.length,
    total: totalFields,
  });
  return {
    ...metadata(doc, result.$, result.objects, meta),
    rawSpecification,
    components,
    quality,
    suggestedMetadata,
    unknownFields: [...unknownFields, ...result.conflicts],
    warnings,
  };
}
