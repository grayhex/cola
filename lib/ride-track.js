import { RideError, parseGpx } from "./ride-gpx.js";
import { parseTcx } from "./ride-tcx.js";
import { isFit, parseFit } from "./ride-fit.js";

// Every ride upload and every stored original goes through here. The format
// comes from the bytes themselves, so originals need no format column.
/**
 * @param {Uint8Array} bytes
 * @param {{maxBytes?: number, maxPoints?: number}} [limits]
 */
export function parseTrack(bytes, limits = {}) {
  if (!bytes.length) throw new RideError("Пустой файл");
  if (isFit(bytes)) return parseFit(bytes, limits);
  // "PK\3\4": Garmin Connect exports the original FIT inside a ZIP archive.
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 3 &&
    bytes[3] === 4
  )
    throw new RideError("Распакуйте архив и загрузите файл FIT из него");
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  if (!/^(?:\uFEFF)?\s*</.test(head))
    throw new RideError("Нужен файл GPX, TCX или FIT");
  return /<(?:\w+:)?TrainingCenterDatabase[\s>]/.test(head)
    ? parseTcx(bytes, limits)
    : parseGpx(bytes, limits);
}
