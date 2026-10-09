import type { SiteSettings, Viewer } from "./contracts.ts";
/**
 * Where «Добавить велосипед» leads when it is a plain link: the account opens
 * the wizard there. A signed-in rider on another page gets the same wizard over
 * that page instead (#378, `AddBikeLink`); the address stays for new windows,
 * old bookmarks and guests.
 */
export const addBikeHref = "/account?tab=bikes&action=add";
/**
 * What «Хочу кататься» and «Организовать покатушку» lead a guest to (#378):
 * the page of the scenario, which asks for an account first — in the form of
 * registering (`auth=register`), with «Уже есть аккаунт? Войти» at hand. After
 * signing up or in the same page loads again and opens that scenario; nothing
 * is created by it. For a signed-in rider the plain addresses stay.
 */
export const ridingHref = {
  intent: "/ride-intents?new=1",
  plan: "/account?tab=rides&action=plan",
} as const;
export const guestRidingHref = {
  intent: ridingHref.intent + "&auth=register",
  plan: ridingHref.plan + "&auth=register",
} as const;
// Known destinations only; saved section visibility/order remain supported.
export const sectionDefaults: NonNullable<SiteSettings["navigation"]> = [
  { id: "bikes", label: "Велосипеды", visible: true },
  { id: "components", label: "Компоненты", visible: true },
  { id: "journal", label: "Журнал", visible: true },
  { id: "articles", label: "Статьи", visible: true },
  { id: "rides", label: "Покатушки", visible: true },
  { id: "achievements", label: "Достижения", visible: true },
  { id: "market", label: "Рынок", visible: true },
  { id: "about", label: "О проекте", visible: true },
];
export function navigationSections(settings: Partial<SiteSettings>) {
  if (settings.navigation) {
    const sections = [...settings.navigation];
    if (!sections.some((s) => s.id === "journal"))
      sections.splice(
        Math.max(0, sections.findIndex((s) => s.id === "bikes") + 1),
        0,
        sectionDefaults.find((s) => s.id === "journal")!,
      );
    if (!sections.some((s) => s.id === "market"))
      sections.splice(
        Math.max(
          0,
          sections.findIndex((s) => s.id === "about"),
        ),
        0,
        sectionDefaults.find((s) => s.id === "market")!,
      );
    if (!sections.some((s) => s.id === "articles"))
      sections.splice(
        Math.max(0, sections.findIndex((s) => s.id === "journal") + 1),
        0,
        sectionDefaults.find((s) => s.id === "articles")!,
      );
    // «Достижения» (#382): added once to a list saved before it existed, after
    // «Покатушки»; a list that has it, hidden or moved, is left as it is.
    if (!sections.some((s) => s.id === "achievements"))
      sections.splice(
        sections.some((s) => s.id === "rides")
          ? sections.findIndex((s) => s.id === "rides") + 1
          : Math.max(
              0,
              sections.findIndex((s) => s.id === "about"),
            ),
        0,
        sectionDefaults.find((s) => s.id === "achievements")!,
      );
    if (!sections.some((s) => s.id === "components"))
      sections.splice(
        Math.max(0, sections.findIndex((s) => s.id === "bikes") + 1),
        0,
        sectionDefaults.find((s) => s.id === "components")!,
      );
    return sections;
  }
  return sectionDefaults;
}
export function sectionLinks(
  id: string,
  user: Pick<NonNullable<Viewer>, "username"> | null,
) {
  if (id === "components")
    return [
      { href: "/components", label: "Популярные", icon: "popular" },
      { href: "/components?sort=new", label: "Новые", icon: "new" },
    ];
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
      ...(user
        ? [
            {
              href: addBikeHref,
              label: "Добавить велосипед",
              icon: "addBike",
            },
          ]
        : []),
    ];
  // The two tabs of the page /records (#382): the records of bikes, rides and
  // riders, and the awards.
  if (id === "achievements")
    return [
      { href: "/records", label: "Рекорды", icon: "records" },
      { href: "/records?tab=awards", label: "Награды", icon: "awards" },
    ];
  if (id === "rides")
    return [
      { href: "/rides", label: "Предстоящие", icon: "rides" },
      { href: "/rides?status=all", label: "Все покатушки", icon: "rides" },
      {
        href: user ? ridingHref.plan : guestRidingHref.plan,
        label: "Запланировать",
        icon: "plan",
      },
      {
        href: "/feed?type=rides",
        label: "Покатушки подписок",
        icon: "subscriptions",
      },
    ];
  return [];
}
export function activeSection(pathname: string, search = "") {
  const tab = new URLSearchParams(search).get("tab");
  if (
    pathname === "/components" ||
    pathname.startsWith("/components/") ||
    pathname.startsWith("/experience/parts/")
  )
    return "components";
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
  if (pathname === "/records") return "achievements";
  if (
    pathname === "/bikes" ||
    pathname.startsWith("/b/") ||
    (pathname === "/account" && tab === "bikes")
  )
    return "bikes";
  return null;
}
