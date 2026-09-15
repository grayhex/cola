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
  const t = (text) => site.settings.copy[text] ?? text;
  return (
    <Context.Provider value={{ ...site, setSite, t }}>
      <ThemeStyle settings={site.settings} />
      <div
        className="site-root"
        data-theme={site.settings.theme}
        data-summary={site.settings.summaryPosition}
        data-detail-order={site.settings.detailOrder}
        data-photo-mode={site.settings.photoMode}
        data-font={site.settings.font}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function useSite() {
  return useContext(Context);
}
