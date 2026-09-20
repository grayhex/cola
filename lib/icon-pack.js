// Stable semantic slots shared by the importer, admin and application.
// These identifiers are the basenames in colabike-unified-icons.zip.
export const iconPack = [
  {"name": "home_garage", "label": "Дом / главная / гараж", "group": "Основная навигация", "fallback": "Home", "legacy": "navHomeIconId"},
  {"name": "profile", "label": "Профиль", "group": "Основная навигация", "fallback": "UserRound", "legacy": "navProfileIconId"},
  {"name": "admin", "label": "Админка", "group": "Основная навигация", "fallback": "Shield", "legacy": "navAdminIconId"},
  {"name": "messages", "label": "Сообщения", "group": "Основная навигация", "fallback": "MessagesSquare"},
  {"name": "logout", "label": "Выход", "group": "Основная навигация", "fallback": "LogOut", "legacy": "navLogoutIconId"},
  {"name": "search", "label": "Поиск", "group": "Основная навигация", "fallback": "Search", "legacy": "searchIconId"},
  {"name": "notifications", "label": "Уведомления", "group": "Основная навигация", "fallback": "Bell", "legacy": "navMessagesIconId"},
  {"name": "add_bike", "label": "Добавить велосипед", "group": "Основная навигация", "fallback": "Bike", "legacy": "addBikeIconId"},
  {"name": "journal", "label": "Журнал", "group": "Основная навигация", "fallback": "NotebookPen", "legacy": "navJournalIconId"},
  {"name": "rides", "label": "Покатушки", "group": "Основная навигация", "fallback": "Route", "legacy": "navRidesIconId"},
  {"name": "about", "label": "О проекте", "group": "Основная навигация", "fallback": "Info", "legacy": "navAboutIconId"},
  {"name": "new", "label": "Новые", "group": "Контент и журнал", "fallback": "Sparkles", "legacy": "navNewIconId"},
  {"name": "popular", "label": "Популярные", "group": "Контент и журнал", "fallback": "Flame", "legacy": "navPopularIconId"},
  {"name": "following", "label": "Подписки: лента авторов", "group": "Контент и журнал", "fallback": "Users", "legacy": "navSubscriptionsIconId"},
  {"name": "saved", "label": "Сохранённое", "group": "Контент и журнал", "fallback": "Bookmark"},
  {"name": "saved_active", "label": "Сохранено: активное состояние", "group": "Контент и журнал", "fallback": "BookmarkCheck"},
  {"name": "write_post", "label": "Создать запись", "group": "Контент и журнал", "fallback": "FilePenLine"},
  {"name": "comment", "label": "Комментарий", "group": "Контент и журнал", "fallback": "MessageCircle"},
  {"name": "reply", "label": "Ответ", "group": "Контент и журнал", "fallback": "Reply"},
  {"name": "share", "label": "Поделиться", "group": "Контент и журнал", "fallback": "Share2"},
  {"name": "report", "label": "Пожаловаться", "group": "Контент и журнал", "fallback": "Flag"},
  {"name": "edit", "label": "Редактировать", "group": "Контент и журнал", "fallback": "Pencil"},
  {"name": "delete", "label": "Удалить", "group": "Контент и журнал", "fallback": "Trash2"},
  {"name": "draft", "label": "Черновик", "group": "Статусы записей и состояния", "fallback": "FileText"},
  {"name": "private", "label": "Приватно", "group": "Статусы записей и состояния", "fallback": "Lock"},
  {"name": "public", "label": "Публично", "group": "Статусы записей и состояния", "fallback": "Globe"},
  {"name": "resolved", "label": "Решено", "group": "Статусы записей и состояния", "fallback": "CircleCheck"},
  {"name": "has_photos", "label": "Есть фото", "group": "Статусы записей и состояния", "fallback": "Image"},
  {"name": "linked_ride", "label": "Прикреплена покатушка", "group": "Статусы записей и состояния", "fallback": "MapPin"},
  {"name": "linked_component", "label": "Привязан компонент", "group": "Статусы записей и состояния", "fallback": "Link"},
  {"name": "post_upgrade", "label": "Апгрейд / сборка", "group": "Типы записей журнала", "fallback": "TrendingUp"},
  {"name": "post_service", "label": "Обслуживание", "group": "Типы записей журнала", "fallback": "Wrench"},
  {"name": "post_impression", "label": "Впечатления", "group": "Типы записей журнала", "fallback": "Smile"},
  {"name": "post_question", "label": "Вопрос", "group": "Типы записей журнала", "fallback": "CircleHelp"},
  {"name": "post_story", "label": "История / рассказ", "group": "Типы записей журнала", "fallback": "BookOpen"},
  {"name": "like", "label": "Лайк / сердце", "group": "Социальные и сайтовые", "fallback": "Heart", "legacy": "likeIconId"},
  {"name": "subscriptions", "label": "Подписаться / следить", "group": "Социальные и сайтовые", "fallback": "UserPlus"},
  {"name": "achievements", "label": "Достижения", "group": "Социальные и сайтовые", "fallback": "Medal"},
  {"name": "records", "label": "Рекорды", "group": "Социальные и сайтовые", "fallback": "Trophy", "legacy": "navRecordsIconId"},
  {"name": "readers", "label": "Читатели / аудитория", "group": "Социальные и сайтовые", "fallback": "UsersRound"},
  {"name": "bookmark_alt", "label": "Закладка: альтернативный вариант", "group": "Социальные и сайтовые", "fallback": "BookMarked"},
  {"name": "bike_mtb", "label": "MTB / ATB", "group": "Типы велосипедов", "fallback": "Bike", "legacy": "mtbTypeIconId"},
  {"name": "bike_road_gravel", "label": "Road / Gravel", "group": "Типы велосипедов", "fallback": "Bike", "legacy": "roadTypeIconId"},
  {"name": "bike_touring_commute", "label": "Touring / Commute", "group": "Типы велосипедов", "fallback": "Bike", "legacy": "gravelTypeIconId"},
  {"name": "bike_city", "label": "Городской", "group": "Типы велосипедов", "fallback": "Bike"},
  {"name": "bike_folding", "label": "Складной", "group": "Типы велосипедов", "fallback": "Bike"},
  {"name": "bike_fixed", "label": "Fixed / single speed", "group": "Типы велосипедов", "fallback": "Bike"},
  {"name": "bike_electric", "label": "E-bike", "group": "Типы велосипедов", "fallback": "Bike"},
  {"name": "similar_builds", "label": "Похожие сборки", "group": "Поиск опыта и discovery", "fallback": "Layers"},
  {"name": "filter", "label": "Фильтры", "group": "Поиск опыта и discovery", "fallback": "SlidersHorizontal"},
  {"name": "sort", "label": "Сортировка", "group": "Поиск опыта и discovery", "fallback": "ArrowUpDown"},
  {"name": "discover", "label": "Обзор / explore", "group": "Поиск опыта и discovery", "fallback": "Compass"},
  {"name": "search_experience", "label": "Поиск опыта", "group": "Поиск опыта и discovery", "fallback": "Search"},
  {"name": "compare", "label": "Сравнить", "group": "Поиск опыта и discovery", "fallback": "Scale"},
  {"name": "component", "label": "Компонент", "group": "Поиск опыта и discovery", "fallback": "Cog"},
  {"name": "bike_model", "label": "Модель велосипеда", "group": "Поиск опыта и discovery", "fallback": "Bike"},
  {"name": "settings", "label": "Настройки", "group": "Универсальные / админка", "fallback": "Settings2"},
  {"name": "categories", "label": "Категории", "group": "Универсальные / админка", "fallback": "LayoutGrid"},
  {"name": "image_gallery", "label": "Галерея / изображения", "group": "Универсальные / админка", "fallback": "Images"},
  {"name": "stats", "label": "Статистика", "group": "Универсальные / админка", "fallback": "ChartNoAxesColumnIncreasing"},
  {"name": "moderation", "label": "Модерация", "group": "Универсальные / админка", "fallback": "ShieldCheck"},
  {"name": "pin", "label": "Закрепить", "group": "Универсальные / админка", "fallback": "Pin"},
  {"name": "visibility", "label": "Видимость", "group": "Универсальные / админка", "fallback": "Eye"},
  {"name": "hide", "label": "Скрыть", "group": "Универсальные / админка", "fallback": "EyeOff"},
];
export const iconPackNames = iconPack.map((icon) => icon.name);
export const iconPackByName = Object.fromEntries(iconPack.map((icon) => [icon.name, icon]));

