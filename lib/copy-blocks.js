import { uiCopy } from "./ui-copy.js";
/** @type {[id: string, name: string, pattern: RegExp][]} */
const sections = [
  [
    "summary",
    "О велосипеде",
    /велосипед|паспорт|рам[аы]|вес|цвет|собран|истори|производител/i,
  ],
  [
    "components",
    "Комплектация и аксессуары",
    /компонент|детал|комплект|конфигурац|аксессуар|навес|стоимост/i,
  ],
  ["photos", "Фото и галерея", /фото|обложк|изображен|галере/i],
  ["garage", "Гараж и поиск", /гараж|коллекц|фильтр|найти|поиск|байк/i],
  [
    "sharing",
    "Публичный доступ",
    /ссылк|доступ|поделиться|публичн|приват|виден|видна/i,
  ],
  [
    "account",
    "Аккаунт",
    /аккаунт|парол|почт|войти|вход|регистрац|имя|профил|выход/i,
  ],
];
const groups = sections.map(([id, name]) => ({ id, name, keys: [] }));
const common = { id: "common", name: "Общие элементы и футер", keys: [] };
for (const key of [
  ...new Set([
    ...uiCopy,
    "О велосипеде",
    "Сайт производителя",
    "Стоимость велосипеда",
    "Отображение стоимости",
    "Стоимость выбранного раздела",
  ]),
]) {
  const i = sections.findIndex(([, , pattern]) => pattern.test(key));
  (i < 0 ? common : groups[i]).keys.push(key);
}
export const copyBlocks = [...groups, common];
