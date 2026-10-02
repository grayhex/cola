"use client";
import type * as React from "react";
import type {
  SiteSettings,
  SiteDefinition,
  ViewerDto,
  MeResponse,
  UserPreferences,
} from "../../lib/contracts.ts";
type SiteSnapshot = Pick<SiteDefinition, "settings" | "catalog"> &
  Partial<Pick<SiteDefinition, "settingsVersion" | "catalogVersion">>;
type PersonalSettings = Omit<SiteSettings, "componentsExpanded"> &
  UserPreferences;
interface SiteContext extends SiteSnapshot {
  setSite: React.Dispatch<React.SetStateAction<SiteSnapshot>>;
  t: (text: string) => string;
  viewer: ViewerDto | null;
  chatEnabled: boolean;
  yandexIdEnabled: boolean;
  setViewer: (user: ViewerDto | null) => void;
  refreshViewer: () => Promise<ViewerDto | null>;
  setPreferences: React.Dispatch<React.SetStateAction<UserPreferences>>;
  personalSettings: PersonalSettings;
  themePreference: string;
  resolvedTheme: string;
  themeReady: boolean;
  nonce?: string;
  setThemePreference: (value: string) => void;
}
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { accentText, titleHover } from "../../lib/appearance.ts";
import {
  appearanceDefaults,
  backgroundCss,
  resolveTheme,
  themeStorageKey,
  validTheme,
} from "../../lib/theme.ts";
import { useBrowseHistory } from "./showcase-scroll.ts";
import { installErrorReporting } from "./error-reporting.ts";
import { defaultSettings, defaultCatalog } from "../../lib/site-defaults.ts";
const Context = createContext<SiteContext | null>(null);
export function ThemeStyle({
  settings,
  nonce,
}: {
  settings: Partial<SiteSettings>;
  nonce?: string;
}) {
  const accent = /^#[\da-f]{6}$/i.test(settings.appearance?.accent || "")
    ? settings.appearance!.accent
    : appearanceDefaults.accent;
  return (
    <style
      nonce={nonce}
    >{`:root{--accent:${accent};--accent-foreground:${accentText(accent)};--title-hover-on-light:${titleHover(accent, "light")};--title-hover-on-dark:${titleHover(accent, "dark")};--photo-ratio:${settings.photoRatio || "4/3"};--desktop-columns:${settings.desktopColumns || 3};--heading-align:${settings.textAlign || "left"}}${backgroundCss(settings)}`}</style>
  );
}
export default function SiteProvider({
  initial,
  nonce,
  viewer: initialViewer = null,
  chatEnabled = false,
  yandexIdEnabled = false,
  children,
}: {
  initial?: SiteSnapshot;
  nonce?: string;
  viewer?: ViewerDto | null;
  chatEnabled?: boolean;
  yandexIdEnabled?: boolean;
  children: React.ReactNode;
}) {
  // A client navigation/refresh must retain the original document nonce.
  const [documentNonce] = useState(nonce);
  useBrowseHistory();
  useEffect(() => installErrorReporting(), []);
  const [site, setSite] = useState<SiteSnapshot>(
    initial || { settings: defaultSettings, catalog: defaultCatalog },
  );
  // The server layout already knows who is reading (#74): pages start with
  // the right header and personal settings instead of asking /api/me.
  const [viewer, setViewerState] = useState(initialViewer);
  const [preferences, setPreferences] = useState(
    initialViewer?.preferences || {},
  );
  const setViewer = useCallback((user: ViewerDto | null) => {
    setViewerState(user || null);
    setPreferences(user?.preferences || {});
  }, []);
  // After signing in or editing the profile without a page load.
  const refreshViewer = useCallback(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось проверить вход");
    const { user }: MeResponse = await response.json();
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
      } catch {
        // Storage may be unavailable; retain the current theme preference.
      }
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
  function setThemePreference(value: string) {
    const preference = validTheme(value);
    try {
      localStorage.setItem(themeStorageKey, preference);
    } catch {
      // Apply the theme for this visit even if it cannot be persisted.
    }
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
  const effective: PersonalSettings = {
    ...site.settings,
    // Unset means "follow the screen": open on desktop, closed on phones.
    componentsExpanded: site.settings.componentsExpanded || undefined,
    ...Object.fromEntries(
      Object.entries(preferences).filter(([key]) =>
        [
          "bikeLayout",
          "showMileage",
          "componentsExpanded",
          "rideListMode",
          "rideMapView",
          "mapScrollZoom",
          "menuOpenOnHover",
          "timeZone",
        ].includes(key),
      ),
    ),
  };
  const t = (text: string) => site.settings.copy?.[text] ?? text;
  return (
    <Context.Provider
      value={{
        ...site,
        setSite,
        t,
        viewer,
        chatEnabled,
        yandexIdEnabled,
        setViewer,
        refreshViewer,
        setPreferences,
        personalSettings: effective,
        themePreference,
        resolvedTheme,
        themeReady,
        nonce: documentNonce,
        setThemePreference,
      }}
    >
      <ThemeStyle settings={effective} nonce={documentNonce} />
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
  return useContext(Context)!;
}
