export const appearanceDefaults = { theme: "system", accent: "#C2410C" };
export const heroDefaults = {
  heroImageId: null,
  heroAnimationLightId: null,
  heroAnimationDarkId: null,
  heroBackgroundLight: "#FFFCF2",
  heroBackgroundDark: "#24221B",
  heroHeadline: "Покажи свой велосипед.\nРасскажи, как он меняется.",
  heroDescription:
    "Велосипеды, сборки, истории и покатушки людей, которым есть что показать.",
};
export const themeModes = ["system", "light", "dark"];
export const themeStorageKey = "cola:theme";
export function validTheme(value, fallback = "system") {
  return themeModes.includes(value) ? value : fallback;
}
export function resolveTheme(preference, dark) {
  return preference === "system"
    ? dark
      ? "dark"
      : "light"
    : validTheme(preference);
}
// Only validated enum values enter the parser-blocking bootstrap. No user HTML.
export function themeBootstrap(defaultTheme = "system") {
  return `(function(){var p=${JSON.stringify(validTheme(defaultTheme))};try{var s=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(['system','light','dark'].includes(s))p=s}catch(e){}var d=document.documentElement;d.dataset.themePreference=p;d.dataset.theme=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p})()`;
}

export const backgroundDefaults = {
  backgroundLightId: null,
  backgroundDarkId: null,
  backgroundLightOpacity: 20,
  backgroundDarkOpacity: 20,
  backgroundLightMode: "cover",
  backgroundDarkMode: "cover",
};
// IDs/enum/numbers only: uploaded bytes and user text never enter CSS.
export function backgroundCss(settings) {
  return ["Light", "Dark"]
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
