import { load } from "cheerio";
import { ShopifyAdapter, type ShopifyHit } from "./shopify.js";
import { extractMetadata, jsonObjects, parseDocument } from "../extract.js";
import { normalize } from "../normalize.js";
import { jsonRecords } from "../json-values.js";
import type {
  BikeCandidate,
  BikeQuery,
  ParsedBike,
  SourceDocument,
} from "../domain.js";

const YEAR = /\b(20\d{2})\b/;
// "Cyclone Pro - 3rd Twitter Carbon Road Bike" -> "Cyclone Pro 3rd". The shop's
// clearance listings start with a delivery promise that is no part of the name.
export function twitterName(title: string) {
  return (
    title
      .replace(/^[^\p{L}\p{N}]*FREE SHIPPING[^-–—]*[-–—]\s*/iu, "")
      .replace(/\s*[-–—]?\s*(?:Twitter|Cyctrac)\b.*$/i, "")
      .replace(
        /\s+(?:carbon|alloy|aluminum)\s+(?:aero\s+)?(?:road|gravel|mountain)\s+bike\b.*$/i,
        "",
      )
      .replace(/\s+[-–—]\s+/g, " ")
      .replace(/[\s\-–—]+$/, "")
      .replace(/\s+/g, " ")
      .trim() || title.trim()
  );
}
const slug = (label: string) => normalize(label).replaceAll(" ", "-");
// "Cyclone Pro 3rd - 105 Di2 2x12": the same words and signs as the page's own
// name goes through the extractor, so a choice keeps its name once verified.
const buildName = (name: string, label: string) =>
  `${name} - ${label.replaceAll("×", "x")}`;
// "2*12" and "2×12" are one gear count.
const tokens = (s: string) =>
  new Set(
    normalize(s.replace(/[*×x](?=\d)/gi, " "))
      .split(" ")
      .filter(Boolean),
  );

// The specification table is shared by all builds of a product. A cell that
// differs by build holds one line per build, each led by a <span>"label:"</span>.
function specTable($: ReturnType<typeof load>) {
  return $("table")
    .filter((_, table) =>
      $(table)
        .find("td")
        .toArray()
        .some((td) => /^frame$/i.test($(td).text().trim())),
    )
    .first();
}
export function buildLabels(html: string): string[] {
  const $ = load(html),
    labels: string[] = [];
  specTable($)
    .find("td span")
    .each((_, span) => {
      const text = $(span).text().trim();
      if (text.endsWith(":") && !labels.includes(text.slice(0, -1).trim()))
        labels.push(text.slice(0, -1).trim());
    });
  return labels;
}

// twitterbikeusa.com is the official US shop of TWITTER's importer. The
// manufacturer's own site (twitterbike.com) publishes empty specification
// tables, so this shop is the only source that states what a model is built
// from. One product page offers several builds ("System Configuration"); each
// is its own choice and is never merged with another.
export class TwitterAdapter extends ShopifyAdapter {
  readonly id = "twitter";
  readonly brand = "TWITTER";
  readonly aliases = ["Twitter Bikes", "Twitter Bike", "Twitter Cycles"];
  readonly sourceKind = "distributor" as const;
  readonly allowedDomains = ["twitterbikeusa.com", "www.twitterbikeusa.com"];
  readonly origin = "https://twitterbikeusa.com";
  readonly adapterVersion = 1;
  protected rows = {
    row: "tr",
    label: "td:first-child",
    value: "td:last-child",
  };

  protected isBike(hit: ShopifyHit) {
    return (
      /\b(?:bike|mtb)\b|\bemtb\b/i.test(hit.type) &&
      !/spare|accessor|upgrade|kit|protection/i.test(hit.type) &&
      !/frame\s*set|frameset/i.test(hit.title)
    );
  }
  protected nameOf(hit: ShopifyHit) {
    return twitterName(hit.title);
  }
  protected yearOf(hit: ShopifyHit) {
    return Number(YEAR.exec(hit.title)?.[1]) || null;
  }
  protected candidatesOf(hit: ShopifyHit): BikeCandidate[] {
    const builds = buildLabels(hit.body);
    if (builds.length < 2) return super.candidatesOf(hit);
    const [base] = super.candidatesOf(hit);
    return builds.map((label) => ({
      ...base,
      url: `${base.url}?build=${slug(label)}`,
      canonicalName: buildName(base.canonicalName, label),
    }));
  }

