import { db } from "../../../../../lib/db.ts";
import {
  FLOW_COOKIE,
  allowProviderStep,
  redirectTo,
  redirectToUrl,
  setFlowCookie,
} from "../../../../../lib/identity-http.ts";
import { saveFlow } from "../../../../../lib/identities.ts";
import {
  challengePattern,
  nativeAuthReturnUrl,
  nativeReturn,
} from "../../../../../lib/native-auth.ts";
import { traced } from "../../../../../lib/observability.ts";
import {
  newFlowSecrets,
  yandexAuthorizeUrl,
  yandexIdConfig,
} from "../../../../../lib/yandex-id.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Begins sign-in of the native app (#304): the app opens this address in the
// system browser (ASWebAuthenticationSession / Custom Tabs) with the provider
// and the S256 challenge of a secret it keeps. From here on it is the flow of
// #151 in that browser. A refusal goes back to the app's own link with a fixed
// error code; without the link configured the feature does not exist.
export const GET = traced(async function GET(req) {
  const back = nativeAuthReturnUrl();
  const config = yandexIdConfig();
  if (!back || !config) return redirectTo("/login?identity=disabled");
  const query = new URL(req.url).searchParams;
  const challenge = query.get("code_challenge") ?? "";
  if (
    query.get("provider") !== "yandex" ||
    !challengePattern.test(challenge) ||
    (query.has("code_challenge_method") &&
      query.get("code_challenge_method") !== "S256")
  )
    return redirectToUrl(nativeReturn(back, { error: "invalid_request" }));
  if (!(await allowProviderStep(req)))
    return redirectToUrl(nativeReturn(back, { error: "rate_limited" }));
  const secrets = newFlowSecrets();
  await saveFlow(db, {
    provider: "yandex",
    purpose: "native",
    state: secrets.state,
    browser: secrets.browser,
    verifier: secrets.verifier,
    returnPath: "/account",
    appChallenge: challenge,
  });
  await setFlowCookie(FLOW_COOKIE, secrets.browser, 600);
  return redirectToUrl(
    yandexAuthorizeUrl(config, secrets.state, secrets.challenge),
  );
});
