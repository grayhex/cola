"use client";
import SiteEmoji from "./site-emoji.jsx";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import styles from "./global-header.module.css";
import ThemeControl from "./theme-control.jsx";
import { GlobalSearch, CompactDialog } from "./compact-ui.jsx";
import { useState, useEffect, useRef } from "react";
import {
  Home,
  UserRound,
  Bell,
  Users,
  Trophy,
  Shield,
  LogOut,
  Bike,
  Route,
  Info,
  ChevronDown,
  Menu,
  Plus,
  Heart,
  BookOpen,
  Save,
} from "./icons.jsx";
import { usePathname, useSearchParams } from "next/navigation";
import { useSite } from "./site-provider.jsx";
import { Avatar } from "./avatar.jsx";
import NavPopover from "./nav-popover.jsx";
import {
  navigationSections,
  sectionLinks,
  activeSection,
} from "../../lib/navigation.js";
import { profilePath } from "../../lib/public-urls.js";
import { usernameLabel } from "../../lib/usernames.js";
export default function GlobalHeader({ user, onProfile, previewSettings }) {
  const { personalSettings, t } = useSite();
  const settings = previewSettings || personalSettings;
  const pathname = usePathname() || "/";
  const params = useSearchParams();
  const search = params?.toString() ? "?" + params.toString() : "";
  const [loggingOut, setLoggingOut] = useState(false),
    [unread, setUnread] = useState(0),
    [mobile, setMobile] = useState(false),
    [stats, setStats] = useState(null);
  const statsRequest = useRef(false);
  useEffect(() => {
    setMobile(false);
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
    active = activeSection(pathname, search);
  const graphic = (name) => (
    <SiteEmoji name={name} settings={settings} className="global-nav-graphic" />
  );
  const link = (item) => (
    <Link
      key={item.href}
      className="nav-menu-link"
      href={item.href}
      aria-current={pathname + search === item.href ? "page" : undefined}
    >
      {graphic(item.icon)}
      <span>{item.label}</span>
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
      {[
        {
          href: user?.username
            ? profilePath(user.username)
            : "/account?tab=profile",
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
        { href: "/notifications", label: "Уведомления", icon: "notifications" },
        ...(user?.role === "admin"
          ? [{ href: "/admin", label: "Админка", icon: "admin" }]
          : []),
      ].map(link)}
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
      className="nav-trigger"
      onClick={() => {
        setMobile(false);
        onProfile();
      }}
    >
      {graphic("profile")}Войти
    </button>
  ) : (
    <Link className="nav-trigger" href="/account">
      {graphic("profile")}Войти
    </Link>
  );
  return (
    <div className={styles.frame}>
      <header className={`global-header ${styles.header}`}>
        <Link className="brand" href="/" aria-label="ColaBike — главная">
          <span className="brand-mark" aria-hidden="true">
            <Bike size={26} />
          </span>
          <span>ColaBike</span>
        </Link>
        <div className="global-nav">
          <nav className="primary-navigation" aria-label="Основная навигация">
            {sections.map((section) =>
              section.id === "about" ? (
                <Link
                  key={section.id}
                  className={
                    "nav-trigger" + (active === "about" ? " active" : "")
                  }
                  href="/about"
                  aria-current={active === "about" ? "page" : undefined}
                >
                  {graphic("about")}
                  <span>{section.label}</span>
                </Link>
              ) : (
                <NavPopover
                  key={section.id}
                  label={t("Подразделы") + ": " + section.label}
                  href={
                    {
                      bikes: "/bikes",
                      journal: "/journal",
                      articles: "/articles",
                      rides: "/rides",
                      market: "/market",
                    }[section.id]
                  }
                  linkLabel={
                    <>
                      {graphic(section.id === "bikes" ? "bike" : section.id)}
                      <span>{section.label}</span>
                    </>
                  }
                  active={active === section.id}
                  trigger={
                    <>
                      <ChevronDown size={13} aria-hidden="true" />
                    </>
                  }
                >
                  {sectionLinks(section.id, user).map(link)}
                </NavPopover>
              ),
            )}
          </nav>
          <div className="nav-utilities">
            <GlobalSearch />
            <ThemeControl />
            {user && (
              <Link
                className={
                  "global-nav-item" +
                  (pathname === "/notifications" ? " active" : "")
                }
                href="/notifications"
                aria-label={"Уведомления: " + unread + " непрочитанных"}
                data-tooltip="Уведомления"
              >
                {graphic("notifications")}
                {unread > 0 && (
                  <span className="notification-badge">
                    {unread >= 100 ? "99+" : unread}
                  </span>
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
              aria-expanded={mobile}
              onClick={() => {
                setMobile(true);
                loadStats();
              }}
            >
              <SiteEmoji name="menu" />
            </button>
          </div>
        </div>
        <CompactDialog
          open={mobile}
          onClose={() => setMobile(false)}
          title="Меню ColaBike"
          className={`navigation-drawer ${styles.drawer}`}
        >
          <nav aria-label="Разделы сайта">
            {sections.map((section) => (
              <section className="mobile-nav-section" key={section.id}>
                {section.id === "about" ? (
                  <Link
                    className="nav-menu-link"
                    href="/about"
                    aria-current={active === "about" ? "page" : undefined}
                  >
                    {graphic("about")}
                    {section.label}
                  </Link>
                ) : (
                  <details open>
                    <summary>
                      <Link
                        href={
                          {
                            bikes: "/bikes",
                            journal: "/journal",
                            articles: "/articles",
                            rides: "/rides",
                            market: "/market",
                          }[section.id]
                        }
                        aria-current={
                          active === section.id ? "page" : undefined
                        }
                      >
                        {graphic(section.id === "bikes" ? "bike" : section.id)}
                        {section.label}
                      </Link>
                    </summary>
                    {sectionLinks(section.id, user).map(link)}
                  </details>
                )}
              </section>
            ))}
          </nav>
          <section className="mobile-account" aria-label="Аккаунт">
            {user ? account : login}
          </section>
        </CompactDialog>
      </header>
    </div>
  );
}
