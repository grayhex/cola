import { load } from "cheerio";
import { normalize } from "./normalize.js";
import type { BikeQuery } from "./domain.js";
import type { ManufacturerHttpClient } from "./http.js";
// Public catalogue index, not guessed trim names or specifications from snippets.
export async function archiveLinks(
  http: ManufacturerHttpClient,
  query: BikeQuery,
): Promise<string[]> {
  if (query.year === null) return [];
  const origin = "https://bikepedia.azurewebsites.net";
  const url = new URL("/QuickBike/Bikes.aspx", origin);
  url.searchParams.set("year", String(query.year));
  url.searchParams.set("brand", query.brand);
  const doc = await http.get(url.href, ["bikepedia.azurewebsites.net"]),
    $ = load(doc.body);
  const model = normalize(query.model).split(" ").filter(Boolean),
    trim = normalize(query.trim || "")
      .split(" ")
      .filter(Boolean);
  return [
    ...new Set(
      $("a[href]")
        .toArray()
        .map((el) => {
          const href = $(el).attr("href") || "",
            name = normalize($(el).text());
          const words = new Set(name.split(" "));
          if (!model.every((t) => words.has(t))) return null;
          try {
            const u = new URL(href, doc.url);
            if (
              u.origin !== origin ||
              !/^\/QuickBike\/BikeSpecs\.aspx$/i.test(u.pathname)
            )
              return null;
            return {
              url: u.href,
              score: trim.filter((t) => words.has(t)).length,
            };
          } catch {
            return null;
          }
        })
        .filter((v): v is { url: string; score: number } => !!v)
        .sort((a, b) => b.score - a.score)
        .map((v) => v.url),
    ),
  ].slice(0, 6);
}
