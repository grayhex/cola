export const illustrationSlots = [
  ["faviconId", "Иконка вкладки браузера", "Брендинг", "По умолчанию"],
  ["mtbImageId", "Стоковое фото · MTB", "Велосипеды", "Без изображения"],
  ["roadImageId", "Стоковое фото · шоссе", "Велосипеды", "Без изображения"],
  ["gravelImageId", "Стоковое фото · гравел", "Велосипеды", "Без изображения"],
  [
    "demoImageId",
    "Фото демонстрационного велосипеда",
    "Велосипеды",
    "Внешнее демо-фото",
  ],
  ["aboutGuideImageId", "О проекте · руководство", "О проекте", "По умолчанию"],
  [
    "aboutTechnologyImageId",
    "О проекте · технологии",
    "О проекте",
    "По умолчанию",
  ],
].map(([key, label, group, emptyLabel]) => ({
  key,
  label,
  group,
  emptyLabel,
  target: "setting",
}));

export function graphicAsset(settings, slot) {
  return settings[slot.key] || null;
}
export function filterGraphicSlots(slots, search = "", group = "all") {
  const term = search.trim().toLocaleLowerCase("ru");
  return slots.filter(
    (slot) =>
      (group === "all" || slot.group === group) &&
      [slot.label, slot.group].join(" ").toLocaleLowerCase("ru").includes(term),
  );
}
