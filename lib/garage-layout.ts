import type { BikeDto, SiteCatalog } from "./contracts.ts";
import { classificationLabels } from "./bike-classification.ts";

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
/** A block of the bike page; detailBlocks in admin-validation.js checks the list. */

export const defaultBlocks: DetailBlock[] = [
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
    enabled: true,
    variant: "compact",
    open: true,
  },
  {
    id: "gallery",
    name: "Галерея",
    enabled: true,
    variant: "compact",
    open: true,
  },
  {
    id: "specifications",
    name: "Комплектация и аксессуары",
    enabled: true,
    variant: "compact",
    open: true,
  },
];
/**
 * What the saved `detailBlocks` switch on for the bike page (#291). The
 * composition is fixed: `photos` hides the picture column, `gallery` the
 * thumbnail row under the picture (so it needs the picture), `specifications`
 * the build, `heading` the metric tiles and the quote. The overview with the
 * description and the passport belongs to every page: a saved
 * `summary.enabled: false` is the default of the time when the block was
 * optional (and `open: false` a folded gallery), not a choice about this
 * layout, so neither hides or folds a section any more.
 */
export function detailLayout(blocks: readonly DetailBlock[] | undefined) {
  const enabled = (id: DetailBlock["id"]) =>
    (
      blocks?.find((block) => block.id === id) ??
      defaultBlocks.find((block) => block.id === id)!
    ).enabled;
  return {
    metrics: enabled("heading"),
    photos: enabled("photos"),
    thumbnails: enabled("photos") && enabled("gallery"),
    overview: true,
    specifications: enabled("specifications"),
  };
}
/**
 * A short quote from a description for the bike's first screen, or null when
 * it would only repeat the whole text that "About the bike" shows below.
 */
export function bikeExcerpt(description: string | null | undefined, max = 180) {
  const text = (description || "").trim();
  if (!text) return null;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim());
  const first = paragraphs[0];
  const whole = paragraphs.join(" ");
  if (first.length <= max) return whole === first ? null : first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
export function groupedComponents<
  T extends { group_id?: string; category: string },
>(components: T[], groups = defaultGroups, order: string[] = []) {
  const ordered = [...groups].sort((a, b) => {
    const ai = order.indexOf(a.id),
      bi = order.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  const result = ordered.map((g) => {
    const components: T[] = [];
    return { ...g, components };
  });

  const other: {
    id: string;
    name: string;
    icon: string;
    components: T[];
  } = { id: "other", name: "Другое", icon: "other", components: [] };
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
/**
 * The line under the name of a bike (#291): its type and the first two parts
 * of its drivetrain, as the owner entered them. Nothing is guessed from the
 * model name and an empty drivetrain leaves the type alone.
 */
export function bikeSubtitle(
  bike: Pick<BikeDto, "components" | "group_order" | "category"> &
    Partial<Pick<BikeDto, "classification">>,
  catalog: Pick<SiteCatalog, "componentGroups">,
) {
  const drivetrain = groupedComponents(
    bike.components.filter((c) => c.section === "build"),
    catalog.componentGroups,
    bike.group_order || [],
  ).find((group) => group.id === "drivetrain");
  return [
    classificationLabels(bike).join(" / "),
    ...(drivetrain?.components ?? []).slice(0, 2).map((c) => c.name),
  ]
    .filter(Boolean)
    .join(" · ");
}
export function moveItem<T>(items: T[], index: number, direction: number) {
  const next = [...items];
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export type DetailBlock = {
  id: "heading" | "photos" | "summary" | "gallery" | "specifications";
  name: string;
  enabled: boolean;
  variant: "compact" | "card" | "plain";
  open: boolean;
};
