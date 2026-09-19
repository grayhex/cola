"use client";
import { GlobalSearch } from "./compact-ui.jsx";
import { useState, useEffect } from "react";
import {
  Home,
  UserRound,
  Bell,
  Users,
  Trophy,
  Shield,
  LogOut,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useSite } from "./site-provider.jsx";

function Graphic({ assetId, Fallback }) {
  return assetId ? (
    <img className="global-nav-graphic" src={"/api/assets/" + assetId} alt="" />
  ) : (
    <Fallback className="global-nav-graphic-fallback" aria-hidden="true" />
  );
}

function NavLink({
  href,
  label,
  tooltip = label,
  assetId,
  Fallback,
  active = false,
  badge = 0,
}) {
  return (
    <a
      className={"global-nav-item" + (active ? " active" : "")}
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-tooltip={tooltip}
    >
      <Graphic assetId={assetId} Fallback={Fallback} />
      {badge > 0 && (
        <span className="notification-badge">
          {badge >= 100 ? "99+" : badge}
        </span>
      )}
    </a>
  );
}

export default function GlobalHeader({ user, onProfile }) {
  const { personalSettings: settings } = useSite();
  const pathname = usePathname() || "/";
  const [loggingOut, setLoggingOut] = useState(false);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    async function update() {
      if (!user) {
        setUnread(0);
        return;
      }
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
  const profileTooltip = user ? `Профиль — ${user.name}` : "Войти";

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/");
    }
  }

  const hasIllustratedHeader = Boolean(settings.logoId);

  return (
    <header
      className={
        "header global-header" + (hasIllustratedHeader ? " has-banner" : "")
      }
    >
      {hasIllustratedHeader && (
        <div className="global-header-banner" aria-hidden="true">
          <img
            className="global-header-banner-image"
            src={"/api/assets/" + settings.logoId}
            alt=""
          />
        </div>
      )}

      <a
        className={"brand" + (hasIllustratedHeader ? " brand-illustrated" : "")}
        href="/"
        aria-label="ColaBike — главная"
      >
        {hasIllustratedHeader ? (
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

      <nav className="global-nav" aria-label="Основная навигация">
        <NavLink
          href="/"
          label={settings.showcaseTitle || "Витрина"}
          tooltip={settings.showcaseTitle || "Витрина"}
          assetId={settings.navHomeIconId}
          Fallback={Home}
          active={pathname === "/"}
        />
        {!user && onProfile ? (
          <button
            type="button"
            className="global-nav-item"
            aria-label="Войти"
            data-tooltip="Профиль — войти"
            onClick={onProfile}
          >
            <Graphic assetId={settings.navProfileIconId} Fallback={UserRound} />
          </button>
        ) : (
          <NavLink
            href="/account"
            label={profileTooltip}
            tooltip={profileTooltip}
            assetId={settings.navProfileIconId}
            Fallback={UserRound}
            active={pathname.startsWith("/account")}
          />
        )}
        <NavLink
          href="/feed"
          label="Подписки"
          assetId={settings.navSubscriptionsIconId}
          Fallback={Users}
          active={pathname === "/feed"}
        />
        <NavLink
          href="/records"
          label="Рекорды"
          assetId={settings.navRecordsIconId}
          Fallback={Trophy}
          active={pathname === "/records"}
        />
        <NavLink
          href="/notifications"
          label={
            "Уведомления: " +
            (unread >= 100 ? "99+" : unread) +
            " непрочитанных"
          }
          tooltip="Уведомления"
          assetId={settings.navMessagesIconId}
          Fallback={Bell}
          active={pathname === "/notifications"}
          badge={unread}
        />
        <GlobalSearch assetId={settings.searchIconId} />
        {user?.role === "admin" && (
          <NavLink
            href="/admin"
            label="Админка"
            tooltip="Админка"
            assetId={settings.navAdminIconId}
            Fallback={Shield}
            active={pathname.startsWith("/admin")}
          />
        )}
        {user && (
          <button
            type="button"
            className="global-nav-item"
            aria-label="Выйти"
            data-tooltip={loggingOut ? "Выходим…" : "Выйти"}
            disabled={loggingOut}
            onClick={logout}
          >
            <Graphic assetId={settings.navLogoutIconId} Fallback={LogOut} />
          </button>
        )}
      </nav>
    </header>
  );
}
