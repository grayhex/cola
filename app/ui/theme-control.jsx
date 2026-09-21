"use client";
import { Monitor, Sun, Moon } from "lucide-react";
import { useSite } from "./site-provider.jsx";
import NavPopover from "./nav-popover.jsx";
const options = [
  ["system", "Как на устройстве", Monitor],
  ["light", "Светлая", Sun],
  ["dark", "Тёмная", Moon],
];
export default function ThemeControl() {
  const { themePreference, setThemePreference } = useSite();
  const Icon = options.find(([key]) => key === themePreference)?.[2] || Monitor;
  return (
    <NavPopover
      label="Цветовая тема"
      className="theme-disclosure"
      trigger={<Icon size={19} aria-hidden="true" />}
    >
      <div role="group" aria-label="Цветовая тема">
        {options.map(([key, label, Graphic]) => (
          <button
            key={key}
            type="button"
            className="nav-menu-link"
            aria-pressed={themePreference === key}
            onClick={() => setThemePreference(key)}
          >
            <Graphic size={18} aria-hidden="true" />
            <span>{label}</span>
            {themePreference === key && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </NavPopover>
  );
}
