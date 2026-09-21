import { iconPackNames } from "./icon-pack.js";
export const legacyUiIconNames = [
  "ArrowLeft", "ArrowUpRight", "Bell", "Bike", "BookOpen", "Calendar",
  "Camera", "Check", "CheckCheck", "ChevronDown", "ChevronRight", "ChevronUp",
  "Code2", "Copy", "ExternalLink", "Flag", "Flame", "Gauge", "Globe", "Heart",
  "History", "Home", "Image", "Info", "Layers", "Link", "LoaderCircle", "Lock",
  "LogOut", "MapPin", "Medal", "Menu", "MessageCircle", "Package", "Palette",
  "Pencil", "Plus", "RefreshCw", "RotateCcw", "Route", "Save", "ScanLine",
  "Search", "Settings2", "Shield", "ShieldCheck", "SlidersHorizontal", "Sparkles",
  "Star", "Trash2", "TriangleAlert", "Trophy", "Type", "Upload", "UserRound",
  "Users", "X", "Zap", "NotebookPen",
];
// settingsInput uses this allow-list. Existing names and UUIDs stay compatible.
export const uiIconNames = [...legacyUiIconNames, ...iconPackNames];
export const uiIconLabels = {
  Bike: "Велосипед", NotebookPen: "Журнал", Route: "Покатушка", Heart: "Лайк",
  MessageCircle: "Комментарии", Search: "Поиск", SlidersHorizontal: "Фильтры",
  Trophy: "Рекорды", Medal: "Награда", CheckCheck: "Заполненность",
  Zap: "Прокаченность", Users: "Участники", Bell: "Уведомления",
  Menu: "Мобильное меню", Info: "О проекте", Plus: "Добавить", Pencil: "Редактировать",
  Trash2: "Удалить", Camera: "Нет фотографии", LogOut: "Выйти", Shield: "Админка",
  UserRound: "Профиль", Upload: "Загрузить", Image: "Изображение",
  Settings: "Настройки", Settings2: "Настройки", ArrowUpRight: "Перейти",
  ChevronDown: "Раскрыть", ChevronUp: "Свернуть", ChevronLeft: "Назад",
  ChevronRight: "Вперёд", X: "Закрыть", Home: "Витрина", Lock: "Приватность",
  Globe: "Публичность", Flag: "Жалоба", Save: "Сохранить", RotateCcw: "Сбросить",
  CalendarDays: "Дата", Gauge: "Показатели", Wrench: "Обслуживание", BookOpen: "Справка",
  Palette: "Дизайн", History: "Журнал действий админки", Type: "Шрифты и тексты",
  Code2: "Код и технологии", ArrowLeft: "Назад", Calendar: "Календарь",
  Check: "Готово / подтверждение", Copy: "Копировать", ExternalLink: "Внешняя ссылка",
  Flame: "Популярное", Layers: "Слои / похожие сборки", Link: "Ссылка",
  LoaderCircle: "Индикатор загрузки", MapPin: "Точка на карте", Package: "Компонент",
  RefreshCw: "Обновить", ScanLine: "Распознать", ShieldCheck: "Модерация",
  Sparkles: "Новое", Star: "Звезда", TriangleAlert: "Предупреждение",
};
