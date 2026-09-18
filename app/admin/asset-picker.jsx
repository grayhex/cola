"use client";
import { Image as ImageIcon, Upload, RotateCcw } from "lucide-react";

export default function AssetPicker({
  label,
  help,
  value,
  assets,
  emptyLabel = "Плейсхолдер",
  busy = false,
  onChange,
  onUpload,
  previewClassName = "",
}) {
  const selected = assets.find((asset) => asset.id === value);

  return (
    <article className="asset-picker">
      <div className={"asset-picker-preview " + previewClassName}>
        {value ? (
          <img src={"/api/assets/" + value} alt="" />
        ) : (
          <div className="asset-picker-placeholder">
            <ImageIcon size={28} strokeWidth={1.5} />
            <span>{emptyLabel}</span>
          </div>
        )}
      </div>
      <div className="asset-picker-body">
        <div className="asset-picker-heading">
          <strong>{label}</strong>
          {help && <small>{help}</small>}
        </div>
        <select
          aria-label={label}
          value={value || ""}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{emptyLabel}</option>
          {assets.map((asset) => (
            <option value={asset.id} key={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
        <div className="asset-picker-actions">
          <label className={"quiet asset-upload" + (busy ? " disabled" : "")}>
            <Upload size={15} />
            Загрузить
            <input
              hidden
              disabled={busy}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUpload(file);
              }}
            />
          </label>
          <button
            type="button"
            className="quiet"
            disabled={busy || !value}
            onClick={() => onChange(null)}
          >
            <RotateCcw size={15} />
            Сбросить
          </button>
        </div>
        {selected && <small className="asset-picker-name">{selected.name}</small>}
      </div>
    </article>
  );
}
