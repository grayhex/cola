import { db } from "../../../../../lib/db.ts";
import {
  FLOW_COOKIE,
  allowProviderStep,
  redirectTo,
  redirectToUrl,
  setFlowCookie,
} from "../../../../../lib/identity-http.ts";
import { safeReturnPath, saveFlow } from "../../../../../lib/identities.ts";
import { traced } from "../../../../../lib/observability.ts";
import {
  newFlowSecrets,
  yandexAuthorizeUrl,
  yandexIdConfig,
} from "../../../../../lib/yandex-id.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Begins sign-in with Yandex ID (#151): a one-time `state`, a PKCE verifier and
// a browser-binding cookie are created, then the browser goes to Yandex. The
// start changes nothing about the account, so a GET link is enough.
export const GET = traced(async function GET(req) {
  const config = yandexIdConfig();
  if (!config) return redirectTo("/login?identity=disabled");
  if (!(await allowProviderStep(req)))
    return redirectTo("/login?identity=rate_limited");
  const secrets = newFlowSecrets();
  await saveFlow(db, {
    provider: "yandex",
    purpose: "login",
    state: secrets.state,
    browser: secrets.browser,
    verifier: secrets.verifier,
    returnPath: safeReturnPath(new URL(req.url).searchParams.get("return")),
  });
  await setFlowCookie(FLOW_COOKIE, secrets.browser, 600);
  return redirectToUrl(
    yandexAuthorizeUrl(config, secrets.state, secrets.challenge),
  );
});
