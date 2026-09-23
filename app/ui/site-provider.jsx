"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { accentText } from "../../lib/appearance.js";
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
    <style>{`:root{--accent:${accent};--accent-foreground:${accentText(accent)};--photo-ratio:${settings.photoRatio || "4/3"};--desktop-columns:${settings.desktopColumns || 3};--heading-align:${settings.textAlign || "left"}}${backgroundCss(settings)}`}</style>
  );
}
export default function SiteProvider({ initial, children }) {
  useBrowseHistory();
  useEffect(() => installErrorReporting(), []);
  const [site, setSite] = useState(
    initial || { settings: defaultSettings, catalog: defaultCatalog },
  );
  const [preferences, setPreferences] = useState({});
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
    ...Object.fromEntries(
      Object.entries(preferences).filter(([key]) =>
        [
          "bikeLayout",
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
        data-bike-layout={effective.bikeLayout || "balanced"}
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
