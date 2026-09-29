// Russian wording for #232 reason codes. The client only localizes what the
// server decided; it never recomputes a match from private data.
export const matchFieldLabels = Object.freeze({
  time: "время",
  area: "область",
  duration: "длительность",
  distance: "дистанция",
  pace: "темп",
  purpose: "цель",
  surface: "покрытие",
  difficulty: "сложность",
  speed: "скорость",
  groupSize: "размер компании",
  regroupPolicy: "ожидание отстающих",
  beginnerFriendly: "для новичков",
});
export const matchCodeLabels = Object.freeze({
  time_fits: "успеваете целиком",
  time_may_overrun: "может не уложиться в ваше окно",
  time_end_unknown: "окончание не указано",
  time_unspecified: "время не учитывалось",
  area_label_text: "район совпадает только по названию",
  area_unknown: "область не отмечена на карте",
  area_overlap: "рядом с вашей областью",
  area_far: "далеко от вашей области",
});
/** @param {string[]} words */
export function listText(words) {
  if (words.length < 2) return words.join("");
  return words.slice(0, -1).join(", ") + " и " + words[words.length - 1];
}
/** Short lines for a card: what fits, what to check, what is unknown/different.
 * @param {{matched?: string[], partial?: string[], unknown?: string[], conflicts?: string[],
 *  reasons?: {field: string, status: string, code: string}[]}} match */
export function matchSummary(match) {
  const label = (/** @type {string} */ field) => {
    const reason = match.reasons?.find((r) => r.field === field);
    return (
      (reason &&
        matchCodeLabels[
          /** @type {keyof typeof matchCodeLabels} */ (reason.code)
        ]) ||
      matchFieldLabels[/** @type {keyof typeof matchFieldLabels} */ (field)] ||
      field
    );
  };
  const words = (/** @type {string[]|undefined} */ fields) =>
    (fields || []).map(
      (f) =>
        matchFieldLabels[/** @type {keyof typeof matchFieldLabels} */ (f)] || f,
    );
  /** @type {{tone: string, text: string}[]} */
  const lines = [];
  if (match.matched?.length)
    lines.push({
      tone: "success",
      text: "Подходит: " + listText(words(match.matched)),
    });
  if (match.partial?.length)
    lines.push({
      tone: "warning",
      text: "Уточнить: " + listText((match.partial || []).map(label)),
    });
  if (match.conflicts?.length)
    lines.push({
      tone: "danger",
      text: "Расходится: " + listText((match.conflicts || []).map(label)),
    });
  const unknown = (match.unknown || []).filter((f) => f !== "time");
  if (unknown.length)
    lines.push({
      tone: "muted",
      text: "Не указано: " + listText(words(unknown)),
    });
  if (match.unknown?.includes("time"))
    lines.push({ tone: "muted", text: "Время не учитывалось" });
  return lines;
}
