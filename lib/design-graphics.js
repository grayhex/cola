import { iconPack, semanticIconName, resolveIconAsset } from "./icon-pack.js";
import { legacyUiIconNames, uiIconLabels } from "./ui-icons.js";
import { iconPaths, categoryIcons } from "./part-icons.js";

// One editable entry per effective slot. Old dedicated navigation fields are
// resolved through the semantic registry, never exposed as competing pickers.
export const illustrationSlots = [
  ["logoId", "Legacy · логотип в шапке", "Legacy", "Текстовый логотип"],
  ["faviconId", "Иконка вкладки браузера", "Брендинг", "По умолчанию"],
  ["garageImageId", "Legacy · панорама", "Legacy", "Без изображения"],
  ["backgroundImageId", "Legacy · фон сайта", "Legacy", "Без фона"],
  ["loginImageId", "Иллюстрация входа", "Вход и регистрация", "Без иллюстрации"],
  ["registerImageId", "Иллюстрация регистрации", "Вход и регистрация", "Без иллюстрации"],
  ["mtbImageId", "Стоковое фото · MTB", "Велосипеды", "Без изображения"],
  ["roadImageId", "Стоковое фото · шоссе", "Велосипеды", "Без изображения"],
  ["gravelImageId", "Стоковое фото · гравел", "Велосипеды", "Без изображения"],
  ["demoImageId", "Фото демонстрационного велосипеда", "Велосипеды", "Внешнее демо-фото"],
  ["aboutGuideImageId", "О проекте · руководство", "О проекте", "По умолчанию"],
  ["aboutTechnologyImageId", "О проекте · технологии", "О проекте", "По умолчанию"],
  ["aboutHistoryImageId", "О проекте · история (резерв)", "О проекте", "По умолчанию"],
].map(([key, label, group, emptyLabel]) => ({ key, label, group, emptyLabel, target: "setting" }));

const adminIcons = new Set(["Palette", "History", "Type", "Code2"]);
export const interfaceSlots = [
  ...iconPack.map((icon) => ({ ...icon, key: icon.name, target: "semantic" })),
  ...legacyUiIconNames.filter((name) => !semanticIconName(name)).map((name) => ({
    key: name, label: uiIconLabels[name] || name, target: "uiIcons",
    group: adminIcons.has(name) ? "Администрирование" : "Служебные значки",
  })),
  { key: "wizardLinkIconId", label: "Мастер · распознать по ссылке", group: "Добавление велосипеда", target: "setting", fallback: "Link" },
  { key: "wizardManualIconId", label: "Мастер · заполнить вручную", group: "Добавление велосипеда", target: "setting", fallback: "Pencil" },
];
export const componentSlots = Object.keys(iconPaths).map((key) => ({
  key, label: Object.keys(categoryIcons).filter((name) => categoryIcons[name] === key).join(" / ") || key,
  group: "Компоненты и аксессуары", target: "partIconAssets",
}));

export function graphicAsset(settings, slot) {
  if (slot.target === "semantic") return resolveIconAsset(settings, slot.key);
  return slot.target === "setting" ? settings[slot.key] || null : settings[slot.target]?.[slot.key] || null;
}

export function filterGraphicSlots(slots, search = "", group = "all") {
  const term = search.trim().toLocaleLowerCase("ru");
  return slots.filter((slot) => (group === "all" || slot.group === group) &&
    [slot.key, slot.label, slot.group, slot.legacy, slot.fallback].join(" ").toLocaleLowerCase("ru").includes(term));
}
