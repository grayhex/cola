"use client";
import AssetPicker from "./asset-picker.jsx";
import { bundledAnimations } from "../../lib/hero-graphics.ts";

export default function AnimationPicker({
  label,
  value,
  assets,
  busy,
  onChange,
  onUpload,
}) {
  const bundled = bundledAnimations.map(({ name, label }) => ({
    id: "builtin:" + name,
    name: label,
    preview: `/rive/${name}-light.png`,
  }));
  const choices = [
    ...bundled,
    ...assets.filter((a) => ["rive", "svg"].includes(a.format)),
  ];
  const reference = (id, list = choices) => {
    if (!id) return null;
    if (id.startsWith("builtin:"))
      return { kind: "builtin", name: id.slice(8) };
    return {
      kind: list.find((a) => a.id === id)?.format || "svg",
      assetId: id,
    };
  };
  return (
    <AssetPicker
      compact
      animation
      label={label}
      assets={choices}
      busy={busy}
      help="Выберите сцену или загрузите .riv / безопасный SVG · до 1 МБ."
      value={
        value?.kind === "builtin" ? "builtin:" + value.name : value?.assetId
      }
      emptyLabel="Без анимации"
      accept=".riv,.svg,image/svg+xml,application/octet-stream"
      onChange={(id) => onChange(reference(id))}
      onUpload={async (file) => {
        const asset = await onUpload(file);
        if (asset) onChange(reference(asset.id, [asset]));
      }}
    />
  );
}
