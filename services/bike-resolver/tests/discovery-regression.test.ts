import { it, expect } from "vitest";
import { MeridaAdapter, meridaYear } from "../src/adapters/merida.js";
import { SpecializedAdapter } from "../src/adapters/specialized.js";
import { archiveLinks } from "../src/archive-search.js";
import { findCandidates } from "../src/candidates.js";
import { SettingsStore } from "../src/settings.js";
import { ManualSources } from "../src/manual.js";
import type { ManufacturerHttpClient } from "../src/http.js";
const doc = (url: string, body: string) => ({
  url,
  body,
  hash: url,
  fetchedAt: new Date().toISOString(),
});
const specs =
  "<table><tr><td>Frame</td><td>Aluminium</td></tr><tr><td>Fork</td><td>Carbon</td></tr><tr><td>Brakes</td><td>Shimano GRX</td></tr></table>";
it("Merida Silex 2022 offers actual archive trims and ignores unrelated years in navigation", async () => {
  const urls: string[] = [];
  const http = {
    get: async (url: string) => {
      urls.push(url);
      if (url.includes("bikefinder"))
        return doc(
          url,
          [
            ["silex-200", 2022],
            ["silex-400", 2022],
            ["silex-700", 2024],
            ["esilex-400", 2022],
          ]
            .map(
              ([name, year], i) =>
                `<div class="bike-card"><div class="variant-img"><a href="/en/bike/archive/${3100 + i}/${name}"><img alt="${String(name).replace("-", " ")}" src="https://merida-cdn.m-c-g.net/merida-v2/crud-card/master/bikes/${year}/${name}_MY${year}.tif"></a></div></div>`,
            )
            .join(""),
        );
      return doc(
        url,
        `<nav>2021</nav><h1>${url.split("/").at(-1)?.replace("-", " ")}</h1><img class="bike-variant-header-image" src="https://merida-cdn.m-c-g.net/merida-v2/crud-zoom-img/master/bikes/2022/SILEX_400_MY2022.tif">${specs}`,
      );
    },
  } as ManufacturerHttpClient;
  const adapter = new MeridaAdapter(http),
    settings = new SettingsStore();
  settings.value.retailerSearch = false;
  const result = await findCandidates(
    { brand: "Merida", model: "Silex", trim: null, year: 2022 },
    [adapter],
    http,
    new ManualSources(http, [adapter], settings),
    settings,
  );
  expect(result.status).toBe("ambiguous");
  if (result.status !== "ambiguous") throw Error("missing choices");
  expect(result.candidates.map((c) => c.canonicalName)).toEqual(
    expect.arrayContaining(["silex 200", "silex 400"]),
  );
  expect(
    result.candidates.some((c) => c.canonicalName.startsWith("esilex")),
  ).toBe(false);
  expect(result.candidates.every((c) => c.year === 2022 && c.selectable)).toBe(
    true,
  );
  expect(urls[0]).toContain("/bikefinder/archive?query=Silex");
  expect(
    meridaYear(
      doc("https://www.merida-bikes.com/en/bike/1/a", "<nav>2022</nav>"),
    ),
  ).toBeNull();
});
it("Specialized Stumpjumper s works 2024 matches reordered product words in manufacturer search", async () => {
  const url =
    "https://www.specialized.com/us/en/s-works-stumpjumper-evo-t-type/p/224676";
  const http = {
    get: async (u: string) =>
      doc(
        u,
        u.includes("/search?")
          ? `<a href="${url}">2024 S-Works Stumpjumper EVO T-Type</a>`
          : u.endsWith("xml")
            ? "<urlset/>"
            : `<h1>2024 S-Works Stumpjumper EVO T-Type</h1>${specs}`,
      ),
  } as ManufacturerHttpClient;
  const adapter = new SpecializedAdapter(http),
    settings = new SettingsStore();
  settings.value.retailerSearch = false;
  const query = {
    brand: "Specialized",
    model: "Stumpjumper s works",
    trim: null,
    year: 2024,
  };
  const result = await findCandidates(
    query,
    [adapter],
    http,
    new ManualSources(http, [adapter], settings),
    settings,
  );
  expect(result.status).toBe("ambiguous");
  if (result.status !== "ambiguous") throw Error("missing choices");
  expect(result.candidates[0].url).toBe(url);
  expect(result.candidates[0].year).toBe(2024);
});
it("GT Avalanche 2009 discovers real trim links from the year/brand archive and parses each product", async () => {
  const http = {
    get: async (url: string) => {
      if (url.includes("bing"))
        return doc(
          url,
          "<rss><channel><item><title>Unrelated</title><link>https://unrelated.test/</link></item></channel></rss>",
        );
      if (url.includes("Bikes.aspx"))
        return doc(
          url,
          '<h6><a href="BikeSpecs.aspx?item=18609">Avalanche 1.0 Disc</a></h6><h6><a href="BikeSpecs.aspx?item=18613">Avalanche 3.0 Disc</a></h6><a href="https://evil.test/BikeSpecs.aspx?item=1">Avalanche</a>',
        );
      return doc(
        url,
        `<h4 id="ContentPlaceHolder1_ProductTitle">2009 GT Avalanche ${url.includes("18609") ? "1.0" : "3.0"} Disc</h4><section id="ContentPlaceHolder1_Specifications">${specs}</section>`,
      );
    },
  } as ManufacturerHttpClient;
  const query = { brand: "GT", model: "Avalanche", trim: null, year: 2009 };
  expect(await archiveLinks(http, query)).toHaveLength(2);
  const settings = new SettingsStore();
  const result = await findCandidates(
    query,
    [],
    http,
    new ManualSources(http, [], settings),
    settings,
  );
  expect(result.status).toBe("ambiguous");
  if (result.status !== "ambiguous") throw Error("missing choices");
  expect(result.candidates).toHaveLength(2);
  expect(
    result.candidates.every(
      (c) => c.year === 2009 && c.sourceHost === "bikepedia.azurewebsites.net",
    ),
  ).toBe(true);
});
