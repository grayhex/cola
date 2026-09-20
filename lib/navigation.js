// Known destinations only. Legacy icon slots remain authoritative.
export const sectionDefaults = [
  { id: "bikes", label: "Велосипеды", visible: true },
  { id: "rides", label: "Покатушки", visible: true },
  { id: "about", label: "О проекте", visible: true },
];
export function navigationSections(settings) {
  if (settings.navigation) return settings.navigation;
  // Keep the relative intent of legacy ordering when upgrading existing sites.
  const order = settings.navOrder || [];
  return [...sectionDefaults].sort((a, b) => {
    const rank = (id) => {
      const i = order.indexOf({ bikes: "home", rides: "subscriptions" }[id]);
      return i < 0 ? 99 : i;
    };
    return rank(a.id) - rank(b.id);
  });
}
export function sectionLinks(id, user) {
  if (id === "bikes")
    return [
      { href: "/", label: "Витрина", icon: "home" },
      { href: "/?sort=new", label: "Новые", icon: "bike" },
      { href: "/?sort=popular", label: "Популярные", icon: "heart" },
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
    pathname === "/rides" ||
    pathname.startsWith("/r/") ||
    pathname === "/feed" ||
    (pathname === "/account" && tab === "rides")
  )
    return "rides";
  if (
    pathname === "/" ||
    pathname.startsWith("/b/") ||
    pathname.startsWith("/j/") ||
    pathname === "/records" ||
    (pathname === "/account" && tab === "bikes")
  )
    return "bikes";
  return null;
}
