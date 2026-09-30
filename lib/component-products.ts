// Public product taxonomy is deliberately narrower than a bicycle specification.
// Custom/unknown categories remain valid installation labels, never a catalog bypass.
export const productCategories = [
  "Рама",
  "Вилка",
  "Амортизатор",
  "Групсет",
  "Задний переключатель",
  "Передний переключатель",
  "Манетки / дуалы",
  "Система / шатуны",
  "Педали",
  "Измеритель мощности",
  "Тормоза",
  "Колёса",
  "Обода",
  "Втулки",
  "Покрышки",
  "Руль",
  "Вынос",
  "Грипсы / обмотка",
  "Седло",
  "Подседельный штырь",
  "Дроппер",
  "Мотор",
  "Батарея",
  "Дисплей",
  "Зарядное устройство",
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
];
export const pairedCategories: Record<string, string[]> = {
  "Передняя покрышка": ["Покрышки", "front"],
  "Задняя покрышка": ["Покрышки", "rear"],
  "Передний обод": ["Обода", "front"],
  "Задний обод": ["Обода", "rear"],
  "Передняя втулка": ["Втулки", "front"],
  "Задняя втулка": ["Втулки", "rear"],
  "Переднее колесо": ["Колёса", "front"],
  "Заднее колесо": ["Колёса", "rear"],
  "Передний тормоз": ["Тормоза", "front"],
  "Задний тормоз": ["Тормоза", "rear"],
  "Левая манетка": ["Манетки / дуалы", "left"],
  "Правая манетка": ["Манетки / дуалы", "right"],
};

export function productCategory(category: string) {
  return (
    pairedCategories[category]?.[0] ||
    (productCategories.includes(category) ? category : null)
  );
}

export function installationPosition(category: string) {
  return pairedCategories[category]?.[1] || "";
}
