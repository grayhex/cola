"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { accentText } from "../../lib/appearance.js";
import {
  appearanceDefaults,
  resolveTheme,
  themeStorageKey,
  validTheme,
} from "../../lib/theme.js";
import { useBrowseHistory } from "./showcase-scroll.js";
import { defaultSettings, defaultCatalog } from "../../lib/site-defaults.js";
const Context = createContext(null);
export function ThemeStyle({ settings }) {
  const accent = /^#[\da-f]{6}$/i.test(settings.appearance?.accent || "")
    ? settings.appearance.accent
    : appearanceDefaults.accent;
  return (
    <style>{`:root{--accent:${accent};--accent-foreground:${accentText(accent)};--photo-ratio:${settings.photoRatio || "4/3"};--desktop-columns:${settings.desktopColumns || 3};--heading-align:${settings.textAlign || "left"}}`}</style>
  );
}
export default function SiteProvider({ initial, children }) {
  useBrowseHistory();
  const [site, setSite] = useState(
    initial || { settings: defaultSettings, catalog: defaultCatalog },
  );
  const [preferences, setPreferences] = useState({});
  const defaultTheme = validTheme(site.settings.appearance?.theme);
  const [themePreference, setPreference] = useState(defaultTheme);
  const currentPreference = useRef(defaultTheme);
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
      document.documentElement.dataset.theme = resolveTheme(
        preference,
        media.matches,
      );
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
    document.documentElement.dataset.theme = resolveTheme(
      preference,
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }
  // Preserve personal content/layout preferences; legacy UI graphics never shape the new shell.
  const effective = {
    ...site.settings,
    ...preferences,
    designSystem: "community",
    appearance: {
      ...site.settings.appearance,
      ...(/^#[\da-f]{6}$/i.test(preferences.accent || "")
        ? { accent: preferences.accent }
        : {}),
    },
  };
  const t = (text) => site.settings.copy[text] ?? text;
  return (
    <Context.Provider
      value={{
        ...site,
        setSite,
        t,
        setPreferences,
        personalSettings: effective,
        themePreference,
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
