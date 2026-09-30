"use client";
import type {
  SiteSettings,
  ViewerDto,
  CurrentUser,
  AccountOverviewDto,
  UnreadCountResponse,
} from "../../lib/contracts.ts";
import type { rideList } from "../../lib/rides.ts";
import type { MenuOrigin } from "./nav-popover.tsx";
import SiteIcon from "./site-icon.tsx";
import Link from "next/link";
import styles from "./global-header.module.css";
import ThemeControl from "./theme-control.tsx";
import SmallImage from "./small-image.tsx";
import { GlobalSearch, CompactDialog } from "./compact-ui.tsx";
import { useState, useEffect, useRef } from "react";
import { Bike, ChevronDown } from "./icons.tsx";
import { usePathname, useSearchParams } from "next/navigation";
import { useSite } from "./site-provider.tsx";
import { Avatar } from "./avatar.tsx";
import NavPopover from "./nav-popover.tsx";
import {
  navigationSections,
  sectionLinks,
  activeSection,
} from "../../lib/navigation.ts";
import { profilePath } from "../../lib/public-urls.ts";
import { usernameLabel } from "../../lib/usernames.ts";
export default function GlobalHeader({
  user: shown,
  onProfile,
  previewSettings,
}: {
  user?: ViewerDto | CurrentUser | null;
  onProfile?: () => void;
  previewSettings?: Partial<SiteSettings>;
}) {
  const { personalSettings, t, viewer, chatEnabled } = useSite();
  // Without an explicit user (loading, sign-in and recovery pages) the header
  // shows the reader the server layout knows (#74), never a guest by mistake.
  const user = shown ?? viewer;
  const userId = user?.id;
  const chatVerified = !!user?.email_verified_at;
  const settings = previewSettings || personalSettings;
  const pathname = usePathname() || "/";
  const params = useSearchParams();
  const search = params?.toString() ? "?" + params.toString() : "";
  const [loggingOut, setLoggingOut] = useState(false),
    [unread, setUnread] = useState(0),
    [mobile, setMobile] = useState(false),
    [stats, setStats] = useState<{
      bikes?: number;
      rides?: number;
      distance?: number;
    } | null>(null),
    [openSection, setOpenSection] = useState<string | null>(null),
    [indicator, setIndicator] = useState<{
      left: number;
      width: number;
    } | null>(null);
  const menuOrigin = useRef<MenuOrigin | null>(null),
    navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const selected =
      openSection &&
      nav?.querySelector<HTMLElement>(`[data-section="${openSection}"]`);
    if (!selected) {
      setIndicator(null);
      return;
    }
    const update = () =>
      setIndicator({ left: selected.offsetLeft, width: selected.offsetWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav!);
    return () => observer.disconnect();
  }, [openSection]);
  const statsRequest = useRef(false);
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    let active = true;
    setChatUnread(0);
    if (!userId || !chatEnabled || !chatVerified) return;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/chat/unread", { cache: "no-store" });
        if (response.ok && active)
          setChatUnread(
            ((await response.json()) as UnreadCountResponse).unread,
          );
      } catch {
        // Unread counters are optional; navigation stays available offline.
      }
    }
    function received(event: Event) {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof detail === "number" && Number.isFinite(detail))
        setChatUnread(detail);
    }
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("cola:chat-unread", received);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("cola:chat-unread", received);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId, chatEnabled, chatVerified, pathname]);
  useEffect(() => {
    setMobile(false);
    setOpenSection(null);
  }, [pathname, search]);
  useEffect(() => {
    let active = true;
    setUnread(0);
    setStats(null);
    statsRequest.current = false;
    async function update() {
      if (!userId) return;
      try {
        const r = await fetch("/api/community/notifications/count", {
          cache: "no-store",
        });
        if (r.ok) {
          const data: UnreadCountResponse = await r.json();
          if (active) setUnread(data.unread);
        }
      } catch {
        // A failed counter refresh must not interrupt navigation.
      }
    }
    update();
    window.addEventListener("cola:notifications", update);
    return () => {
      active = false;
      window.removeEventListener("cola:notifications", update);
    };
  }, [userId, pathname]);
  async function loadStats() {
    if (!user || statsRequest.current) return;
    statsRequest.current = true;
    async function load<T>(path: string): Promise<T> {
      const r = await fetch("/api/" + path, { cache: "no-store" });
      if (!r.ok) throw Error();
      return r.json();
    }
    const results = await Promise.allSettled([
      load<AccountOverviewDto>("social/account"),
      load<Awaited<ReturnType<typeof rideList>>>("rides?own=1"),
    ]);
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
      // New session: reload the server viewer and discard private client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
  const graphic = (name: string) => (
    <SiteIcon name={name} settings={settings} className="global-nav-graphic" />
  );
  const link = (item: { href: string; icon: string; label: string }) => (
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
                ? Math.round(stats.distance! / 1000).toLocaleString("ru-RU")
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
        {chatEnabled && (
          <Link className="nav-menu-link" href="/messages">
            {graphic("messages")}
            <span>Сообщения</span>
            {chatUnread > 0 && (
              <small>{chatUnread > 99 ? "99+" : chatUnread}</small>
            )}
          </Link>
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
          {
            href: "/notifications",
            label: "Уведомления",
            icon: "notifications",
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
            {settings.faviconId ? (
              <SmallImage
                src={"/api/assets/" + settings.faviconId}
                alt=""
                priority
              />
            ) : (
              <Bike size={18} strokeWidth={2} />
            )}
          </span>
          {settings.brandLogoId ? (
            <SmallImage
              className={styles.wordmark}
              src={"/api/assets/" + settings.brandLogoId}
              alt="ColaBike"
              priority
              fallback="ColaBike"
            />
          ) : (
            <span>ColaBike</span>
          )}
        </Link>
        <div className="global-nav">
          <nav
            ref={navigation}
            className="primary-navigation"
            aria-label="Основная навигация"
          >
            {sections.map((section) =>
              section.id === "about" ? (
                <Link
                  key={section.id}
                  data-section="about"
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
                  section={section.id}
                  open={openSection === section.id}
                  onOpenChange={(next) =>
                    setOpenSection((current) =>
                      next
                        ? section.id
                        : current === section.id
                          ? null
                          : current,
                    )
                  }
                  motionOrigin={menuOrigin}
                  label={t("Подразделы") + ": " + section.label}
                  href={
                    {
                      bikes: "/bikes",
                      components: "/components",
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
                  trigger={<ChevronDown size={14} aria-hidden="true" />}
                >
                  {sectionLinks(section.id, user).map(link)}
                </NavPopover>
              ),
            )}
            <span
              className={styles.menuIndicator}
              aria-hidden="true"
              style={{
                opacity: indicator ? 1 : 0,
                width: indicator?.width || 0,
                transform: `translateX(${indicator?.left || 0}px)`,
              }}
            />
          </nav>
          <div className="nav-utilities">
            <GlobalSearch />
            <ThemeControl />
            {user && chatEnabled && (
              <Link
                className={
                  "global-nav-item " +
                  styles.chatUtility +
                  (pathname === "/messages" ? " active" : "")
                }
                href="/messages"
                aria-label={"Сообщения: " + chatUnread + " непрочитанных"}
                data-tooltip="Сообщения"
              >
                {graphic("messages")}
                {chatUnread > 0 && (
                  <span className="notification-badge">
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
              </Link>
            )}
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
                // The avatar itself opens the account (#245); the menu has
                // its own chevron, so one click never means both.
                <NavPopover
                  label={"Аккаунт — " + user.name}
                  className="account-disclosure"
                  onOpen={loadStats}
                  href="/account"
                  linkName="Личный кабинет"
                  linkLabel={<Avatar person={user} size="small" />}
                  active={pathname.startsWith("/account")}
                  trigger={<ChevronDown size={14} aria-hidden="true" />}
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
              <SiteIcon name="menu" />
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
              <section
                className="mobile-nav-section"
                data-section={section.id}
                key={section.id}
              >
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
                            components: "/components",
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
