import {
  componentIdentity,
  componentText,
  splitComponentField,
} from "../services/bike-resolver/src/component-identity.js";
// Localized display categories; complete original data remains in bikes.factory_spec.
const categories = {
  frame: "Рама",
  fork: "Вилка",
  rear_shock: "Амортизатор",
  rear_derailleur: "Задний переключатель",
  front_derailleur: "Передний переключатель",
  shifter: "Манетки / дуалы",
  left_shifter: "Левая манетка",
  right_shifter: "Правая манетка",
  crankset: "Система / шатуны",
  bottom_bracket: "Каретка",
  chainring: "Передняя звезда",
  cassette: "Кассета",
  freewheel: "Трещотка",
  chain: "Цепь",
  belt: "Ремень",
  rear_sprocket: "Задняя звезда",
  brake: "Тормоза",
  front_brake: "Передний тормоз",
  rear_brake: "Задний тормоз",
  brake_lever: "Тормозная ручка",
  front_rotor: "Передний ротор",
  rear_rotor: "Задний ротор",
  front_hub: "Передняя втулка",
  rear_hub: "Задняя втулка",
  hub: "Втулки",
  spokes: "Спицы",
  inner_tube: "Камеры",
  rim: "Обода",
  front_rim: "Передний обод",
  rear_rim: "Задний обод",
  wheel: "Колёса",
  front_wheel: "Переднее колесо",
  rear_wheel: "Заднее колесо",
  front_tire: "Передняя покрышка",
  rear_tire: "Задняя покрышка",
  tire: "Покрышки",
  handlebar: "Руль",
  stem: "Вынос",
  grips: "Грипсы / обмотка",
  bar_tape: "Грипсы / обмотка",
  headset: "Рулевая",
  seatpost: "Подседельный штырь",
  dropper_post: "Дроппер",
  saddle: "Седло",
  seat_clamp: "Подседельный зажим",
  pedals: "Педали",
  front_light: "Передний свет",
  rear_light: "Задний свет",
  mudguards: "Крылья",
  rack: "Багажник",
  kickstand: "Подножка",
  bell: "Звонок",
  motor: "Мотор",
  battery: "Батарея",
  display: "Дисплей",
  charger: "Зарядное устройство",
  power_meter: "Измеритель мощности",
  other: "Другое",
};
const accessories = new Set([
  "front_light",
  "rear_light",
  "mudguards",
  "rack",
  "kickstand",
  "bell",
  "charger",
]);
export function factoryCategory(c) {
  return categories[c.type] || componentText(c.raw?.label).slice(0, 60);
}
export function factoryComponent(c) {
  const identity = componentIdentity(c);
  if (!identity || !c.type || c.type === "other") return null;
  return {
    section:
      accessories.has(c.type) ||
      /^(дополнительные аксессуары|accessories)$/i.test(c.raw?.label || "")
        ? "accessories"
        : "build",
    category: factoryCategory(c),
    name: identity.name,
    notes:
      identity.description !== identity.name
        ? identity.description.slice(0, 500)
        : "",
    price: null,
  };
}
export function factoryEntries(spec) {
  return (spec?.components || []).flatMap((raw) => {
    const fields = splitComponentField(
      raw.raw?.label || raw.type || "",
      raw.raw?.value || raw.description || "",
    );
    return fields.flatMap((field) => {
      const source =
        fields.length > 1 || field.type
          ? {
              type: field.type,
              description: field.value,
              raw: { label: field.label, value: field.value },
              attributes: {},
            }
          : raw;
      const value = factoryComponent(source);
      return value
        ? [{ source, value, brand: componentIdentity(source).brand }]
        : [];
    });
  });
}
