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
].map(([key, label, emoji]) => ({ key, label, emoji }));
export const defaultEmojis = Object.fromEntries(
  emojiSlots.map((s) => [s.key, s.emoji]),
);
// Interface icons are line icons (#127). An administrator may replace one
// with an emoji; an empty value or the old default emoji means "not chosen".
export function customEmoji(emojis, name) {
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
