"use client";
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
const icons = {
  home: Home,
  profile: UserRound,
  notifications: Bell,
  subscriptions: Users,
  records: Trophy,
  admin: Shield,
  logout: LogOut,
  bike: Bike,
  rides: Route,
  about: Info,
  add: Plus,
  heart: Heart,
};
const slots = {
  home: "navHomeIconId",
  bike: "navNewIconId",
  heart: "navPopularIconId",
  profile: "navProfileIconId",
  notifications: "navMessagesIconId",
  subscriptions: "navSubscriptionsIconId",
  records: "navRecordsIconId",
  admin: "navAdminIconId",
  logout: "navLogoutIconId",
  rides: "navRidesIconId",
  about: "navAboutIconId",
  add: "addBikeIconId",
};
function Graphic({ name, settings }) {
  const id = settings[slots[name]],
    Icon = icons[name] || Bike;
  return id ? (
    <img className="global-nav-graphic" src={"/api/assets/" + id} alt="" />
  ) : (
    <Icon className="global-nav-graphic-fallback" aria-hidden="true" />
  );
}
export default function GlobalHeader({ user, onProfile }) {
  const { personalSettings: settings } = useSite(),
    pathname = usePathname() || "/";
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
  const sections = navigationSections(settings).filter((s) => s.visible),
    active = activeSection(pathname, search);
  const graphic = (name) => <Graphic name={name} settings={settings} />;
  const link = (item) => (
    <a
      key={item.href}
      className="nav-menu-link"
      href={item.href}
      aria-current={pathname + search === item.href ? "page" : undefined}
    >
      {graphic(item.icon)}
      <span>{item.label}</span>
    </a>
  );
  const account = (
    <>
      <div className="nav-account-identity">
        <Avatar person={user} />
        <div>
          <strong>{user?.name}</strong>
          {user?.username && <small>@{user.username}</small>}
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
          href: user?.username ? "/u/" + user.username : "/account?tab=profile",
          label: "Мой профиль",
          icon: "profile",
        },
        { href: "/account?tab=bikes", label: "Мои велосипеды", icon: "bike" },
        { href: "/account?tab=rides", label: "Мои покатушки", icon: "rides" },
        {
          href: "/account?tab=achievements",
          label: "Достижения",
          icon: "records",
        },
        { href: "/feed", label: "Подписки", icon: "subscriptions" },
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
    <a className="nav-trigger" href="/account">
      {graphic("profile")}Войти
    </a>
  );
  return (
    <header
      className={
        "header global-header" + (settings.logoId ? " has-banner" : "")
      }
    >
      {settings.logoId && (
        <div className="global-header-banner" aria-hidden="true">
          <img
            className="global-header-banner-image"
            src={"/api/assets/" + settings.logoId}
            alt=""
          />
        </div>
      )}
      <a
        className={"brand" + (settings.logoId ? " brand-illustrated" : "")}
        href="/"
        aria-label="ColaBike — главная"
      >
        {settings.logoId ? (
          <img
            className="site-logo"
            src={"/api/assets/" + settings.logoId}
            alt=""
          />
        ) : (
          <>
            <span className="brand-mark">c.</span>
            <span>{settings.siteName}</span>
          </>
        )}
      </a>
      <div
        className="global-nav"
        data-icon-size={settings.navIconSize || "medium"}
      >
        <nav className="primary-navigation" aria-label="Основная навигация">
          {sections.map((section) =>
            section.id === "about" ? (
              <a
                key={section.id}
                className={
                  "nav-trigger" + (active === "about" ? " active" : "")
                }
                href="/about"
                aria-current={active === "about" ? "page" : undefined}
              >
                {graphic("about")}
                <span>{section.label}</span>
              </a>
            ) : (
              <NavPopover
                key={section.id}
                label={section.label}
                active={active === section.id}
                trigger={
                  <>
                    {graphic(section.id === "bikes" ? "home" : "rides")}
                    <span>{section.label}</span>
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
          <GlobalSearch assetId={settings.searchIconId} />
          {user && (
            <a
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
            </a>
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
            <Menu size={22} />
          </button>
        </div>
      </div>
      <CompactDialog
        open={mobile}
        onClose={() => setMobile(false)}
        title="Меню ColaBike"
        className="navigation-drawer"
      >
        <nav aria-label="Разделы сайта">
          {sections.map((section) => (
            <section className="mobile-nav-section" key={section.id}>
              {section.id === "about" ? (
                <a
                  className="nav-menu-link"
                  href="/about"
                  aria-current={active === "about" ? "page" : undefined}
                >
                  {graphic("about")}
                  {section.label}
                </a>
              ) : (
                <>
                  <h3 className={active === section.id ? "active" : ""}>
                    {section.label}
                  </h3>
                  {sectionLinks(section.id, user).map(link)}
                </>
              )}
            </section>
          ))}
        </nav>
        <section className="mobile-account" aria-label="Аккаунт">
          {user ? account : login}
        </section>
      </CompactDialog>
    </header>
  );
}
