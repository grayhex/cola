// Wall-clock input is interpreted only in the explicit IANA zone, never the host zone.
export class IntentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const intentLimits = Object.freeze({
  active: 5,
  windows: 4,
  horizonDays: 90,
  windowHours: 24,
});
export function validTimeZone(zone) {
  if (typeof zone !== "string" || zone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return zone === "UTC" || zone.includes("/");
  } catch {
    return false;
  }
}
export function localDateTime(instant, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Enumerate actual instants. Gaps yield none; folds yield two and need an explicit choice.
export function localInstants(local, zone) {
  if (!validTimeZone(zone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new IntentError("Укажите дату, время и IANA-часовой пояс");
  const nominal = Date.parse(local + ":00Z");
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 16) !== local
  )
    throw new IntentError("Некорректная дата или время");
  const offsets = new Set();
  for (let h = -36; h <= 36; h += 6) {
    const sample = nominal + h * 3600000;
    offsets.add(Date.parse(localDateTime(sample, zone) + ":00Z") - sample);
  }
  return [...offsets]
    .map((offset) => nominal - offset)
    .filter((t) => localDateTime(t, zone) === local)
    .sort((a, b) => a - b)
    .map((t) => new Date(t).toISOString());
}
export function resolveLocal(local, zone, fold) {
  const candidates = localInstants(local, zone);
  if (!candidates.length)
    throw new IntentError(
      "Это местное время не существует из-за перевода часов. Выберите другое.",
    );
  if (candidates.length > 1 && !["earlier", "later"].includes(fold))
    throw new IntentError(
      "Время повторяется при переводе часов. Выберите первый или второй раз.",
    );
  return candidates[fold === "later" ? candidates.length - 1 : 0];
}
export function windowDraft(window, zone) {
  const startLocal = localDateTime(window.startsAt, zone);
  const endLocal = localDateTime(window.endsAt, zone);
  const fold = (local, instant) =>
    localInstants(local, zone)[0] === new Date(instant).toISOString()
      ? "earlier"
      : "later";
  return {
    startLocal,
    endLocal,
    startFold: fold(startLocal, window.startsAt),
    endFold: fold(endLocal, window.endsAt),
  };
}
export function quickWindows(kind, zone, now = new Date()) {
  const local = localDateTime(now, zone),
    date = local.slice(0, 10);
  if (kind === "tonight") {
    const start = local.slice(11) < "18:00" ? "18:00" : local.slice(11);
    return start < "22:00"
      ? [{ startLocal: date + "T" + start, endLocal: date + "T22:00" }]
      : [];
  }
  const day = new Date(date + "T12:00Z").getUTCDay();
  const saturday = day === 0 ? -1 : (6 - day + 7) % 7;
  const at = (offset, hour) =>
    new Date(Date.parse(date + "T00:00Z") + offset * 86400000)
      .toISOString()
      .slice(0, 10) +
    "T" +
    hour;
  let windows = [saturday, saturday + 1]
    .map((d) => ({ startLocal: at(d, "10:00"), endLocal: at(d, "15:00") }))
    .filter((w) => w.endLocal > local);
  if (!windows.length)
    windows = [saturday + 7, saturday + 8].map((d) => ({
      startLocal: at(d, "10:00"),
      endLocal: at(d, "15:00"),
    }));
  return windows.map((w) => ({
    ...w,
    startLocal: w.startLocal < local ? local : w.startLocal,
  }));
}
export function formatIntentWindow(window, zone) {
  const format = new Intl.DateTimeFormat("ru", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${format.format(new Date(window.startsAt))} — ${format.format(new Date(window.endsAt))}`;
}
