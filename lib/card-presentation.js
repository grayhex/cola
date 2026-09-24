// Presentation only: eligibility and awards remain authoritative on the server.
const valuableAwards = ["bike_likes_100", "bike_likes_50", "full_build"];
export function significantBadge(bike, records = []) {
  if (!bike.is_public) return null;
  const current = records.filter((record) => record.holder?.id === bike.id);
  return (
    current.find((record) => record.group !== "Community") ||
    valuableAwards
      .map((key) => (bike.badges || []).find((award) => award.key === key))
      .find(Boolean) ||
    current[0] ||
    null
  );
}
export function metricSegments(value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  return Math.min(4, Math.floor(percent / 25) + 1);
}
// One or two build parts for a card tag row, the most telling first.
const tagOrder = ["Групсет", "Задний переключатель", "Рама", "Колёса", "Вилка"];
export function buildTags(components = []) {
  const rank = (c) =>
    tagOrder.includes(c.category) ? tagOrder.indexOf(c.category) : 99;
  return components
    .filter((c) => c.section !== "accessories" && c.name?.trim())
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 2)
    .map((c) => c.name.trim());
}
