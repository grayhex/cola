"use client";
import { useState } from "react";
import {
  illustrationSlots,
  graphicAsset,
  filterGraphicSlots,
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
  const slots = filterGraphicSlots(illustrationSlots, search);
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
      <label className="field">
        <span>Найти графику</span>
        <input
          type="search"
          value={search}
          placeholder="Например: велосипед"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className={styles.graphicGrid}>
        {slots.map((slot) => (
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
        ))}
      </div>
      {!slots.length && <p className="help">Ничего не найдено.</p>}
    </section>
  );
}
