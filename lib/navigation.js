// Known destinations only; saved section visibility/order remain supported.
export const sectionDefaults = [
  { id: "bikes", label: "Велосипеды", visible: true },
  { id: "journal", label: "Журнал", visible: true },
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
    return sections;
  }
  return sectionDefaults;
}
export function sectionLinks(id, user) {
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
      { href: "/journal", label: "Новые", icon: "journal" },
      { href: "/j/new", label: "Добавить запись", icon: "add" },
      {
        href: "/journal?mode=following",
        label: "Подписки",
        icon: "subscriptions",
      },
    ];
  if (id === "bikes")
    return [
      { href: "/bikes", label: "Все велосипеды", icon: "bike" },
      { href: "/bikes?sort=new", label: "Новые", icon: "bike" },
      { href: "/bikes?sort=popular", label: "Популярные", icon: "heart" },
      { href: "/records", label: "Рекорды", icon: "records" },
      ...(user
        ? [
            {
              href: "/account?tab=bikes&action=add",
              label: "Добавить велосипед",
              icon: "add",
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
        icon: "add",
      },
      {
        href: "/account?tab=rides&action=import",
        label: "Импорт Garmin CSV",
        icon: "add",
      },
      {
        href: "/feed?type=rides",
        label: "Покатушки подписок",
        icon: "subscriptions",
      },
      {
        href: "/account?tab=rides&action=add",
        label: "Добавить покатушку",
        icon: "add",
      },
    ];
  return [];
}
export function activeSection(pathname, search = "") {
  const tab = new URLSearchParams(search).get("tab");
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
