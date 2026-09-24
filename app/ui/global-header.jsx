"use client";
import SiteIcon from "./site-icon.jsx";
import Link from "next/link";
import styles from "./global-header.module.css";
import ThemeControl from "./theme-control.jsx";
import SearchBox from "./search-box.jsx";
import { GlobalSearch, CompactDialog } from "./compact-ui.jsx";
import { useState, useEffect, useRef } from "react";
import { Bike, ChevronDown } from "./icons.jsx";
import { usePathname, useSearchParams } from "next/navigation";
import { useSite } from "./site-provider.jsx";
import { Avatar } from "./avatar.jsx";
import NavPopover from "./nav-popover.jsx";
import {
  navigationSections,
  sectionLinks,
  sectionHrefs,
  activeSection,
  mobileTabs,
} from "../../lib/navigation.js";
import { profilePath } from "../../lib/public-urls.js";
import { usernameLabel } from "../../lib/usernames.js";
const badge = (n) => (n >= 100 ? "99+" : n);
// Desktop: section links with submenus behind a chevron, search, theme and
// account. Below 1200px the sections move to the menu; below 768px the menu
// keeps everything and a tab bar holds the main sections (#104).
export default function GlobalHeader({
  user: shown,
  onProfile,
  previewSettings,
}) {
  const { personalSettings, t, viewer } = useSite();
  // Without an explicit user (loading, sign-in and recovery pages) the header
  // shows the reader the server layout knows (#74), never a guest by mistake.
  const user = shown ?? viewer;
  const settings = previewSettings || personalSettings;
  const pathname = usePathname() || "/";
  const params = useSearchParams();
  const search = params?.toString() ? "?" + params.toString() : "";
  const [loggingOut, setLoggingOut] = useState(false),
    [unread, setUnread] = useState(0),
    [menu, setMenu] = useState(false),
    [expanded, setExpanded] = useState(null),
    [stats, setStats] = useState(null);
  const statsRequest = useRef(false);
  useEffect(() => {
    setMenu(false);
  }, [pathname, search]);
  useEffect(() => {
    let active = true;
    setUnread(0);
    setStats(null);
    statsRequest.current = false;
    async function update() {
      if (!user) return;
      try {
        const r = await fetch("/api/community/notifications/count", {
          cache: "no-store",
        });
        if (r.ok && active) setUnread((await r.json()).unread);
      } catch {}
    }
    update();
    window.addEventListener("cola:notifications", update);
    return () => {
      active = false;
      window.removeEventListener("cola:notifications", update);
    };
  }, [user?.id, pathname]);
  async function loadStats() {
    if (!user || statsRequest.current) return;
    statsRequest.current = true;
    const results = await Promise.allSettled(
      ["social/account", "rides?own=1"].map(async (path) => {
        const r = await fetch("/api/" + path, { cache: "no-store" });
        if (!r.ok) throw Error();
        return r.json();
      }),
    );
    const account = results[0].status === "fulfilled" ? results[0].value : null;
    const rides = results[1].status === "fulfilled" ? results[1].value : null;
    setStats({
      bikes: account?.stats?.bikes,
      rides: rides?.total,
      distance: rides?.totalDistanceM,
    });
  }
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const r = await fetch("/api/auth/logout", { method: "POST" });
      if (!r.ok) {
        setLoggingOut(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setLoggingOut(false);
    }
  }
  function openMenu() {
    setExpanded(active);
    setMenu(true);
    loadStats();
  }
  const sections = navigationSections(settings)
      .filter((s) => s.visible)
      .map((s) => ({
        ...s,
        label:
          s.label === "Гараж"
            ? "Велосипеды"
            : s.label === "Поездки"
              ? "Покатушки"
              : s.label,
      })),
    active = activeSection(pathname, search),
    own = user?.username ? profilePath(user.username) : null,
    profileActive =
      !active &&
      (pathname.startsWith("/account") ||
        pathname === "/notifications" ||
        pathname === own);
  const graphic = (name) => (
    <SiteIcon name={name} className="global-nav-graphic" />
  );
  const link = (item) => (
    <Link
      key={item.href}
      className="nav-menu-link"
      href={item.href}
      // Profile links are not prefetched, see AuthorLink.
      prefetch={item.href.startsWith("/@") ? false : undefined}
      aria-current={pathname + search === item.href ? "page" : undefined}
    >
      {graphic(item.icon)}
      <span>{item.label}</span>
      {item.count > 0 && (
        <span className="nav-count">
          {badge(item.count)}
          <span className="sr-only"> непрочитанных</span>
        </span>
      )}
    </Link>
  );
  const account = (
    <>
      <div className="nav-account-identity">
        <Avatar person={user} />
        <div>
          <strong>{user?.name}</strong>
          {usernameLabel(user) && <small>{usernameLabel(user)}</small>}
        </div>
      </div>
      {stats && (
        <dl className="nav-account-stats">
          {[
            ["Велосипеды", stats.bikes],
            ["Покатушки", stats.rides],
            [
              "км",
              Number.isFinite(stats.distance)
                ? Math.round(stats.distance / 1000).toLocaleString("ru-RU")
                : undefined,
            ],
          ]
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className="nav-account-links">
        {[
          {
            href: own || "/account?tab=profile",
            label: "Мой профиль",
            icon: "profile",
          },
          { href: "/account?tab=bikes", label: "Мои велосипеды", icon: "bike" },
          { href: "/account?tab=rides", label: "Мои покатушки", icon: "rides" },
          { href: "/articles?own=1", label: "Мои статьи", icon: "articles" },
          {
            href: "/account?tab=achievements",
            label: "Достижения",
            icon: "records",
          },
          { href: "/feed", label: "Подписки", icon: "subscriptions" },
          { href: "/saved", label: "Сохранённое", icon: "saved" },
          {
            href: "/notifications",
            label: "Уведомления",
            icon: "notifications",
            count: unread,
          },
          ...(user?.role === "admin"
            ? [{ href: "/admin", label: "Админка", icon: "admin" }]
            : []),
        ].map(link)}
      </div>
      <button
        className="nav-menu-link"
        type="button"
        disabled={loggingOut}
        onClick={logout}
      >
        {graphic("logout")}
        <span>{loggingOut ? "Выходим…" : "Выйти"}</span>
      </button>
    </>
  );
  const login = onProfile ? (
    <button
      className="nav-login"
      type="button"
      onClick={() => {
        setMenu(false);
        onProfile();
      }}
    >
      Войти
    </button>
  ) : (
    <Link className="nav-login" href="/account">
      Войти
    </Link>
  );
  return (
    <div className={styles.frame}>
      <header className={`global-header ${styles.header}`}>
        <Link className="brand" href="/" aria-label="ColaBike — главная">
          <span className="brand-mark" aria-hidden="true">
            <Bike size={22} strokeWidth={2} />
          </span>
          <span>ColaBike</span>
        </Link>
        <nav className="primary-navigation" aria-label="Основная навигация">
          {sections.map((section) =>
            section.id === "about" ? (
              <Link
                key={section.id}
                className={
                  "nav-trigger nav-link" + (active === "about" ? " active" : "")
                }
                href={sectionHrefs.about}
                aria-current={active === "about" ? "page" : undefined}
              >
                {section.label}
              </Link>
            ) : (
              <NavPopover
                key={section.id}
                label={t("Подразделы") + ": " + section.label}
                href={sectionHrefs[section.id]}
                linkLabel={section.label}
                active={active === section.id}
                trigger={<ChevronDown size={14} aria-hidden="true" />}
              >
                {sectionLinks(section.id, user).map(link)}
              </NavPopover>
            ),
          )}
        </nav>
        <div className="nav-utilities">
          <div className="header-search" data-header-search>
            <SearchBox pill />
          </div>
          <GlobalSearch />
          <ThemeControl />
          {user && (
            <Link
              className={
                "global-nav-item nav-notifications" +
                (pathname === "/notifications" ? " active" : "")
              }
              href="/notifications"
              aria-label={"Уведомления: " + unread + " непрочитанных"}
              title="Уведомления"
            >
              {graphic("notifications")}
              {unread > 0 && (
                <span className="notification-badge">{badge(unread)}</span>
              )}
            </Link>
          )}
          <div className="desktop-account">
            {user ? (
              <NavPopover
                label={"Аккаунт — " + user.name}
                className="account-disclosure"
                onOpen={loadStats}
                active={pathname.startsWith("/account")}
                trigger={<Avatar person={user} size="small" />}
              >
                {account}
              </NavPopover>
            ) : (
              login
            )}
          </div>
          <button
            className="global-nav-item mobile-nav-toggle"
            type="button"
            aria-label="Открыть меню"
            aria-haspopup="dialog"
            aria-expanded={menu}
            onClick={openMenu}
          >
            <SiteIcon name="menu" />
          </button>
        </div>
        <CompactDialog
          open={menu}
          onClose={() => setMenu(false)}
          title="Меню ColaBike"
          className={`navigation-drawer ${styles.drawer}`}
        >
          <nav aria-label="Разделы сайта">
            {sections.map((section) => {
              const open = expanded === section.id,
                links =
                  section.id === "about" ? [] : sectionLinks(section.id, user);
              return (
                <section className="mobile-nav-section" key={section.id}>
                  <div className="mobile-nav-row">
                    <Link
                      className="mobile-nav-link"
                      href={sectionHrefs[section.id]}
                      aria-current={active === section.id ? "page" : undefined}
                    >
                      {graphic(section.id === "bikes" ? "bike" : section.id)}
                      <span>{section.label}</span>
                    </Link>
                    {links.length > 0 && (
                      <button
                        type="button"
                        className="mobile-nav-expand"
                        aria-label={t("Подразделы") + ": " + section.label}
                        aria-expanded={open}
                        aria-controls={"menu-" + section.id}
                        onClick={() => setExpanded(open ? null : section.id)}
                      >
                        <ChevronDown size={18} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {links.length > 0 && (
                    <div
                      id={"menu-" + section.id}
                      className="mobile-nav-links"
                      hidden={!open}
                    >
                      {links.map(link)}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>
          <section className="mobile-account" aria-label="Аккаунт">
            {user ? account : login}
          </section>
          <div className="mobile-theme">
            <span aria-hidden="true">Тёмная тема</span>
            <ThemeControl />
          </div>
        </CompactDialog>
      </header>
      <nav
        className={`mobile-tabbar ${styles.tabbar}`}
        aria-label="Главные разделы"
      >
        {mobileTabs(sections, user).map((tab) => {
          const current =
            tab.id === "profile" ? profileActive : active === tab.id;
          const content = (
            <>
              <span className={styles.tabIcon}>
                <SiteIcon name={tab.icon} size={22} />
                {tab.id === "profile" && unread > 0 && (
                  <span className={"notification-badge " + styles.tabBadge}>
                    {badge(unread)}
                  </span>
                )}
              </span>
              <span>{tab.label}</span>
            </>
          );
          return tab.id === "profile" && !user && onProfile ? (
            <button
              key={tab.id}
              type="button"
              className={styles.tab}
              onClick={onProfile}
            >
              {content}
            </button>
          ) : (
            <Link
              key={tab.id}
              className={styles.tab}
              href={tab.href}
              prefetch={tab.href.startsWith("/@") ? false : undefined}
              aria-current={current ? "page" : undefined}
              aria-label={
                tab.id === "profile" && unread > 0
                  ? tab.label + ": " + unread + " непрочитанных"
                  : undefined
              }
            >
              {content}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
