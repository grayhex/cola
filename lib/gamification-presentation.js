import { achievements } from "./gamification-definitions.js";

export const gameDescriptionLimit = 160;

// Presentation only. Ranking, eligibility and award triggers are unchanged.
export const recordGroups = Object.freeze([
  { id: "price", name: "Стоимость", groups: ["Цена"] },
  { id: "weight", name: "Вес по категориям", groups: ["Вес"] },
  { id: "build", name: "Комплектация", groups: ["Прокаченность"] },
  { id: "community", name: "Признание сообщества", groups: ["Популярность", "Community"] },
]);

const recordDescriptions = Object.freeze({
  expensive: "Самый дорогой байк среди участников рейтинга.",
  budget: "Самый недорогой байк среди участников рейтинга.",
  lightest_mtb: "Самый лёгкий MTB среди участников рейтинга.",
  lightest_gravel: "Самый лёгкий гравийник среди участников рейтинга.",
  lightest_road: "Самый лёгкий шоссейный байк среди участников рейтинга.",
  popular: "Байк с наибольшим числом лайков.",
  upgrade: "Самый высокий показатель прокаченности сборки.",
  complete: "Самая полная карточка по правилам площадки.",
  wild: "Больше всего реакций «Безумие».",
  clean: "Больше всего реакций «Чистая сборка».",
  dream: "Больше всего реакций «Хочу такой».",
  community: "Больше всего участников с дополнительными реакциями на байк.",
});

export function defaultGameDescription(kind, key) {
  return kind === "record"
    ? (Object.hasOwn(recordDescriptions, key) ? recordDescriptions[key] : "")
    : achievements.find((a) => a.key === key)?.description || "";
}

export function gameDescription(kind, item, settings = {}) {
  const field = kind === "record" ? "recordDescriptions" : "achievementDescriptions";
  const custom = settings[field]?.[item.key];
  return (typeof custom === "string" && custom.trim()) ||
    defaultGameDescription(kind, item.key) || item.description || "";
}

export function groupRecords(records) {
  const known = new Set(recordGroups.flatMap((group) => group.groups));
  const grouped = recordGroups.map((group) => ({
    ...group,
    records: records.filter((r) => group.groups.includes(r.group)),
  }));
  // Future definitions must remain visible rather than silently disappear.
  const other = records.filter((r) => !known.has(r.group));
  if (other.length) grouped.push({ id: "other", name: "Другие рекорды", groups: [], records: other });
  return grouped.filter((group) => group.records.length);
}

// Decorate only authorized DTOs, retaining every holder, progress and image.
export function withGameDescriptions(data, settings = {}) {
  const result = { ...data };
  for (const [field, kind] of [["records", "record"], ["awards", "achievement"], ["locked", "achievement"]]) {
    if (Array.isArray(data[field])) {
      result[field] = data[field].map((item) => ({
        ...item,
        description: gameDescription(kind, item, settings),
      }));
    }
  }
  return result;
}
// A holder's value as the records page and the home page show it.
export function recordValue(record, currency = "RUB") {
  return (
    new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      ...(record.metric === "price" ? { style: "currency", currency } : {}),
    }).format(record.holder.value) +
    (record.metric === "weight"
      ? " кг"
      : ["upgrade", "completeness"].includes(record.metric)
        ? "%"
        : "")
  );
}
