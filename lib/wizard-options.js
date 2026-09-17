export function limitedOptions(options, value, limit = 8) {
  const query = value.trim().toLocaleLowerCase();
  return [...new Set(options)]
    .filter((x) => !query || x.toLocaleLowerCase().includes(query))
    .slice(0, limit);
}
export function bicycleName(bike) {
  return (
    bike.name.trim() ||
    [bike.brand, bike.model, bike.trim, bike.year].filter(Boolean).join(" ")
  ).slice(0, 100);
}
// getRandomValues also works on private-network HTTP installations without randomUUID.
export function draftId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
