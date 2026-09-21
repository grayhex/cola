// Shared presentation contract. Importers retain numeric values, never CSV markup.
export const garminFields = [
  ["distanceM", "Дистанция", "Distance", "distance"],
  ["elapsedTimeS", "Полное время", "Elapsed Time", "duration"],
  ["movingTimeS", "В движении", "Moving Time", "duration"],
  ["timerTimeS", "Время таймера", "Time", "duration"],
  ["avgSpeedMps", "Средняя скорость", "Avg Speed", "speed"],
  ["maxSpeedMps", "Максимальная скорость", "Max Speed", "speed"],
  ["elevationGainM", "Набор высоты", "Total Ascent", "elevation"],
  ["elevationLossM", "Спуск", "Total Descent", "elevation"],
  ["minElevationM", "Минимальная высота", "Min Elevation", "elevation"],
  ["maxElevationM", "Максимальная высота", "Max Elevation", "elevation"],
  ["calories", "Калории", "Calories", "kcal"],
  ["avgHr", "Средний пульс", "Avg HR", "bpm"],
  ["maxHr", "Максимальный пульс", "Max HR", "bpm"],
  ["aerobicTe", "Аэробный эффект", "Aerobic TE", "number"],
  ["avgCadence", "Средний каденс", "Avg Bike Cadence", "rpm"],
  ["maxCadence", "Максимальный каденс", "Max Bike Cadence", "rpm"],
  [
    "normalizedPower",
    "Нормализованная мощность",
    "Normalized Power® (NP®)",
    "watt",
  ],
  [
    "trainingStress",
    "Тренировочная нагрузка",
    "Training Stress Score®",
    "number",
  ],
  ["power20min", "Мощность за 20 минут", "Max Avg Power (20 min)", "watt"],
  ["avgPower", "Средняя мощность", "Avg Power", "watt"],
  ["maxPower", "Максимальная мощность", "Max Power", "watt"],
  ["strokes", "Обороты педалей", "Total Strokes", "number"],
  ["bodyBattery", "Body Battery", "Body Battery Drain", "number"],
  ["minTemp", "Минимальная температура", "Min Temp", "temperature"],
  ["maxTemp", "Максимальная температура", "Max Temp", "temperature"],
  ["bestLapS", "Лучший круг", "Best Lap Time", "duration"],
  ["laps", "Круги", "Number of Laps", "number"],
  ["activityType", "Тип активности", "Activity Type", "text"],
  ["favorite", "Избранное Garmin", "Favorite", "boolean"],
  ["decompression", "Декомпрессия", "Decompression", "boolean"],
].map(([key, label, column, format]) => ({ key, label, column, format }));
export const defaultRideFields = [
  "distanceM",
  "movingTimeS",
  "avgSpeedMps",
  "elevationGainM",
];
export function formatRideMetric(value, format) {
  if (value == null) return null;
  if (format === "text") return String(value);
  if (format === "boolean") return value ? "Да" : "Нет";
  if (format === "duration")
    return `${Math.floor(value / 3600)}:${String(Math.floor((value % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  const units = {
    distance: "км",
    elevation: "м",
    speed: "км/ч",
    kcal: "ккал",
    bpm: "уд/мин",
    rpm: "об/мин",
    watt: "Вт",
    temperature: "°C",
  };
  const n =
    format === "distance"
      ? value / 1000
      : format === "speed"
        ? value * 3.6
        : value;
  return (
    n.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) +
    (units[format] ? " " + units[format] : "")
  );
}
