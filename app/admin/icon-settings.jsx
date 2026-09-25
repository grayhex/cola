"use client";
import { useState } from "react";
import {
  illustrationSlots,
  graphicAsset,
  filterGraphicSlots,
  footerLinkHref,
} from "../../lib/design-graphics.js";
import AssetPicker from "./asset-picker.jsx";
import { Image } from "../ui/icons.jsx";
import styles from "./design.module.css";
export default function IconSettings({
  settings,
  assets,
  busy,
  onChange,
  onUpload,
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const groups = [...new Set(illustrationSlots.map((slot) => slot.group))];
  const slots = filterGraphicSlots(illustrationSlots, search, group);
  return (
    <section
      className={"admin-panel " + styles.compactPanel}
      aria-label="Графика сайта"
    >
      <h2>Изображения и брендинг</h2>
      <p className="help">
        Фотографии велосипедов, иллюстрации проекта и иконка вкладки.
        Изображение главной меняется в разделе «Главная».
      </p>
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
              onChange={(id) => onChange(slot.key, id)}
              onUpload={async (file) => {
                const asset = await onUpload(file, slot);
                if (asset) onChange(slot.key, asset.id);
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
