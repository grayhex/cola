import type { SourceDocument } from "./domain.js";
// Only tracking parameters are removed. Product/variant selectors remain intact.
export function sourceIdentity(input: string) {
  const url = new URL(input);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_.+|srsltid|gclid|fbclid|msclkid)$/i.test(key))
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

// The site is the brand's own: its name is the brand's, alone or with a word
// like "bikes" or "cycles" ("laufcycles.com", "propain-bikes.com"). A page of
// such a site names its model without the brand, as an official page does.
const SITE_WORD = /^(?:bikes?|bicycles?|cycles?|cycling|cyclery|velo|racing)$/;
export function brandSite(url: string, brand: string) {
  let label: string;
  try {
    label = new URL(url).hostname
      .replace(/^www\./, "")
      .split(".")[0]
      .replaceAll("-", "");
  } catch {
    return false;
  }
  const own = brand.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return (
    own.length > 0 &&
    (label === own ||
      (own.length >= 3 &&
        label.startsWith(own) &&
        SITE_WORD.test(label.slice(own.length))))
  );
}

// A page read from a plainer address than the candidate's own (a build is a
// word of the address, not a page of the shop) still carries those words, so the
// parser and the provenance know which build it is.
export function withAddressWords(
  doc: SourceDocument,
  asked: string,
  read: string,
): SourceDocument {
  const own = new URL(read).searchParams,
    final = new URL(doc.url);
  for (const [key, value] of new URL(asked).searchParams)
    if (!own.has(key)) final.searchParams.set(key, value);
  return final.href === doc.url ? doc : { ...doc, url: final.href };
}
