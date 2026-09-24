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

// Theme surfaces from app/theme.css (bg, surface, line-soft) that accent-colored
// text sits on. The admin can pick any accent, so its text shade is derived.
const themeSurfaces = {
  light: ["#F3F0E8", "#FFFFFF", "#EEEAE0"],
  dark: ["#111315", "#1B1E22", "#23272D"],
};
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex) {
  const [r, g, b] = channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
// The accent mixed toward black (light theme) or white (dark theme) in 5% steps
// until text in it reaches 4.5:1 on every surface of that theme.
export function readableAccent(hex, theme = "light") {
  const accent = /^#[\da-f]{6}$/i.test(hex || "") ? hex : "#C2410C",
    toward = theme === "dark" ? 255 : 0;
  for (let step = 0; step <= 20; step++) {
    const color =
      "#" +
      channels(accent)
        .map((c) => Math.round(c + (toward - c) * step * 0.05))
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    if (themeSurfaces[theme].every((surface) => contrast(color, surface) >= 4.5))
      return color;
  }
  return theme === "dark" ? "#FFFFFF" : "#000000";
}
