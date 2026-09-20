// The SDK owns window.ymaps3: load it once per document, never once per card.
// A new key needs a page reload rather than silently reusing an old SDK instance.
export function yandexApiUrl(publicKey) {
  const key = typeof publicKey === "string" ? publicKey.trim() : "";
  if (!key) throw new Error("YANDEX_MAPS_KEY_MISSING");
  const url = new URL("https://api-maps.yandex.ru/v3/");
  url.searchParams.set("apikey", key);
  url.searchParams.set("lang", "ru_RU");
  return url.href;
}

export function createYandexMapsLoader({
  getWindow = () => globalThis.window,
  getDocument = () => globalThis.document,
  timeoutMs = 15000,
} = {}) {
  let loadedKey;
  let pending;
  return function load(publicKey) {
    const key = typeof publicKey === "string" ? publicKey.trim() : "";
    if (!key) return Promise.reject(new Error("YANDEX_MAPS_KEY_MISSING"));
    const win = getWindow();
    const doc = getDocument();
    if (!win || !doc) return Promise.reject(new Error("YANDEX_MAPS_BROWSER_ONLY"));
    if (pending) {
      return loadedKey === key
        ? pending
        : Promise.reject(new Error("YANDEX_MAPS_RELOAD_REQUIRED"));
    }
    // Another integration must not decide which API key this provider uses.
    if (win.ymaps3) return Promise.reject(new Error("YANDEX_MAPS_RELOAD_REQUIRED"));
    loadedKey = key;
    pending = new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      let settled = false;
      const finish = (error, api) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(new Error(error));
        } else {
          resolve(api);
        }
      };
      const timer = setTimeout(() => finish("YANDEX_MAPS_UNAVAILABLE"), timeoutMs);
      script.async = true;
      script.src = yandexApiUrl(key);
      script.referrerPolicy = "strict-origin-when-cross-origin";
      script.dataset.colabikeYandexMaps = "true";
      script.onerror = () => finish("YANDEX_MAPS_UNAVAILABLE");
      script.onload = () => {
        const api = win.ymaps3;
        if (!api?.ready) {
          finish("YANDEX_MAPS_UNAVAILABLE");
          return;
        }
        Promise.resolve(api.ready).then(
          () => {
            const required = [
              "YMap", "YMapDefaultSchemeLayer", "YMapDefaultFeaturesLayer",
              "YMapFeature", "YMapMarker", "YMapListener",
            ];
            finish(
              required.every((name) => typeof api[name] === "function")
                ? null : "YANDEX_MAPS_UNAVAILABLE",
              api,
            );
          },
          () => finish("YANDEX_MAPS_UNAVAILABLE"),
        );
      };
      doc.head.appendChild(script);
    });
    // Cache failures too. Multiple cards/remounts must not repeatedly hit a bad
    // key or an exhausted quota; the explicit recovery action is a page reload.
    return pending;
  };
}
export const loadYandexMaps = createYandexMapsLoader();
