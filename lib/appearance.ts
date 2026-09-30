export function accentText(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex || "")) return "#FFFFFF";
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#FFFFFF";
}

const linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const encoded = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const toHex = (rgb: number[]) =>
  "#" +
  rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();

/** WCAG relative luminance. */
function luminance(hex: string) {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toOklab(rgb: number[]) {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: number[]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => encoded(Math.min(1, Math.max(0, c))));
}

// The lightest light and the darkest dark surface a card title sits on when
// hovered or focused: --surface-hover in tokens.css (--gray-100, --gray-900).
const titleSurfaces = { light: "#F3F4F6", dark: "#111827" };

/** A card title under the pointer or keyboard focus (#264): the accent, mixed
toward black on the light theme and toward white on the dark one. It starts
from the mix tokens.css uses (55 % accent in sRGB; 45 % accent in oklab) and
gives up accent only as far as WCAG AA (4.5:1) on the hover surface needs,
so any accent the administrator picks, black and white included, stays
readable. */
export function titleHover(hex: string, theme: "light" | "dark") {
  const dark = theme === "dark";
  if (!/^#[\da-f]{6}$/i.test(hex || "")) return dark ? "#FFFFFF" : "#000000";
  const rgb = channels(hex),
    lab = toOklab(rgb);
  for (let share = dark ? 45 : 55; share > 0; share--) {
    const p = share / 100;
    const color = dark
      ? toHex(fromOklab([lab[0] * p + (1 - p), lab[1] * p, lab[2] * p]))
      : toHex(rgb.map((c) => c * p));
    if (contrastRatio(color, titleSurfaces[theme]) >= 4.5) return color;
  }
  return dark ? "#FFFFFF" : "#000000";
}
