import { profilePath } from "./public-urls.js";
// Known destinations only; saved section visibility/order remain supported.
export const sectionDefaults = [
  { id: "bikes", label: "Велосипеды", visible: true },
  { id: "journal", label: "Журнал", visible: true },
  { id: "articles", label: "Статьи", visible: true },
  { id: "rides", label: "Покатушки", visible: true },
  { id: "market", label: "Рынок", visible: true },
  { id: "about", label: "О проекте", visible: true },
];
export function navigationSections(settings) {
  if (settings.navigation) {
    const sections = [...settings.navigation];
    if (!sections.some((s) => s.id === "journal"))
      sections.splice(
        Math.max(0, sections.findIndex((s) => s.id === "bikes") + 1),
        0,
        sectionDefaults[1],
      );
    if (!sections.some((s) => s.id === "market"))
      sections.splice(
        Math.max(
          0,
          sections.findIndex((s) => s.id === "about"),
        ),
        0,
        sectionDefaults.find((s) => s.id === "market"),
      );
    if (!sections.some((s) => s.id === "articles"))
      sections.splice(
        Math.max(0, sections.findIndex((s) => s.id === "journal") + 1),
        0,
        sectionDefaults.find((s) => s.id === "articles"),
      );
    return sections;
  }
  return sectionDefaults;
}
// Section roots: the header link and the start of every submenu.
export const sectionHrefs = {
  bikes: "/bikes",
  journal: "/journal",
  articles: "/articles",
  rides: "/rides",
  market: "/market",
  about: "/about",
};
// The mobile tab bar (#104): four fixed sections while the admin keeps them
// in the menu, then the reader's profile (sign-in for guests).
export function mobileTabs(sections, user) {
  const shown = new Set(sections.filter((s) => s.visible).map((s) => s.id));
  return [
    { id: "bikes", label: "Велосипеды", icon: "bike" },
    { id: "rides", label: "Покатушки", icon: "rides" },
    { id: "journal", label: "Журнал", icon: "journal" },
    { id: "market", label: "Рынок", icon: "market" },
  ]
    .filter((tab) => shown.has(tab.id))
    .map((tab) => ({ ...tab, href: sectionHrefs[tab.id] }))
    .concat({
      id: "profile",
      label: "Профиль",
      icon: "profile",
      href: !user
        ? "/account"
        : user.username
          ? profilePath(user.username)
          : "/account?tab=profile",
    });
}
export function sectionLinks(id, user) {
  if (id === "articles")
    return [
      { href: "/articles", label: "База знаний", icon: "articles" },
      { href: "/articles?own=1", label: "Мои статьи", icon: "profile" },
      { href: "/articles/new", label: "Написать статью", icon: "write" },
    ];
  if (id === "market")
    return [
      { href: "/market", label: "Все объявления", icon: "market" },
      { href: "/market?category=bikes", label: "Велосипеды", icon: "bike" },
      {
        href: "/market?category=components",
        label: "Комплектующие",
        icon: "market",
      },
      {
        href: "/market?category=accessories",
        label: "Аксессуары",
        icon: "market",
      },
      { href: "/market?own=1", label: "Мои объявления", icon: "profile" },
      { href: "/market/new", label: "Добавить объявление", icon: "add" },
    ];
  if (id === "journal")
    return [
      { href: "/journal", label: "Новые", icon: "new" },
      { href: "/j/new", label: "Добавить запись", icon: "write" },
      {
        href: "/journal?mode=following",
        label: "Подписки",
        icon: "subscriptions",
      },
    ];
  if (id === "bikes")
    return [
      { href: "/bikes", label: "Все велосипеды", icon: "bike" },
      { href: "/bikes?sort=new", label: "Новые", icon: "new" },
      { href: "/bikes?sort=popular", label: "Популярные", icon: "popular" },
      { href: "/records", label: "Рекорды", icon: "records" },
      ...(user
        ? [
            {
              href: "/account?tab=bikes&action=add",
              label: "Добавить велосипед",
              icon: "addBike",
            },
          ]
        : []),
    ];
  if (id === "rides")
    return [
      { href: "/rides", label: "Лента покатушек", icon: "rides" },
      { href: "/rides?status=planned", label: "Предстоящие", icon: "rides" },
      {
        href: "/account?tab=rides&action=plan",
        label: "Запланировать",
        icon: "plan",
      },
      {
        href: "/account?tab=rides&action=import",
        label: "Импорт Garmin CSV",
        icon: "import",
      },
      {
        href: "/feed?type=rides",
        label: "Покатушки подписок",
        icon: "subscriptions",
      },
      {
        href: "/account?tab=rides&action=add",
        label: "Добавить покатушку",
        icon: "addRide",
      },
    ];
  return [];
}
export function activeSection(pathname, search = "") {
  const tab = new URLSearchParams(search).get("tab");
  if (pathname === "/articles" || pathname.startsWith("/articles/"))
    return "articles";
  if (pathname === "/market" || pathname.startsWith("/market/"))
    return "market";
  if (pathname === "/about") return "about";
  if (
    pathname === "/journal" ||
    pathname.startsWith("/j/") ||
    pathname === "/saved" ||
    (pathname === "/feed" && !search.includes("type=rides"))
  )
    return "journal";
  if (
    pathname === "/rides" ||
    pathname.startsWith("/r/") ||
    pathname === "/feed" ||
    (pathname === "/account" && tab === "rides")
  )
    return "rides";
  if (
    pathname === "/bikes" ||
    pathname.startsWith("/b/") ||
    pathname === "/records" ||
    (pathname === "/account" && tab === "bikes")
  )
    return "bikes";
  return null;
}
