"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { accentText, readableAccent } from "../../lib/appearance.js";
import {
  appearanceDefaults,
  backgroundCss,
  resolveTheme,
  themeStorageKey,
  validTheme,
} from "../../lib/theme.js";
import { useBrowseHistory } from "./showcase-scroll.js";
import { installErrorReporting } from "./error-reporting.js";
import { defaultSettings, defaultCatalog } from "../../lib/site-defaults.js";
const Context = createContext(null);
export function ThemeStyle({ settings }) {
  const accent = /^#[\da-f]{6}$/i.test(settings.appearance?.accent || "")
    ? settings.appearance.accent
    : appearanceDefaults.accent;
  return (
    <style>{`:root{--accent:${accent};--accent-foreground:${accentText(accent)};--accent-text-light:${readableAccent(accent, "light")};--accent-text-dark:${readableAccent(accent, "dark")};--photo-ratio:${settings.photoRatio || "4/3"};--desktop-columns:${settings.desktopColumns || 3};--heading-align:${settings.textAlign || "left"}}${backgroundCss(settings)}`}</style>
  );
}
export default function SiteProvider({
  initial,
  viewer: initialViewer = null,
  children,
}) {
  useBrowseHistory();
  useEffect(() => installErrorReporting(), []);
  const [site, setSite] = useState(
    initial || { settings: defaultSettings, catalog: defaultCatalog },
  );
  // The server layout already knows who is reading (#74): pages start with
  // the right header and personal settings instead of asking /api/me.
  const [viewer, setViewerState] = useState(initialViewer);
  const [preferences, setPreferences] = useState(
    initialViewer?.preferences || {},
  );
  const setViewer = useCallback((user) => {
    setViewerState(user || null);
    setPreferences(user?.preferences || {});
  }, []);
  // After signing in or editing the profile without a page load.
  const refreshViewer = useCallback(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось проверить вход");
    const { user } = await response.json();
    setViewer(user);
    return user;
  }, [setViewer]);
  const defaultTheme = validTheme(site.settings.appearance?.theme);
  const [themePreference, setPreference] = useState(defaultTheme);
  const currentPreference = useRef(defaultTheme);
  const [themeReady, setThemeReady] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState(
    defaultTheme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      let preference = currentPreference.current;
      try {
        preference = validTheme(
          localStorage.getItem(themeStorageKey),
          defaultTheme,
        );
      } catch {}
      currentPreference.current = preference;
      setPreference(preference);
      document.documentElement.dataset.themePreference = preference;
      const actual = resolveTheme(preference, media.matches);
      document.documentElement.dataset.theme = actual;
      setResolvedTheme(actual);
      setThemeReady(true);
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, [defaultTheme]);
  function setThemePreference(value) {
    const preference = validTheme(value);
    try {
      localStorage.setItem(themeStorageKey, preference);
    } catch {}
    currentPreference.current = preference;
    setPreference(preference);
    document.documentElement.dataset.themePreference = preference;
    const actual = resolveTheme(
      preference,
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
    document.documentElement.dataset.theme = actual;
    setResolvedTheme(actual);
  }
  // The UI uses one component system. Personal preferences only control content presentation.
  const effective = {
    ...site.settings,
    // Unset means "follow the screen": open on desktop, closed on phones.
    componentsExpanded: site.settings.componentsExpanded || undefined,
    ...Object.fromEntries(
      Object.entries(preferences).filter(([key]) =>
        [
          "showMileage",
          "componentsExpanded",
          "rideListMode",
          "rideMapView",
          "mapScrollZoom",
        ].includes(key),
      ),
    ),
  };
  const t = (text) => site.settings.copy?.[text] ?? text;
  return (
    <Context.Provider
      value={{
        ...site,
        setSite,
        t,
        viewer,
        setViewer,
        refreshViewer,
        setPreferences,
        personalSettings: effective,
        themePreference,
        resolvedTheme,
        themeReady,
        setThemePreference,
      }}
    >
      <ThemeStyle settings={effective} />
      <div
        className="site-root"
        data-design-system="community"
        data-summary={site.settings.summaryPosition}
        data-detail-order={site.settings.detailOrder}
        data-photo-mode={site.settings.photoMode}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function useSite() {
  return useContext(Context);
}
