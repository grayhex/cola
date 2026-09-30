import { chatConfig } from "./chat-config.ts";
// Runtime settings: changing modes never requires rebuilding browser bundles.
export const baselineCsp =
  "base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
export function cspMode(env = process.env) {
  const mode = env.CSP_MODE || "report-only";
  if (!["report-only", "enforce", "off"].includes(mode))
    throw new Error("Invalid CSP_MODE");
  return mode;
}
export function mapOrigins(value = "") {
  return [
    ...new Set(
      value
        .split(/\s+/)
        .filter(Boolean)
        .map((source) => {
          const url = new URL(source);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname !== "/" ||
            !(
              /^[a-z0-9.-]+$/i.test(url.hostname) ||
              /^\[[a-f0-9:]+\]$/i.test(url.hostname)
            )
          )
            throw new Error("CSP_MAP_ORIGINS requires exact HTTPS origins");
          return url.origin;
        }),
    ),
  ];
}
export function pageCsp(nonce: string, env = process.env) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) throw new Error("Invalid CSP nonce");
  const sdk =
    "https://api-maps.yandex.ru https://*.api-maps.yandex.ru https://yastatic.net";
  const tiles =
    `https://tile.openstreetmap.org https://*.maps.yandex.net ${mapOrigins(env.CSP_MAP_ORIGINS).join(" ")}`.trim();
  const chat = chatConfig(env);
  // Rive uses self-hosted WASM. String evaluation remains forbidden.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' ${sdk}${env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}' ${sdk}`,
    // React layout, editor marks and map positioning use style attributes.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${sdk} ${tiles}${chat ? " https://*.stream-io-cdn.com" : ""}`,
    `connect-src 'self' ${sdk} ${tiles}${chat ? " https://chat.stream-io-api.com wss://chat.stream-io-api.com https://*.stream-io-cdn.com" : ""}${env.NODE_ENV === "development" ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    "font-src 'self'",
    `worker-src 'self' blob: data: ${sdk}`,
    "media-src 'self' blob:",
    "frame-src 'none'",
    "form-action 'self'",
    baselineCsp,
    "report-uri /api/csp-reports",
  ].join("; ");
}
