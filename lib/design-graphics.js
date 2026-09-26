export const illustrationSlots = [
  ["backgroundLightId", "Фон сайта · светлая тема", "Фон сайта", "Без фона"],
  ["backgroundDarkId", "Фон сайта · тёмная тема", "Фон сайта", "Без фона"],
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
  [
    "aboutGuideImageId",
    "О проекте · как устроен ColaBike",
    "О проекте",
    "Значок велосипеда",
  ],
  [
    "aboutTechnologyImageId",
    "О проекте · под капотом",
    "О проекте",
    "Значок слоёв",
  ],
  // The left half of the sign-in and registration windows (#125); each
  // window has its own picture, registration falls back to sign-in's (#131).
  ["authImageId", "Вход · иллюстрация", "Вход и регистрация", "Знак ColaBike"],
  [
    "authRegisterImageId",
    "Регистрация · иллюстрация",
    "Вход и регистрация",
    "Как у входа",
  ],
  // Up to four logos on the left of the site footer, in this order, each
  // with its own link (#107, #124).
  ...[1, 2, 3, 4].map((n) => [
    `footerImage${n}Id`,
    `Подвал · логотип ${n}`,
    "Подвал",
    "Без изображения",
    `footerLink${n}`,
  ]),
].map(([key, label, group, emptyLabel, linkKey]) => ({
  key,
  label,
  group,
  emptyLabel,
  target: "setting",
  ...(linkKey ? { linkKey } : {}),
}));
export const footerSlots = illustrationSlots.filter((slot) => slot.linkKey);
// A footer logo leads to a page of the site ("/…") or to an http(s) address.
export function footerLinkHref(value) {
  const href = typeof value === "string" ? value.trim() : "";
  // "/\host" is read by browsers as "//host", so backslashes are refused.
  return /^https?:\/\/[^\s\\]+$/i.test(href) ||
    /^\/(?![/\\])[^\s\\]*$/.test(href)
    ? href
    : null;
}

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
