import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cspMode, pageCsp } from "./lib/csp.js";
export function proxy(request) {
  const headers = new Headers(request.headers);
  // Never trust a nonce/policy supplied by the client, including RSC requests.
  headers.delete("x-cola-nonce");
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  const mode = cspMode();
  const nonce = randomBytes(18).toString("base64");
  const policy = pageCsp(nonce);
  headers.set("x-cola-nonce", nonce);
  // Next extracts the nonce from the REQUEST CSP even in Report-Only mode.
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  // Report-Only retains the baseline response header from next.config.mjs.
  // Do not overwrite the internal request CSP with a baseline proxy header.
  if (mode === "enforce") response.headers.set("Content-Security-Policy", policy);
  if (mode === "report-only") response.headers.set("Content-Security-Policy-Report-Only", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!api(?:/|$)|_next(?:/|$)|fonts(?:/|$)|maplibre(?:/|$)|favicon\\.svg$|robots\\.txt$|sitemap\\.xml$|test-map-style\\.json$).*)"],
};
