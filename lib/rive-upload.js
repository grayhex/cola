// Rive is binary data, never HTML/script. Runtime parsing remains isolated in
// a decorative canvas with local WASM, disabled CDN and a static fallback.
export function prepareRive(bytes) {
  if (
    bytes.length < 16 ||
    bytes.length > 1024 * 1024 ||
    bytes.readUInt32BE(0) !== 0x52495645
  )
    throw new Error("Нужен Rive runtime export .riv до 1 МБ");
  return bytes;
}
