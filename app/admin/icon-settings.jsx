"use client";
import { useState } from "react";
import {
  illustrationSlots,
  graphicAsset,
  filterGraphicSlots,
  footerLinkHref,
} from "../../lib/design-graphics.js";
import AssetPicker from "./asset-picker.jsx";
import { componentIllustrationSlots } from "../../lib/component-illustrations.js";
import { Image } from "../ui/icons.jsx";
import styles from "./design.module.css";
export default function IconSettings({
  settings,
  catalog,
  assets,
  busy,
  onChange,
  onUpload,
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [section, setSection] = useState("branding");
  const sectionSlots = [
    ...illustrationSlots,
    ...componentIllustrationSlots(catalog),
  ].filter((slot) => slot.section === section);
  const groups = [...new Set(sectionSlots.map((slot) => slot.group))];
  const slots = filterGraphicSlots(sectionSlots, search, group);
  function assign(slot, id) {
    if (!slot.kind) return onChange(slot.key, id);
    onChange("componentIllustrations", {
      ...settings.componentIllustrations,
      [slot.kind]: {
        ...settings.componentIllustrations?.[slot.kind],
        [slot.name]: id,
      },
    });
  }
  return (
    <section
      className={"admin-panel " + styles.compactPanel}
      aria-label="Графика сайта"
    >
      <h2>Графика сайта</h2>
      <p className="help">
        Логотипы, категории компонентов, фон и иллюстрации проекта. Изображение
        главной меняется в разделе «Внешний вид». Знак ColaBike одновременно
        используется в шапке и на вкладке браузера.
      </p>
      <div className="ui-tabs" aria-label="Разделы графики">
        {[
          ["branding", "Логотипы и брендинг"],
          ["components", "Компоненты"],
          ["background", "Фон сайта"],
          ["system", "Системные иллюстрации"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={section === id}
            onClick={() => {
              setSection(id);
              setGroup("all");
              setSearch("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <label className="field">
          <span>Найти графику</span>
          <input
            type="search"
            value={search}
            placeholder="Например: велосипед"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Группа</span>
          <select
            aria-label="Группа"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">Все группы</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.graphicGrid}>
        {slots.map((slot) => {
          const picker = (
            <AssetPicker
              key={slot.key}
              compact
              label={slot.label}
              help={slot.group}
              value={graphicAsset(settings, slot)}
              assets={assets}
              busy={busy}
              emptyLabel={slot.emptyLabel}
              previewClassName="wide"
              Fallback={Image}
              accept="image/jpeg,image/png,image/webp"
              onChange={(id) => assign(slot, id)}
              onUpload={async (file) => {
                const asset = await onUpload(file, slot);
                if (asset) assign(slot, asset.id);
              }}
            />
          );
          if (!slot.linkKey) return picker;
          // Footer logos are links (#124): a page of the site or a website.
          const link = settings[slot.linkKey] || "";
          const invalid = link.trim() !== "" && footerLinkHref(link) === null;
          return (
            <div key={slot.key} className={styles.linkedSlot}>
              {picker}
              <label className="field">
                <span>Ссылка: {slot.label}</span>
                <input
                  type="text"
                  inputMode="url"
                  maxLength={500}
                  placeholder="/about или https://…"
                  value={link}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => onChange(slot.linkKey, e.target.value)}
                />
                <small className={invalid ? "field-error" : undefined}>
                  {invalid
                    ? "Начните с /, http:// или https://"
                    : "Без ссылки логотип не кликабелен."}
                </small>
              </label>
            </div>
          );
        })}
      </div>
      {!slots.length && <p className="help">Ничего не найдено.</p>}
    </section>
  );
}
