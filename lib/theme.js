export const appearanceDefaults = { theme: "system", accent: "#F3B51B" };
export const heroDefaults = {
  heroImageId: null,
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
