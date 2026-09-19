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
