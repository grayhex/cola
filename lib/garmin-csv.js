import { createHash } from "node:crypto";
import { RideError } from "./ride-gpx.js";
import { garminFields } from "./garmin-fields.js";

export function csvRows(text) {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024)
    throw new RideError("CSV: максимум 2 МБ", 413);
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const delimiter = text.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === undefined) throw new RideError("Незакрытые кавычки в CSV");
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === delimiter || c === "\n" || c === "\r" || c === undefined) {
      row.push(field);
      field = "";
      closed = false;
      if (c !== delimiter) {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"')
        throw new RideError("Некорректные кавычки в CSV");
      field += c;
    }
    if (field.length > 10000 || row.length > 100 || rows.length > 501)
      throw new RideError("CSV: максимум 500 строк и 100 полей");
  }
  return rows;
}
function numeric(value) {
  const s = value
    .trim()
    .replace(/^'/, "")
    .replaceAll(",", "")
    .replace(/[\s\u00a0]/g, "");
  if (!s || s === "--") return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) throw Error("ожидается число");
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > 1e8)
    throw Error("число вне диапазона");
  return n;
}
function duration(value) {
  if (!value.trim() || value.trim() === "--") return null;
  if (!/^\d{1,5}:\d{2}:\d{2}(?:\.\d+)?$/.test(value))
    throw Error("ожидается время ЧЧ:ММ:СС");
  const [h, m, s] = value.split(":").map(Number);
  if (m >= 60 || s >= 60) throw Error("неверное время");
  return Math.round(h * 3600 + m * 60 + s);
}
export function parseGarminCsv(
  text,
  { utcOffsetMinutes = 180, units = "metric" } = {},
) {
  if (
    !Number.isInteger(utcOffsetMinutes) ||
    utcOffsetMinutes < -720 ||
    utcOffsetMinutes > 840 ||
    !["metric", "imperial"].includes(units)
  )
    throw new RideError("Проверьте часовой пояс и единицы Garmin");
  const rows = csvRows(text);
  if (rows.length < 2) throw new RideError("CSV не содержит активностей");
  const headers = rows.shift().map((h) => h.trim());
  for (const key of ["Activity Type", "Date", "Title", "Distance", "Time"])
    if (!headers.includes(key))
      throw new RideError("Нет столбца Garmin: " + key);
  if (new Set(headers).size !== headers.length)
    throw new RideError("Повторяющиеся заголовки CSV");
  const rides = [],
    warnings = [];
  rows.forEach((values, index) => {
    try {
      if (values.length !== headers.length)
        throw Error("число полей не совпадает с заголовком");
      const row = Object.fromEntries(
        headers.map((h, i) => [h, values[i].trim()]),
      );
      if (!/cycling|biking|велосипед/i.test(row["Activity Type"])) {
        warnings.push(
          `Строка ${index + 2}: пропущена активность «${row["Activity Type"]}»`,
        );
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.Date))
        throw Error("неверная дата");
      const local = row.Date.replace(" ", "T") + "Z",
        time = Date.parse(local);
      if (
        !Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 19) !== local.slice(0, 19)
      )
        throw Error("неверная дата");
      const startedAt = new Date(time - utcOffsetMinutes * 60000).toISOString();
      const metrics = { activityDate: row.Date.slice(0, 10) };
      for (const f of garminFields) {
        const v = row[f.column];
        if (v == null || v === "" || v === "--") continue;
        let n =
          f.format === "duration"
            ? duration(v)
            : f.format === "text"
              ? v.slice(0, 100)
              : f.format === "boolean"
                ? /^(?:true|yes|да)$/i.test(v)
                : numeric(v);
        if (n == null) continue;
        if (
          typeof n === "number" &&
          n < 0 &&
          ![
            "bodyBattery",
            "minTemp",
            "maxTemp",
            "minElevationM",
            "maxElevationM",
          ].includes(f.key)
        )
          throw Error("отрицательное значение: " + f.column);
        if (f.format === "distance")
          n *= units === "imperial" ? 1609.344 : 1000;
        if (f.format === "speed") n *= units === "imperial" ? 0.44704 : 1 / 3.6;
        if (f.format === "elevation" && units === "imperial") n *= 0.3048;
        if (f.format === "temperature" && units === "imperial")
          n = ((n - 32) * 5) / 9;
        metrics[f.key] = n;
      }
      if (
        metrics.distanceM == null ||
        metrics.distanceM > 10000000 ||
        metrics.timerTimeS == null
      )
        throw Error("нет дистанции или длительности");
      metrics.distanceM = Math.round(metrics.distanceM);
      metrics.elapsedTimeS ??= metrics.timerTimeS;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            startedAt,
            metrics.distanceM,
            metrics.timerTimeS,
            metrics.activityType,
          ]),
        )
        .digest("hex");
      rides.push({
        index,
        title: (row.Title || "Покатушка Garmin").slice(0, 120),
        startedAt,
        metrics,
        fingerprint,
      });
    } catch (e) {
      throw new RideError(`Строка ${index + 2}: ${e.message}`);
    }
  });
  if (!rides.length) throw new RideError("В CSV нет велосипедных активностей");
  const availableFields = garminFields
    .filter((f) => rides.some((r) => r.metrics[f.key] != null))
    .map((f) => f.key);
  return { rides, availableFields, warnings };
}
export function assertMatchingTrack(ride, metrics) {
  const expectedTime = Date.parse(ride.started_at),
    actualTime = Date.parse(metrics.startedAt);
  if (!Number.isFinite(actualTime) || !metrics.elapsedTimeS)
    throw new RideError("Для проверки нужен трек с датой и временем точек");
  if (Math.abs(expectedTime - actualTime) > 15 * 60 * 1000)
    throw new RideError(
      "Дата или время трека не совпадают с поездкой (допуск 15 минут). Проверьте часовой пояс CSV.",
    );
  if (
    Math.abs(ride.distance_m - metrics.distanceM) >
    Math.max(500, ride.distance_m * 0.15)
  )
    throw new RideError(
      "Дистанция трека не совпадает с поездкой (допуск 15% или 500 м)",
    );
  if (
    ride.elapsed_time_s != null &&
    Math.abs(ride.elapsed_time_s - metrics.elapsedTimeS) >
      Math.max(600, ride.elapsed_time_s * 0.25)
  )
    throw new RideError(
      "Длительность трека не совпадает с поездкой (допуск 25% или 10 минут)",
    );
}
