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

// The name a host is registered under: the label right above its public suffix
// ("laufcycles" for "shop.laufcycles.com" and for "laufcycles.co.uk"). Only the
// suffixes a country code puts a generic second level under ("co.uk", "com.au")
// are known besides one-label ones: any other is not guessed at, and its sites
// are nobody's by name, which is the safe side. Hosting of many people's pages
// ("lauf.github.io") is a name of the host, never of the person.
const SECOND_LEVEL = /^(?:co|com|org|net|ac|gov|edu|or|ne|go)$/;
function registeredName(hostname: string) {
  const labels = hostname.replace(/\.$/, "").split(".");
  const suffix = labels.at(-1) ?? "";
  if (!suffix || /^\d+$/.test(suffix)) return undefined;
  const depth =
    suffix.length === 2 && SECOND_LEVEL.test(labels.at(-2) ?? "") ? 3 : 2;
  return labels.length >= depth ? labels.at(-depth) : undefined;
}

// The site is the brand's own: its name is the brand's, alone or with a word
// like "bikes" or "cycles" ("laufcycles.com", "propain-bikes.com"). A page of
// such a site names its model without the brand, as an official page does.
const SITE_WORD = /^(?:bikes?|bicycles?|cycles?|cycling|cyclery|velo|racing)$/;
export function brandSite(url: string, brand: string) {
  let label: string | undefined;
  try {
    label = registeredName(new URL(url).hostname)?.replaceAll("-", "");
  } catch {
    return false;
  }
  const own = brand.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return (
    label !== undefined &&
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
