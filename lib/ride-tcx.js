import {
  RideError,
  readXml,
  trackFrom,
  sensorMetrics,
  validPosition,
  xmlList,
  xmlNumber,
  xmlText,
  xmlTime,
} from "./ride-gpx.js";

// Garmin Training Center XML: activities (laps of tracks) and courses. Points
// without a position (before a GPS fix, indoors) still count for heart rate,
// cadence and power, but not for the route.
export function parseTcx(
  bytes,
  { maxBytes = 10 * 1024 * 1024, maxPoints = 200000 } = {},
) {
  const doc = readXml(bytes, { maxBytes, label: "TCX" });
  const root = doc.TrainingCenterDatabase;
  if (
    !root ||
    Object.keys(doc).some(
      (k) => k !== "TrainingCenterDatabase" && !k.startsWith("?"),
    )
  )
    throw new RideError(
      "Нужен файл с корневым элементом TrainingCenterDatabase",
    );
  const courses = xmlList(root.Courses).flatMap((c) => xmlList(c.Course));
  const tracks = [
    ...xmlList(root.Activities)
      .flatMap((a) => xmlList(a.Activity))
      .flatMap((a) => xmlList(a.Lap))
      .flatMap((l) => xmlList(l.Track)),
    ...courses.flatMap((c) => xmlList(c.Track)),
  ];
  const raw = tracks.map((t) => xmlList(t.Trackpoint));
  const count = raw.reduce((n, s) => n + s.length, 0);
  if (!count) throw new RideError("TCX не содержит маршрут");
  if (count > maxPoints) throw new RideError("Слишком много точек TCX", 413);
  const samples = [];
  const sections = raw.map((points) => {
    const section = [];
    for (const p of points) {
      const time = xmlTime(p.Time),
        tpx = xmlList(p.Extensions?.TPX)[0];
      samples.push({
        time,
        hr: xmlNumber(p.HeartRateBpm?.Value),
        cadence: xmlNumber(p.Cadence),
        power: xmlNumber(tpx?.Watts),
        speed: xmlNumber(tpx?.Speed),
      });
      const lat = xmlNumber(p.Position?.LatitudeDegrees),
        lon = xmlNumber(p.Position?.LongitudeDegrees);
      if (lat === null && lon === null) continue;
      if (!validPosition(lat, lon))
        throw new RideError("Некорректные координаты TCX");
      const ele = xmlNumber(p.AltitudeMeters);
      section.push({
        lat,
        lon,
        ele: Number.isFinite(ele) ? ele : null,
        time,
      });
    }
    return section;
  });
  if (!sections.some((s) => s.length))
    throw new RideError("В TCX нет координат: похоже, это тренировка без GPS");
  return trackFrom(sections, {
    bytes,
    title: String(xmlText(courses[0]?.Name) || ""),
    sensors: sensorMetrics(samples),
  });
}
