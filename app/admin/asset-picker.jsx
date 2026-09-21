"use client";
import { useRef, useState } from "react";
import { Image as ImageIcon, Upload, RotateCcw } from "../ui/icons.jsx";
import styles from "./design.module.css";

export default function AssetPicker({
  label, help, value, assets, emptyLabel = "Плейсхолдер", busy = false,
  onChange, onUpload, previewClassName = "", Fallback = ImageIcon,
  compact = false, accept = "image/jpeg,image/png,image/webp",
}) {
  const selected = assets.find((asset) => asset.id === value);
  const fileInput = useRef(null);
  const [failedId, setFailedId] = useState(null);
  return (
    <article className={"asset-picker " + (compact ? styles.compactPicker : "")}>
      <div className={"asset-picker-preview " + previewClassName}>
        {value && failedId !== value ? (
          <img src={"/api/assets/" + value} alt="" loading="lazy" onError={() => setFailedId(value)} />
        ) : (
          <div className="asset-picker-placeholder">
            <Fallback size={28} strokeWidth={1.5} />
            {!compact && <span>{emptyLabel}</span>}
          </div>
        )}
      </div>
      <div className="asset-picker-body">
        <div className="asset-picker-heading"><strong>{label}</strong>{help && <small>{help}</small>}</div>
        <select aria-label={label} disabled={busy} value={value || ""}
          onChange={(event) => onChange(event.target.value || null)}>
          <option value="">{emptyLabel}</option>
          {value && !selected && <option value={value}>Выбранное изображение</option>}
          {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}
        </select>
        <div className="asset-picker-actions">
          <button type="button" className="quiet" disabled={busy} aria-label={"Загрузить: " + label}
            onClick={() => fileInput.current?.click()}><Upload size={15} />Загрузить</button>
          <input ref={fileInput} hidden disabled={busy} type="file" accept={accept}
            aria-label={"Файл: " + label} onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (file) onUpload(file);
            }} />
          <button type="button" className="quiet" disabled={busy || !value}
            aria-label={"Сбросить: " + label} onClick={() => onChange(null)}><RotateCcw size={15} />Сбросить</button>
        </div>
        {selected && !compact && <small className="asset-picker-name">{selected.name}</small>}
      </div>
    </article>
  );
}
