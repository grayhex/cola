export const defaultGroups = [
  {
    id: "frame",
    name: "Рама и подвеска",
    icon: "frame",
    categories: ["Рама", "Вилка", "Амортизатор"],
  },
  {
    id: "drivetrain",
    name: "Трансмиссия",
    icon: "crank",
    categories: [
      "Групсет",
      "Задний переключатель",
      "Передний переключатель",
      "Манетки / дуалы",
      "Левая манетка",
      "Правая манетка",
      "Система / шатуны",
      "Каретка",
      "Передняя звезда",
      "Кассета",
      "Трещотка",
      "Цепь",
      "Ремень",
      "Задняя звезда",
      "Педали",
      "Измеритель мощности",
    ],
  },
  {
    id: "brakes",
    name: "Тормоза",
    icon: "brake",
    categories: [
      "Тормоза",
      "Передний тормоз",
      "Задний тормоз",
      "Тормозная ручка",
      "Роторы",
      "Передний ротор",
      "Задний ротор",
    ],
  },
  {
    id: "wheels",
    name: "Колёса",
    icon: "wheel",
    categories: [
      "Колёса",
      "Переднее колесо",
      "Заднее колесо",
      "Обода",
      "Передний обод",
      "Задний обод",
      "Втулки",
      "Передняя втулка",
      "Задняя втулка",
      "Покрышки",
      "Передняя покрышка",
      "Задняя покрышка",
      "Камеры / бескамерка",
    ],
  },
  {
    id: "cockpit",
    name: "Управление и посадка",
    icon: "handlebar",
    categories: [
      "Руль",
      "Вынос",
      "Рулевая",
      "Грипсы / обмотка",
      "Седло",
      "Подседельный штырь",
      "Дроппер",
      "Подседельный зажим",
    ],
  },
  {
    id: "electric",
    name: "Электрооборудование",
    icon: "computer",
    categories: ["Мотор", "Батарея", "Дисплей", "Зарядное устройство"],
  },
  {
    id: "equipment",
    name: "Оборудование и аксессуары",
    icon: "rack",
    categories: [
      "Передний свет",
      "Задний свет",
      "Крылья",
      "Багажник",
      "Подножка",
      "Звонок",
      "Велокомпьютер",
      "Датчики",
      "Замок",
      "Насос",
      "Инструменты",
      "Фляга / держатель",
      "Подседельная сумка",
      "Рамная сумка",
      "Сумка на руль",
    ],
  },
];
/**
 * A block of the bike page; detailBlocks in admin-validation.js checks the list.
 * @typedef {object} DetailBlock
 * @property {"heading" | "photos" | "summary" | "gallery" | "specifications"} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {"compact" | "card" | "plain"} variant
 * @property {boolean} open
 */
/** @type {DetailBlock[]} */
export const defaultBlocks = [
  {
    id: "heading",
    name: "Заголовок",
    enabled: true,
    variant: "compact",
    open: true,
  },
  {
    id: "photos",
    name: "Фото велосипеда",
    enabled: true,
    variant: "compact",
    open: true,
  },
  {
    id: "summary",
    name: "О велосипеде",
    enabled: false,
    variant: "compact",
    open: true,
  },
  {
    id: "gallery",
    name: "Галерея",
    enabled: true,
    variant: "compact",
    open: false,
  },
  {
    id: "specifications",
    name: "Комплектация и аксессуары",
    enabled: true,
    variant: "compact",
    open: true,
  },
];
// Keep equipment on the first mobile screen; the open description follows it.
defaultBlocks.sort(
  (a, b) =>
    ["heading", "photos", "specifications", "summary", "gallery"].indexOf(
      a.id,
    ) -
    ["heading", "photos", "specifications", "summary", "gallery"].indexOf(b.id),
);
export function groupedComponents(
  components,
  groups = defaultGroups,
  order = [],
) {
  const ordered = [...groups].sort((a, b) => {
    const ai = order.indexOf(a.id),
      bi = order.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  const result = ordered.map((g) => ({ ...g, components: [] }));
  const other = { id: "other", name: "Другое", icon: "other", components: [] };
  for (const c of components) {
    const g =
      result.find((g) => c.group_id === g.id) ||
      result.find((g) => g.categories.includes(c.category)) ||
      other;
    g.components.push(c);
  }
  return [...result, other]
    .filter((g) => g.components.length)
    .sort((a, b) => {
      const ai = order.indexOf(a.id),
        bi = order.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
}
// Key parts for the bike page summary (#104): build parts in the order of
// their groups, one per category.
export function specRows(components = [], groups = defaultGroups, limit = 6) {
  const seen = new Set(),
    rows = [];
  const build = components.filter((c) => c.section === "build");
  for (const group of groupedComponents(build, groups))
    for (const c of group.components) {
      const name = c.name?.trim();
      if (rows.length >= limit || !name || seen.has(c.category)) continue;
      seen.add(c.category);
      rows.push({ category: c.category, name });
    }
  return rows;
}
export function moveItem(items, index, direction) {
  const next = [...items];
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
