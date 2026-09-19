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
