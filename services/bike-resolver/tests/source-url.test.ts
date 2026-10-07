import { describe, expect, it } from "vitest";
import { brandSite, sourceIdentity } from "../src/source-url.js";

describe("brandSite", () => {
  it("knows a brand's own site by its name, alone or with a word like bikes", () => {
    for (const [url, brand] of [
      ["https://www.laufcycles.com/product/lauf-seigla", "Lauf"],
      ["https://www.propain-bikes.com/us/bikes/gravel/terrel-cf/", "Propain"],
      ["https://aribikes.com/products/shafer", "Ari"],
      ["https://3t.bike/exploro", "3T"],
      ["https://www.giant-bicycles.com/gb/revolt-2", "Giant"],
      ["https://www.rosebikes.com/p/rose-x-1", "ROSE"],
    ] as const)
      expect(brandSite(url, brand), url).toBe(true);
  });
  it("does not take a shop, a marketplace or a longer name for the brand's site", () => {
    for (const [url, brand] of [
      ["https://www.decathlon.ca/en/p/grvl-af", "Van Rysel"],
      ["https://arizonabikeshop.com/", "Ari"],
      ["https://www.bike24.com/p1", "Bike"],
      ["https://racycles.com/collections/3t-bikes", "3T"],
      ["https://laufs.example/", "Lauf"],
      ["not a url", "Lauf"],
    ] as const)
      expect(brandSite(url, brand), url).toBe(false);
  });
  it("takes the name under the public suffix, so a subdomain of the brand's own site is the brand's", () => {
    for (const [url, brand] of [
      ["https://shop.laufcycles.com/p/seigla", "Lauf"],
      ["https://uk.propain-bikes.com/terrel-cf", "Propain"],
      ["https://www.rosebikes.co.uk/p/x", "ROSE"],
      ["https://laufcycles.co.uk/", "Lauf"],
      ["https://www.laufcycles.com./p/seigla", "Lauf"],
    ] as const)
      expect(brandSite(url, brand), url).toBe(true);
  });
  it("does not take somebody else's site for the brand's because one label of its host looks like the name", () => {
    for (const [url, brand] of [
      // a subdomain on a site the brand does not own
      ["https://laufcycles.example.com/seigla", "Lauf"],
      ["https://giant-bikes.example.co.uk/revolt", "Giant"],
      // hosting of many people's pages
      ["https://lauf.github.io/seigla", "Lauf"],
      ["https://propain.blogspot.com/terrel", "Propain"],
      ["https://propain-bikes.myshopify.com/terrel", "Propain"],
      // the name in the wrong place
      ["https://laufcycles.com.example.test/", "Lauf"],
      ["https://example.test/laufcycles.com/", "Lauf"],
      // an address has no name; a bare suffix is nobody's
      ["https://203.0.113.7/", "113"],
      ["https://co.uk/", "Co"],
    ] as const)
      expect(brandSite(url, brand), url).toBe(false);
  });
});

describe("sourceIdentity", () => {
  it("drops tracking and keeps the variant", () => {
    expect(sourceIdentity("https://a.test/p?utm_source=x&variant=2#top")).toBe(
      "https://a.test/p?variant=2",
    );
  });
});
