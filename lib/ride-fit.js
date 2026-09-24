import {
  RideError,
  trackFrom,
  sensorMetrics,
  validPosition,
} from "./ride-gpx.js";

// FIT, the native format of Garmin, Wahoo, Bryton, Magene, iGPSport and Coros
// computers. Only `record` messages are read: position, time, altitude, speed,
// heart rate, cadence and power. Other messages and developer fields are
// skipped by their declared sizes; the file CRC rejects damaged uploads.
const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z
const RECORD = 20;
const TIMESTAMP = 253;
const SEMICIRCLE = 180 / 2 ** 31;
const crcTable = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001,
  0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];
/** @param {Uint8Array} bytes */
export function fitCrc(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    let tmp = crcTable[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ crcTable[bytes[i] & 0xf];
    tmp = crcTable[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ crcTable[(bytes[i] >> 4) & 0xf];
  }
  return crc;
}
/** @param {Uint8Array} bytes */
export const isFit = (bytes) =>
  bytes.length >= 12 &&
  (bytes[0] === 12 || bytes[0] === 14) &&
  String.fromCharCode(...bytes.subarray(8, 12)) === ".FIT";
// Base types by number (low five bits): size, signedness and the value that
// devices write for "no data".
const baseTypes = {
  0: [1, false, 0xff], // enum
  1: [1, true, 0x7f],
  2: [1, false, 0xff],
  3: [2, true, 0x7fff],
  4: [2, false, 0xffff],
  5: [4, true, 0x7fffffff],
  6: [4, false, 0xffffffff],
  10: [1, false, 0], // uint8z
  11: [2, false, 0],
  12: [4, false, 0],
};
const damaged = () => new RideError("Файл FIT повреждён или обрезан");
/**
 * @param {Uint8Array} bytes
 * @param {{maxBytes?: number, maxPoints?: number}} [limits]
 */
export function parseFit(
  bytes,
  { maxBytes = 10 * 1024 * 1024, maxPoints = 200000 } = {},
) {
  if (bytes.length > maxBytes)
    throw new RideError("FIT-файл слишком большой", 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points = [],
    samples = [];
  // Several FIT files may be chained one after another.
  for (let offset = 0; offset < bytes.length;) {
    if (!isFit(bytes.subarray(offset))) throw damaged();
    const headerSize = bytes[offset],
      end = offset + headerSize + view.getUint32(offset + 4, true);
    if (end + 2 > bytes.length) throw damaged();
    const headerCrc = headerSize === 14 ? view.getUint16(offset + 12, true) : 0;
    if (
      (headerCrc && headerCrc !== fitCrc(bytes, offset, offset + 12)) ||
      fitCrc(bytes, offset, end) !== view.getUint16(end, true)
    )
      throw new RideError("Файл FIT повреждён: не сходится контрольная сумма");
    const definitions = new Map();
    let at = offset + headerSize,
      last = null;
    while (at < end) {
      const header = bytes[at++];
      let local,
        time = null;
      if (header & 0x80) {
        // Compressed timestamp: five low bits of seconds after the last full one.
        local = (header >> 5) & 0x3;
        if (last === null) throw damaged();
        const low = header & 0x1f;
        time = (last & ~0x1f) + low + (low < (last & 0x1f) ? 0x20 : 0);
        last = time;
      } else if (header & 0x40) {
        if (at + 5 > end) throw damaged();
        if (bytes[at + 1] > 1) throw damaged();
        const little = bytes[at + 1] === 0,
          global = view.getUint16(at + 2, little),
          count = bytes[at + 4],
          fields = new Map();
        at += 5;
        let size = 0;
        for (let i = 0; i < count; i++, at += 3) {
          if (at + 3 > end) throw damaged();
          fields.set(bytes[at], {
            size: bytes[at + 1],
            base: bytes[at + 2] & 0x1f,
            offset: size,
          });
          size += bytes[at + 1];
        }
        if (header & 0x20) {
          if (at >= end) throw damaged();
          const developer = bytes[at++];
          for (let i = 0; i < developer; i++, at += 3) {
            if (at + 3 > end) throw damaged();
            size += bytes[at + 1];
          }
        }
        definitions.set(header & 0xf, { global, little, fields, size });
        continue;
      } else local = header & 0xf;
      const definition = definitions.get(local);
      if (!definition || at + definition.size > end) throw damaged();
      const value = (number) => {
        const field = definition.fields.get(number),
          type = field && baseTypes[field.base];
        if (!type || field.size !== type[0]) return null;
        const [size, signed, invalid] = type,
          i = at + field.offset,
          raw =
            size === 1
              ? bytes[i]
              : size === 2
                ? view.getUint16(i, definition.little)
                : view.getUint32(i, definition.little);
        if (raw === invalid) return null;
        if (!signed) return raw;
        const shift = 32 - size * 8;
        return (raw << shift) >> shift;
      };
      const stamp = value(TIMESTAMP);
      if (stamp !== null) time = last = stamp;
      if (definition.global === RECORD) {
        const altitude = value(78) ?? value(2),
          speed = value(73) ?? value(6),
          lat = value(0),
          lon = value(1),
          unix = time === null ? null : time + FIT_EPOCH_S;
        // Records without a position still carry sensors; bound them too.
        if (samples.length >= 2 * maxPoints)
          throw new RideError("Слишком много точек FIT", 413);
        samples.push({
          time: unix,
          hr: value(3),
          cadence: value(4),
          power: value(7),
          speed: speed === null ? null : speed / 1000,
        });
        if (lat !== null && lon !== null) {
          const point = {
            lat: lat * SEMICIRCLE,
            lon: lon * SEMICIRCLE,
            ele: altitude === null ? null : altitude / 5 - 500,
            time: unix,
          };
          if (!validPosition(point.lat, point.lon))
            throw new RideError("Некорректные координаты FIT");
          if (points.push(point) > maxPoints)
            throw new RideError("Слишком много точек FIT", 413);
        }
      }
      at += definition.size;
    }
    offset = end + 2;
  }
  if (!samples.length) throw new RideError("FIT не содержит записей поездки");
  if (!points.length)
    throw new RideError("В FIT нет координат: похоже, это тренировка без GPS");
  return trackFrom([points], { bytes, sensors: sensorMetrics(samples) });
}
