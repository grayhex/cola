import { load } from "cheerio";
import type { ManufacturerHttpClient } from "./http.js";
import { normalize } from "./normalize.js";
import type { BikeQuery } from "./domain.js";

export function searchLinks(
  xml: string,
  query?: BikeQuery,
  limit = 3,
): string[] {
  const $ = load(xml, { xml: true });
  const words = (value: string | null | undefined) =>
    normalize(value ?? "")
      .split(" ")
      .filter(Boolean);
  const model = query ? normalize(query.model).split(" ") : [];
  // The trim and the brand tell the page of this bike from a review, a shop's
  // collection or another bike of the model that mention the same model.
  const trim = query ? words(query.trim) : [],
    brand = query ? words(query.brand) : [];
  const entries = $("item")
    .toArray()
    .slice(0, 30)
    .map((e) => {
      const url = $(e).find("link").text().trim();
      const text = normalize($(e).find("title,description").text() + " " + url);
      const whole = new Set(text.split(" "));
      const score = model.filter((t) => text.includes(t)).length;
      return {
        url,
        described: !!$(e).find("title,description").text().trim(),
        score,
        fit:
          score +
          trim.filter((t) => whole.has(t)).length +
          brand.filter((t) => whole.has(t)).length / 2,
      };
    })
    .filter(
      (e) =>
        e.url.length <= 2048 && (!model.length || !e.described || e.score > 0),
    )
    .sort((a, b) => b.fit - a.fit);
  return [...new Set(entries.map((e) => e.url))].slice(0, limit);
}
// Web search only suggests addresses; each one is fetched and verified before
// it may be offered. An unavailable engine is a failure of this source, not an
// empty answer; a reply that is not a feed (a challenge page) is empty.
export async function webLinks(
  http: ManufacturerHttpClient,
  query: BikeQuery,
  limit = 3,
): Promise<string[]> {
  const words = [query.brand, query.model, query.trim, query.year]
    .filter(Boolean)
    .join(" ");
  const search = new URL("https://www.bing.com/search");
  search.searchParams.set("format", "rss");
  search.searchParams.set("q", words + " bicycle specifications");
  const doc = await http.get(search.href, ["www.bing.com", "bing.com"]);
  return /<rss[\s>]/i.test(doc.body) ? searchLinks(doc.body, query, limit) : [];
}
