"use client";
import { useState } from "react";
import { Home, UserRound, MessageCircle, Shield, LogOut } from "lucide-react";
import { usePathname } from "next/navigation";
import { useSite } from "./site-provider.jsx";

function Graphic({ assetId, Fallback }) {
  return assetId ? (
    <img className="global-nav-graphic" src={"/api/assets/" + assetId} alt="" />
  ) : (
    <Fallback className="global-nav-graphic-fallback" aria-hidden="true" />
  );
}

function NavLink({ href, label, tooltip = label, assetId, Fallback, active = false }) {
  return (
    <a
      className={"global-nav-item" + (active ? " active" : "")}
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-tooltip={tooltip}
    >
      <Graphic assetId={assetId} Fallback={Fallback} />
    </a>
  );
}

export default function GlobalHeader({ user }) {
  const { personalSettings: settings } = useSite();
  const pathname = usePathname() || "/";
  const [loggingOut, setLoggingOut] = useState(false);
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

  return (
    <header className="header global-header">
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

      <nav className="global-nav" aria-label="Основная навигация">
        <NavLink
          href="/"
          label="Главная"
          tooltip="Главная"
          assetId={settings.navHomeIconId}
          Fallback={Home}
          active={pathname === "/"}
        />
        <NavLink
          href="/account"
          label={profileTooltip}
          tooltip={profileTooltip}
          assetId={settings.navProfileIconId}
          Fallback={UserRound}
          active={pathname.startsWith("/account")}
        />
        <button
          type="button"
          className="global-nav-item future"
          aria-label="Сообщения — скоро"
          aria-disabled="true"
          data-tooltip="Сообщения — скоро"
          onClick={(event) => event.preventDefault()}
        >
          <Graphic assetId={settings.navMessagesIconId} Fallback={MessageCircle} />
        </button>
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
