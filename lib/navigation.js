// Known destinations only; saved section visibility/order remain supported.
export const sectionDefaults = [
  { id: "bikes", label: "Велосипеды", visible: true },
  { id: "journal", label: "Журнал", visible: true },
  { id: "rides", label: "Покатушки", visible: true },
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
    return sections;
  }
  // Keep the relative intent of legacy ordering when upgrading existing sites.
  const order = settings.navOrder || [];
  return [...sectionDefaults].sort((a, b) => {
    const rank = (id) => {
      if (id === "journal") {
        const i = order.indexOf("home");
        return i < 0 ? 99 : i + 0.5;
      }
      const i = order.indexOf({ bikes: "home", rides: "subscriptions" }[id]);
      return i < 0 ? 99 : i;
    };
    return rank(a.id) - rank(b.id);
  });
}
export function sectionLinks(id, user) {
  if (id === "journal")
    return [
      { href: "/journal", label: "Новые", icon: "journal" },
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
