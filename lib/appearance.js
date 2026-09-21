// An explicit admin action, never an automatic migration of stored settings.
export function applyPixelClub(settings) {
  return {
    ...settings,
    designPreset: "pixel-club",
    theme: "light",
    font: "ptsans",
    displayFont: "unbounded",
    accent: "#244CBA",
    radius: 4,
    backgroundOpacity: 0,
    desktopColumns: 3,
  };
}
export function accentText(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex || "")) return "#FFFFFF";
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#FFFFFF";
}
