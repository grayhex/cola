"use client";
import { useState } from "react";
import { uiIconNames, uiIconLabels } from "../../lib/ui-icons.js";
import AssetPicker from "./asset-picker.jsx";
import * as Icons from "../ui/icons.jsx";
import PartIcon from "../ui/part-icon.jsx";
import { iconPaths, categoryIcons } from "../../lib/part-icons.js";
const nav = new Set([
  "Home",
  "Bike",
  "Route",
  "Info",
  "Search",
  "Bell",
  "UserRound",
  "Menu",
  "LogOut",
  "Shield",
  "Users",
  "BookOpen",
  "NotebookPen",
]);
const social = new Set([
  "Heart",
  "MessageCircle",
  "Trophy",
  "Medal",
  "Star",
  "Sparkles",
  "Flame",
  "CheckCheck",
  "Zap",
  "Gauge",
  "Flag",
]);
export default function IconSettings({
  settings,
  assets,
  busy,
  onChange,
  onUpload,
}) {
  const [search, setSearch] = useState("");
  const groups = [
    ["Навигация и разделы", (n) => nav.has(n)],
    ["Социальные механики и показатели", (n) => social.has(n)],
    ["Действия и служебные значки", (n) => !nav.has(n) && !social.has(n)],
  ];
  return (
    <section className="admin-panel all-icons">
      <h2>Все значки интерфейса</h2>
      <p className="help">
        Единая замена встроенной графики на сайте. Специальные слоты навигации
        выше имеют приоритет. Прозрачный PNG или WebP; после выбора сохраните
        настройки.
      </p>
      <label className="field">
        <span>Найти значок</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Например: комментарии, Bike, фильтры"
        />
      </label>
      <details className="graphics-group" open={search ? true : undefined}>
        <summary>Компоненты и аксессуары</summary>
        <div className="asset-picker-grid compact-assets">
          {Object.keys(iconPaths)
            .filter((n) =>
              (
                n +
                " " +
                Object.keys(categoryIcons)
                  .filter((c) => categoryIcons[c] === n)
                  .join(" ")
              )
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((name) => (
              <AssetPicker
                key={name}
                label={
                  (Object.keys(categoryIcons).find(
                    (c) => categoryIcons[c] === name,
                  ) || name) +
                  " · " +
                  name
                }
                Fallback={(props) => (
                  <PartIcon {...props} name={name} original />
                )}
                value={settings.partIconAssets?.[name] || null}
                assets={assets}
                busy={busy}
                onChange={(id) =>
                  onChange("partIconAssets", {
                    ...settings.partIconAssets,
                    [name]: id,
                  })
                }
                onUpload={async (file) => {
                  const a = await onUpload(file);
                  if (a)
                    onChange("partIconAssets", {
                      ...settings.partIconAssets,
                      [name]: a.id,
                    });
                }}
              />
            ))}
        </div>
      </details>
      {groups.map(([label, filter]) => (
        <details
          className="graphics-group"
          key={label}
          open={search ? true : undefined}
        >
          <summary>{label}</summary>
          <div className="asset-picker-grid compact-assets">
            {uiIconNames
              .filter(
                (n) =>
                  filter(n) &&
                  (n + " " + (uiIconLabels[n] || ""))
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((name) => (
                <AssetPicker
                  key={name}
                  label={(uiIconLabels[name] || name) + " · " + name}
                  Fallback={Icons[name].Default}
                  value={settings.uiIcons?.[name] || null}
                  assets={assets}
                  busy={busy}
                  previewClassName="icon"
                  onChange={(id) =>
                    onChange("uiIcons", { ...settings.uiIcons, [name]: id })
                  }
                  onUpload={async (file) => {
                    const a = await onUpload(file);
                    if (a)
                      onChange("uiIcons", {
                        ...settings.uiIcons,
                        [name]: a.id,
                      });
                  }}
                />
              ))}
          </div>
        </details>
      ))}
    </section>
  );
}
