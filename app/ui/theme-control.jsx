"use client";
import SiteEmoji from "./site-emoji.jsx";
import { useSite } from "./site-provider.jsx";
export default function ThemeControl() {
  const { resolvedTheme, themeReady, setThemePreference } = useSite();
  const next = resolvedTheme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="compact-icon theme-toggle"
      role="switch"
      disabled={!themeReady}
      aria-checked={resolvedTheme === "dark"}
      aria-label="Тёмная тема"
      title={next === "dark" ? "Включить тёмную тему" : "Включить светлую тему"}
      onClick={() => setThemePreference(next)}
    >
      <SiteEmoji name={next} />
    </button>
  );
}