// Generic primitives use the closest unambiguous semantic slot. Context-specific
// uses (e.g. saved vs Save, following vs readers) should use SiteIcon explicitly.
export const iconAliases = {
  Home: "home_garage", UserRound: "profile", Shield: "admin",
  MessagesSquare: "messages", LogOut: "logout", Search: "search",
  Bell: "notifications", Bike: "bike_model", NotebookPen: "journal",
  Route: "rides", Info: "about", Sparkles: "new", Flame: "popular",
  Users: "following", Save: "saved", Bookmark: "saved", BookmarkCheck: "saved_active",
  FilePenLine: "write_post", MessageCircle: "comment", Reply: "reply",
  Share2: "share", Flag: "report", Pencil: "edit", Trash2: "delete",
  FileText: "draft", Lock: "private", Globe: "public", CircleCheck: "resolved",
  Image: "has_photos", MapPin: "linked_ride", Link: "linked_component",
  TrendingUp: "post_upgrade", Wrench: "post_service", Smile: "post_impression",
  CircleHelp: "post_question", BookOpen: "post_story", Heart: "like",
  UserPlus: "subscriptions", Medal: "achievements", Trophy: "records",
  UsersRound: "readers", BookMarked: "bookmark_alt", Layers: "similar_builds",
  SlidersHorizontal: "filter", ArrowUpDown: "sort", Compass: "discover",
  Scale: "compare", Cog: "component", Package: "component",
  Settings2: "settings", LayoutGrid: "categories", Images: "image_gallery",
  ChartNoAxesColumnIncreasing: "stats", ShieldCheck: "moderation",
  Pin: "pin", Eye: "visibility", EyeOff: "hide",
};

