"use client";
import { createContext, useContext, useState } from "react";
import {
  fontStacks,
  defaultSettings,
  defaultCatalog,
} from "../../lib/site-defaults.js";
const Context = createContext(null);
export function ThemeStyle({ settings: s }) {
  return (
    <style>{`:root{--accent:${s.accent};--radius:${s.radius}px;--site-font:${fontStacks[s.font]};--photo-ratio:${s.photoRatio};--desktop-columns:${s.desktopColumns};--heading-align:${s.textAlign}}`}</style>
  );
}
export default function SiteProvider({ initial, children }) {
  const [site, setSite] = useState(
    initial || { settings: defaultSettings, catalog: defaultCatalog },
  );
  const [preferences, setPreferences] = useState({});
  const effective = { ...site.settings, ...preferences };
  const backgroundStyle = effective.backgroundImageId
    ? {
        "--site-background-image": `url("/api/assets/${effective.backgroundImageId}")`,
        "--site-background-opacity": String(
          Math.max(0, Math.min(100, Number(effective.backgroundOpacity ?? 20))) /
            100,
        ),
      }
    : {
        "--site-background-image": "none",
        "--site-background-opacity": "0",
      };
  const t = (text) => site.settings.copy[text] ?? text;
  return (
    <Context.Provider value={{ ...site, setSite, t, setPreferences, personalSettings: effective }}>
      <ThemeStyle settings={effective} />
      <div
        className="site-root"
        data-theme={effective.theme}
        data-background-mode={effective.backgroundMode || "cover"}
        data-has-background={effective.backgroundImageId ? "true" : "false"}
        style={backgroundStyle}
        data-bike-layout={effective.bikeLayout || "balanced"}
        data-summary={site.settings.summaryPosition}
        data-detail-order={site.settings.detailOrder}
        data-photo-mode={site.settings.photoMode}
        data-font={effective.font}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function useSite() {
  return useContext(Context);
}
