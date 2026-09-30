import type { SiteSettings } from "./contracts.ts";
export const appearanceDefaults: SiteSettings["appearance"] = {
  theme: "system",
  accent: "#F3B51B",
};
export const heroDefaults = {
  // Preserve the old static first visit until the administrator enables autoplay.
  heroAnimationsEnabled: false,
  heroImageId: null,
  heroStageImageId: null,
  heroTitleAnimation: {
    kind: "builtin" as const,
    name: "transparent-bike" as const,
  },
  heroStageAnimation: {
    kind: "builtin" as const,
    name: "riding-bike" as const,
  },
  heroStageDarkAnimation: null,
  // The block takes its tint from the site's accent unless the
  // administrator picks its own colours (#131).
  heroBackgroundMode: "accent" as const,
  heroBackgroundLight: "#FFFCF2",
  heroBackgroundDark: "#24221B",
  heroHeadline: "Покажи свой велосипед.\nРасскажи, как он меняется.",
  heroDescription:
    "Велосипеды, сборки, истории и покатушки людей, которым есть что показать.",
};
export const themeModes = ["system", "light", "dark"];
export const themeStorageKey = "cola:theme";
export function validTheme(value: string | null, fallback = "system") {
  return value !== null && themeModes.includes(value) ? value : fallback;
}
export function resolveTheme(preference: string, dark: boolean) {
  return preference === "system"
    ? dark
      ? "dark"
      : "light"
    : validTheme(preference);
}
// Choose fixed script literals, never serialize input into an HTML script.
export function themeBootstrap(defaultTheme = "system") {
  const initial =
    defaultTheme === "light"
      ? "'light'"
      : defaultTheme === "dark"
        ? "'dark'"
        : "'system'";
  return `(function(){var p=${initial};try{var s=localStorage.getItem('${themeStorageKey}');if(['system','light','dark'].includes(s))p=s}catch(e){}var d=document.documentElement;d.dataset.themePreference=p;d.dataset.theme=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p})()`;
}

export const backgroundDefaults = {
  backgroundLightId: null,
  backgroundDarkId: null,
  backgroundLightOpacity: 20,
  backgroundDarkOpacity: 20,
  backgroundLightMode: "cover" as const,
  backgroundDarkMode: "cover" as const,
};
// IDs/enum/numbers only: uploaded bytes and user text never enter CSS.
export function backgroundCss(settings: Partial<SiteSettings>) {
  return (["Light", "Dark"] as const)
    .map((theme) => {
      const id = settings[`background${theme}Id`];
      const validId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id || "",
        );
      const mode =
        settings[`background${theme}Mode`] === "tile" ? "tile" : "cover";
      const opacity = Number(settings[`background${theme}Opacity`] ?? 20);
      return `html${theme === "Dark" ? '[data-theme="dark"]' : ':not([data-theme="dark"])'} .site-root::before{background-image:${validId ? `url("/api/assets/${id}")` : "none"};background-size:${mode === "tile" ? "auto" : "cover"};background-repeat:${mode === "tile" ? "repeat" : "no-repeat"};opacity:${Number.isFinite(opacity) ? Math.max(0, Math.min(100, opacity)) / 100 : 0.2}}`;
    })
    .join("");
}