export function semanticIconName(name) {
  return Object.hasOwn(iconPackByName, name) ? name : iconAliases[name];
}

// undefined = no override (keep old installations working); null = explicitly
// reset this semantic slot to its built-in icon, including old dedicated slots.
export function iconPackOverride(settings, name) {
  const key = semanticIconName(name);
  return key && Object.hasOwn(settings?.uiIcons || {}, key)
    ? settings.uiIcons[key]
    : undefined;
}

export function resolveIconAsset(settings, name, legacyAssetId) {
  const override = iconPackOverride(settings, name);
  if (override !== undefined) return override;
  const key = semanticIconName(name), slot = key && iconPackByName[key];
  return legacyAssetId || settings?.[slot?.legacy] ||
    settings?.uiIcons?.[name] || settings?.uiIcons?.[slot?.fallback] || null;
}

// Immutable partial import. Missing names never clear an existing setting.
export function mergeIconPack(settings, assignments, mode = "replace") {
  if (!["replace", "missing"].includes(mode)) throw new Error("Неизвестный режим импорта");
  const icons = { ...settings.uiIcons };
  for (const [key, id] of Object.entries(assignments)) {
    if (!Object.hasOwn(iconPackByName, key)) throw new Error("Неизвестный слот: " + key);
    if (mode === "replace" || !resolveIconAsset(settings, key)) icons[key] = id;
  }
  return icons;
}

// Catalog still has three categories. Recognise labels for future/custom types
// without inventing categories or changing any bike data.
export function bikeIconName(category, label = "") {
  const value = `${category} ${label}`.toLowerCase();
  if (/electric|e-bike|ebike|электро/.test(value)) return "bike_electric";
  if (/fold|склад/.test(value)) return "bike_folding";
  if (/fixed|single|фикс/.test(value)) return "bike_fixed";
  if (/city|город/.test(value)) return "bike_city";
  if (/tour|commut|тур|комьют|коммьют/.test(value)) return "bike_touring_commute";
  if (/mtb|atb|горн/.test(value)) return "bike_mtb";
  return "bike_road_gravel";
}

// Presentation adapter for older direct nav/category/like asset slots. Never
// persist these derived values: admin edits the original settings + uiIcons map.
export function withIconPack(settings) {
  const result = { ...settings };
  for (const icon of iconPack) {
    if (icon.legacy && Object.hasOwn(settings.uiIcons || {}, icon.name))
      result[icon.legacy] = settings.uiIcons[icon.name];
  }
  return result;
}
export const journalKindIcons = {
  build: "post_upgrade", service: "post_service", review: "post_impression",
  question: "post_question", story: "post_story",
};
