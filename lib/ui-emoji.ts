export const emojiSlots = [
  ["home", "Главная", "🏠"],
  ["bike", "Велосипеды", "🚲"],
  ["components", "Компоненты", "⚙️"],
  ["journal", "Журнал", "📓"],
  ["articles", "Статьи", "📚"],
  ["rides", "Покатушки", "🧭"],
  ["market", "Рынок", "🛍️"],
  ["about", "О проекте", "ℹ️"],
  ["profile", "Профиль", "👤"],
  ["messages", "Сообщения", "💬"],
  ["notifications", "Уведомления", "🔔"],
  ["subscriptions", "Подписки", "👥"],
  ["saved", "Сохранённое", "🔖"],
  ["records", "Рекорды", "🏆"],
  ["admin", "Админка", "⚙️"],
  ["logout", "Выход", "👋"],
  ["search", "Поиск", "🔎"],
  ["menu", "Меню", "☰"],
  ["light", "Светлая тема", "☀️"],
  ["dark", "Тёмная тема", "🌙"],
  ["system", "Системная тема", "💻"],
  ["add", "Добавить", "➕"],
  ["addBike", "Добавить велосипед", "🚲"],
  ["addRide", "Добавить покатушку", "🚴"],
  ["plan", "Запланировать", "🗓️"],
  ["import", "Импорт Garmin CSV", "📥"],
  ["write", "Написать запись / статью", "✍️"],
  ["new", "Новые", "✨"],
  ["popular", "Популярные", "🔥"],
  ["filters", "Фильтры", "🎛️"],
  ["heart", "Нравится", "❤️"],
  ["size", "Размер рамы", "📐"],
  ["weight", "Вес", "⚖️"],
  ["mtb", "MTB", "⛰️"],
  ["road", "Шоссе", "🛣️"],
  ["gravel", "Гравий", "🌲"],
  ["yes", "Иду", "✅"],
  ["no", "Не иду", "✖️"],
  ["maybe", "Может быть", "🤔"],
  ["repeat", "Регулярная покатушка", "🔁"],
  ["reset", "Сбросить", "↺"],
  ["apply", "Применить", "✓"],
  ["edit", "Редактировать", "✏️"],
  ["addPhoto", "Добавить фото", "📷"],
  ["public", "Велосипед виден всем", "🌐"],
  ["private", "Велосипед только для вас", "🔒"],
  ["link", "Распознать по ссылке", "🔗"],
  ["next", "Далее", "➡️"],
  ["back", "Назад", "⬅️"],
  ["save", "Сохранить", "💾"],
  ["publish", "Опубликовать", "📤"],
  ["addPart", "Добавить компонент", "🔧"],
  ["addListing", "Добавить объявление", "🏷️"],
  ["pulseToday", "Планы: Сегодня", ""],
  ["pulseTomorrow", "Планы: Завтра", ""],
  ["pulseWeekend", "Планы: В выходные", ""],
  ["pulseLater", "Планы: Позже", ""],
].map(([key, label, emoji]) => ({ key, label, emoji }));
export const defaultEmojis = Object.fromEntries(
  emojiSlots.map((s) => [s.key, s.emoji]),
);
export const pulseIconColors: Record<string, string> = {
  pulseToday: "#b45309",
  pulseTomorrow: "#2563eb",
  pulseWeekend: "#0d9488",
  pulseLater: "#7c3aed",
};
// Interface icons are line icons (#127). An administrator may replace one
// with an emoji; an empty value or the old default emoji means "not chosen".
export function customEmoji(
  emojis: { [x: string]: string } | undefined,
  name: string,
) {
  const value = typeof emojis?.[name] === "string" ? emojis[name].trim() : "";
  return value && value !== defaultEmojis[name] ? value : null;
}
export const noCustomEmojis = Object.fromEntries(
  emojiSlots.map((s) => [s.key, ""]),
);
export const defaultArticleTopics = [
  { id: "maintenance", label: "Обслуживание", emoji: "🔧" },
  { id: "equipment", label: "Компоненты и экипировка", emoji: "⚙️" },
  { id: "riding", label: "Техника и маршруты", emoji: "🚴" },
];
