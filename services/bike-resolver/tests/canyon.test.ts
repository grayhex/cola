import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CanyonAdapter } from "../src/adapters/canyon.js";
import type { ManufacturerHttpClient } from "../src/http.js";

// canyon.com marks a new model with a badge inside the heading, written without
// a space: "Grail CF SLX 8 AXS" is read as "Grail CF SLX 8 AXSNew".
const url =
  "https://www.canyon.com/en-nl/gravel-bikes/race/grail/cf-slx/grail-cf-slx-8-axs/4505.html";
const recorded = readFileSync(
  new URL("./fixtures/canyon/product.html", import.meta.url),
  "utf8",
);
const badged = recorded.replace(
  /(<h1[^>]*>[\s\S]*?)(\s*<\/h1>)/,
  '$1<span class="productDescription__badge">New</span>$2',
);
const doc = (body: string) => ({
  url,
  body,
  hash: "fixture",
  fetchedAt: "2026-10-07T00:00:00.000Z",
});
const adapter = new CanyonAdapter({} as ManufacturerHttpClient);
const query = { brand: "Canyon", model: "Grail", trim: null, year: null };

describe("Canyon names", () => {
  it("the recorded page is named by its heading", async () => {
    expect(badged).toContain("New</span>");
    const parsed = await adapter.parse(doc(recorded), query);
    expect(parsed.canonicalName).toBe("Grail CF SLX 8 AXS");
  });
  it("a «New» badge glued to the heading is not part of the name", async () => {
    const parsed = await adapter.parse(doc(badged), query);
    expect(parsed.canonicalName).toBe("Grail CF SLX 8 AXS");
    const found = adapter["candidateMetadata"](doc(badged), query);
    expect(found.canonicalName).toBe("Grail CF SLX 8 AXS");
  });
  it("a name that really ends in a separate word New keeps it", async () => {
    const spaced = recorded.replace(
      /(<h1[^>]*>\s*)Grail CF SLX 8 AXS/,
      "$1Grail CF SLX 8 AXS New",
    );
    const parsed = await adapter.parse(doc(spaced), query);
    expect(parsed.canonicalName).toBe("Grail CF SLX 8 AXS New");
  });
});
