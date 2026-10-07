import { load } from "cheerio";
import { CatalogueAdapter } from "./base.js";
import { checkAbort } from "../context.js";
import { parseDocument } from "../extract.js";
import { notCompleteBike } from "../stores/classify.js";
import type { BikeCandidate, BikeQuery, SourceDocument } from "../domain.js";

// /catalog/bikes/<kind>/shulz-<model>/<variant id>. A variant is a colour or a
// size of one model; framesets live under /catalog/framesets/ and never here.
const PRODUCT = /^\/catalog\/bikes\/[a-z0-9-]+\/shulz-[a-z0-9-]+\/\d+$/;

// shulz.ru: Russian specification rows ("Рама", "Задний переключатель", ...)
// in <div class="spec"><div class="param">…</div><div class="value">…</div>.
// The page states no model year and the site has no site map: the catalogue
// of all bikes lists one card per model, with its colours as variants.
export class ShulzAdapter extends CatalogueAdapter {
  readonly id = "shulz";
  readonly brand = "SHULZ";
  readonly aliases = ["Shulz", "Шульц", "Шульц Байкс"];
  readonly allowedDomains = ["shulz.ru", "www.shulz.ru"];
  readonly origin = "https://shulz.ru";
  readonly adapterVersion = 1;
  productPath = PRODUCT;
  protected rows = { row: ".spec", label: ".param", value: ".value" };

  async discover(q: BikeQuery): Promise<BikeCandidate[]> {
    checkAbort();
    const doc = await this.document(this.origin + "/catalog/all/bikes"),
      $ = load(doc.body),
      found = new Map<string, BikeCandidate>();
    $(".product_card a.product_link").each((_, el) => {
      const href = $(el).attr("href") || "",
        name = ($(el).attr("title") || "").replace(/^\s*SHULZ\s+/i, "").trim();
      if (!PRODUCT.test(href) || !name || !this.matchesModel(name, q)) return;
      const url = this.origin + href;
      if (!found.has(url))
        found.set(url, {
          brand: this.brand,
          url,
          canonicalName: name,
          year: null,
          manufacturerProductId: href.split("/").pop(),
        });
    });
    return [...found.values()];
  }

  async parse(doc: SourceDocument, _q: BikeQuery) {
    if (!PRODUCT.test(new URL(doc.url).pathname)) throw notCompleteBike();
    const $ = load(doc.body),
      heading = $("h1")
        .filter((_, h) => $(h).find(".logo").length > 0)
        .first()
        .clone();
    heading.find(".subtitle,.logo").remove();
    return parseDocument(doc, this.rows, {
      name: heading.text().replace(/\s+/g, " ").trim() || undefined,
      year: null,
      id: new URL(doc.url).pathname.split("/").pop(),
    });
  }
}