  // The build of a page: the one named in the address, the one of a pasted
  // `?variant=` link, otherwise the first (and then the person is told).
  private chosenBuild(
    doc: SourceDocument,
    labels: string[],
    objects: Record<string, unknown>[],
  ) {
    const url = new URL(doc.url),
      named = url.searchParams.get("build"),
      byName = labels.find((label) => slug(label) === named);
    if (byName) return { label: byName, guessed: false };
    const variant = url.searchParams.get("variant");
    if (variant) {
      const group = objects.find((o) => o["@type"] === "ProductGroup"),
        groupName = typeof group?.name === "string" ? group.name : "",
        options: string[] = [];
      let option: string | undefined;
      // A variant is named "<product> - <build> / <colour> / <size>".
      for (const v of jsonRecords(group?.hasVariant)) {
        const name = typeof v.name === "string" ? v.name : "";
        if (!groupName || !name.startsWith(groupName)) continue;
        const build = name
          .slice(groupName.length)
          .replace(/^\s*[-–—]\s*/, "")
          .split(" / ")[0]
          .trim();
        if (!options.includes(build)) options.push(build);
        if (String(v["@id"] ?? "").includes("variant=" + variant))
          option = build;
      }
      if (option !== undefined) {
        // The builds come in the same order on both sides; when their number
        // differs, the words decide (the longest label inside the option).
        const wanted = tokens(option),
          byWords = labels
            .filter((label) => [...tokens(label)].every((t) => wanted.has(t)))
            .sort((a, b) => tokens(b).size - tokens(a).size)[0],
          label =
            options.length === labels.length
              ? labels[options.indexOf(option)]
              : byWords;
        if (label) return { label, guessed: false };
      }
    }
    return { label: labels[0], guessed: labels.length > 1 };
  }

  async parse(doc: SourceDocument, _q: BikeQuery): Promise<ParsedBike> {
    const $ = load(doc.body),
      objects = jsonObjects($),
      table = specTable($),
      labels = buildLabels($.html(table));
    const group = objects.find((o) => o["@type"] === "ProductGroup"),
      title =
        (typeof group?.name === "string" && group.name) ||
        extractMetadata(doc).canonicalName ||
        "";
    const build = labels.length
      ? this.chosenBuild(doc, labels, objects)
      : undefined;
    if (build) {
      // Keep this build's line in every cell that differs by build; the other
      // builds' lines are dropped before extraction, never merged.
      table.find("td").each((_, td) => {
        const cell = $(td);
        if (!cell.find("span").length) return;
        const lines = (cell.html() ?? "").split(/<br\s*\/?>/i);
        const kept = lines.flatMap((line) => {
          const m = /^\s*<span[^>]*>\s*([^<]*?)\s*:\s*<\/span>([\s\S]*)$/.exec(
            line,
          );
          return m
            ? m[1] === build.label
              ? [m[2].trim()]
              : []
            : [line.trim()];
        });
        cell.html(kept.join(" "));
      });
    }
    const name = twitterName(title);
    const scoped: SourceDocument = {
      ...doc,
      body: `<html><head><title>${name}</title></head><body><h1>${name}</h1>${$.html(table)}</body></html>`,
    };
    const parsed = parseDocument(scoped, this.rows, {
      name: build && labels.length > 1 ? buildName(name, build.label) : name,
      year: Number(YEAR.exec(title)?.[1]) || null,
    });
    return build?.guessed
      ? {
          ...parsed,
          warnings: [...(parsed.warnings ?? []), "multiple_builds" as const],
        }
      : parsed;
  }
}
