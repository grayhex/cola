import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { digest } from "./password.ts";
import { limits } from "./limits.ts";
export function trustedIp(req: Request, env = process.env) {
  const expected = env.TRUSTED_PROXY_KEY,
    provided = req.headers.get("x-cola-proxy-key");
  if (
    !expected ||
    !provided ||
    Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  )
    return null;
  const ip = req.headers.get("x-cola-client-ip");
  return ip && isIP(ip) ? ip : null;
}
export async function allowAuth(
  req: Request,
  email: string,
  rateLimit: (key: string, maximum?: number) => Promise<boolean>,
) {
  const ip = trustedIp(req);
  // IP gate runs before global budget, so one address cannot consume the site's bucket.
  if (ip && !(await rateLimit("auth:ip:" + digest(ip), limits.authIp)))
    return false;
  if (!(await rateLimit("auth:" + digest(email), limits.authAccount)))
    return false;
  return rateLimit("auth:global", limits.authGlobal);
}
