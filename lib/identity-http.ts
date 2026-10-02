import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { rateLimit } from "./auth.ts";
import { trustedIp } from "./auth-limits.ts";
import { limits } from "./limits.ts";
import { digest } from "./password.ts";

// Browser plumbing shared by the provider endpoints (#151).

/** Binds a redirect flow to the browser that started it. */
export const FLOW_COOKIE = "cola_oauth";
/** Holds the parked first sign-in until the person completes it. */
export const SIGNUP_COOKIE = "cola_oauth_signup";
// Only the provider endpoints ever read these cookies.
const cookiePath = "/api/auth/yandex";

export async function setFlowCookie(
  name: string,
  value: string,
  seconds: number,
) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    // Lax: the provider returns by a top-level GET, which carries the cookie.
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: cookiePath,
    maxAge: seconds,
  });
}

export async function readFlowCookie(name: string) {
  return (await cookies()).get(name)?.value;
}

export async function clearFlowCookie(name: string) {
  (await cookies()).set(name, "", { path: cookiePath, maxAge: 0 });
}

/** A redirect to an absolute address, never cached. */
export function redirectToUrl(url: URL | string) {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** A redirect inside this site, built on the configured public origin. */
export function redirectTo(path: string) {
  return redirectToUrl(
    new URL(path, process.env.APP_ORIGIN || "http://localhost:3000"),
  );
}

/** Per-address and site-wide budget; proxy headers are trusted only when signed. */
export async function allowProviderStep(req: Request) {
  const ip = trustedIp(req);
  if (ip && !(await rateLimit("oauth:ip:" + digest(ip), limits.authIp)))
    return false;
  return rateLimit("oauth:global", limits.authGlobal);
}
