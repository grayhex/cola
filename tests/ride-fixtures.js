export function gpx(
  segments,
  { time = true, elevation = true, name = "Тестовый маршрут" } = {},
) {
  return Buffer.from(
    `<?xml version="1.0"?><gpx version="1.1"><trk><name>${name}</name>${segments.map((s) => "<trkseg>" + s.map((p, i) => `<trkpt lat="${p[1]}" lon="${p[0]}">${elevation ? `<ele>${p[3] ?? 100 + i * 2}</ele>` : ""}${time ? `<time>${new Date((p[2] ?? i * 20) * 1000 + Date.UTC(2026, 8, 16)).toISOString()}</time>` : ""}</trkpt>`).join("") + "</trkseg>").join("")}</trk></gpx>`,
  );
}
export const loop = Array.from({ length: 81 }, (_, i) => [
  37.5 + Math.sin((i / 80) * Math.PI * 2) * 0.03,
  55.7 + Math.cos((i / 80) * Math.PI * 2) * 0.02,
  i * 30,
  100 + i,
]);
const FIT_EPOCH_S = 631065600;
const semicircles = (deg) => Math.round((deg * 2 ** 31) / 180) >>> 0;
// FIT's own CRC-16 (reflected polynomial 0xA001), written out independently
// of lib/ride-fit.js so the fixtures do not trust the code under test.
export function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}
// A FIT activity like a bike computer writes it: file_id, a record definition
// and one record per point [lon, lat, seconds, elevation]. Sensors follow
// simple patterns: heart rate 100/120, cadence 90 with every fourth sample
// coasting, power 150/250 W, speed 5-7 m/s. A point with lon === null has no
// GPS fix.
export function fit(
  points,
  {
    sensors = true,
    bigEndian = false,
    compressed = false,
    developer = false,
    headerSize = 14,
  } = {},
) {
  const out = [];
  const u8 = (...v) => out.push(...v);
  const u16 = (v) =>
    bigEndian ? u8((v >> 8) & 0xff, v & 0xff) : u8(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => {
    const b = [
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff,
    ];
    u8(...(bigEndian ? b.reverse() : b));
  };
  const define = (local, global, fields, dev = false) => {
    u8(0x40 | (dev ? 0x20 : 0) | local, 0, bigEndian ? 1 : 0);
    u16(global);
    u8(fields.length);
    for (const f of fields) u8(...f);
    if (dev) u8(1, 0, 2, 0);
  };
  const sensorFields = [
    [0, 4, 0x85],
    [1, 4, 0x85],
    [78, 4, 0x86],
    [3, 1, 0x02],
    [4, 1, 0x02],
    [7, 2, 0x84],
    [73, 4, 0x86],
  ];
  define(0, 0, [
    [0, 1, 0x00],
    [4, 4, 0x86],
  ]);
  u8(0, 4);
  u32(Date.UTC(2026, 8, 16) / 1000 - FIT_EPOCH_S);
  define(1, 20, [[253, 4, 0x86], ...sensorFields], developer);
  if (compressed) define(2, 20, sensorFields, developer);
  points.forEach((p, i) => {
    const time = Date.UTC(2026, 8, 16) / 1000 + (p[2] ?? i * 20) - FIT_EPOCH_S;
    if (compressed && i > 0) u8(0x80 | (2 << 5) | (time & 0x1f));
    else {
      u8(1);
      u32(time);
    }
    u32(p[0] === null ? 0x7fffffff : semicircles(p[1]));
    u32(p[0] === null ? 0x7fffffff : semicircles(p[0]));
    u32(Math.round(((p[3] ?? 100 + i) + 500) * 5));
    u8(sensors ? 100 + (i % 2) * 20 : 0xff, sensors ? (i % 4 ? 90 : 0) : 0xff);
    u16(sensors ? 150 + (i % 2) * 100 : 0xffff);
    u32(sensors ? (5 + (i % 3)) * 1000 : 0xffffffff);
    if (developer) u8(0xab, 0xcd);
  });
  const header = [headerSize, 0x20, 0x54, 0x08];
  const size = out.length;
  header.push(
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 24) & 0xff,
  );
  header.push(...Buffer.from(".FIT"));
  if (headerSize === 14) {
    const c = crc16(header);
    header.push(c & 0xff, c >> 8);
  }
  const file = [...header, ...out];
  const c = crc16(file);
  return Buffer.from([...file, c & 0xff, c >> 8]);
}
// A TCX activity with the same points; the first sample waits for GPS.
export function tcx(
  points,
  { sensors = true, course = false, name = "Круг" } = {},
) {
  const point = (p, i) =>
    `<Trackpoint><Time>${new Date((p[2] ?? i * 20) * 1000 + Date.UTC(2026, 8, 16)).toISOString()}</Time>` +
    (p[0] === null
      ? ""
      : `<Position><LatitudeDegrees>${p[1]}</LatitudeDegrees><LongitudeDegrees>${p[0]}</LongitudeDegrees></Position><AltitudeMeters>${p[3] ?? 100 + i}</AltitudeMeters>`) +
    (sensors
      ? `<HeartRateBpm><Value>${100 + (i % 2) * 20}</Value></HeartRateBpm><Cadence>${i % 4 ? 90 : 0}</Cadence><Extensions><ns3:TPX><ns3:Speed>${5 + (i % 3)}</ns3:Speed><ns3:Watts>${150 + (i % 2) * 100}</ns3:Watts></ns3:TPX></Extensions>`
      : "") +
    "</Trackpoint>";
  const track = `<Track>${points.map(point).join("")}</Track>`;
  const body = course
    ? `<Courses><Course><Name>${name}</Name>${track}</Course></Courses>`
    : `<Activities><Activity Sport="Biking"><Id>2026-09-16T00:00:00Z</Id><Lap StartTime="2026-09-16T00:00:00Z">${track}</Lap></Activity></Activities>`;
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">${body}</TrainingCenterDatabase>`,
  );
}
