import {
  currentSessionHash,
  currentUser,
  startSession,
} from "../../../../../lib/auth.ts";
import { db } from "../../../../../lib/db.ts";
import {
  FLOW_COOKIE,
  SIGNUP_COOKIE,
  allowProviderStep,
  clearFlowCookie,
  readFlowCookie,
  redirectTo,
  redirectToUrl,
  setFlowCookie,
} from "../../../../../lib/identity-http.ts";
import {
  consumeFlow,
  emailTaken,
  findIdentityUser,
  linkIdentity,
  savePendingSignup,
} from "../../../../../lib/identities.ts";
import {
  issueNativeCode,
  nativeAuthReturnUrl,
  nativeReturn,
} from "../../../../../lib/native-auth.ts";
import { traced } from "../../../../../lib/observability.ts";
import { getSite } from "../../../../../lib/site.ts";
import {
  YandexIdError,
  exchangeYandexCode,
  fetchYandexProfile,
  yandexIdConfig,
  yandexReturn,
} from "../../../../../lib/yandex-id.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const account = (code: string) => "/account?tab=account&identity=" + code;
const login = (code: string) => "/login?identity=" + code;

// The return from Yandex ID (#151). Every outcome is a redirect with a fixed
// notice code. The `state` is one-time and bound to this browser; the code is
// exchanged with the PKCE verifier of the same flow; the access token is used
// for one profile read and dropped.
export const GET = traced(async function GET(req) {
  const config = yandexIdConfig();
  if (!config) return redirectTo(login("disabled"));
  if (!(await allowProviderStep(req))) return redirectTo(login("rate_limited"));
  const query = yandexReturn.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!query.success) return redirectTo(login("invalid"));
  const browser = await readFlowCookie(FLOW_COOKIE);
  const flow = await consumeFlow(db, "yandex", query.data.state, browser);
  // A stray or forged return must not end a flow this browser has in progress.
  if (!flow) return redirectTo(login("state"));
  await clearFlowCookie(FLOW_COOKIE);
  // A native app (#304) gets every outcome on its own HTTPS link: a one-time
  // code, or a fixed error code. Its flow is otherwise this one.
  const app = flow.purpose === "native" ? nativeAuthReturnUrl() : null;
  if (flow.purpose === "native" && !app) return redirectTo(login("disabled"));
  const back = (code: string) =>
    app
      ? redirectToUrl(nativeReturn(app, { error: code }))
      : redirectTo(flow.purpose === "link" ? account(code) : login(code));
  // Refusal on the Yandex page (or any provider error) ends the flow quietly.
  if (query.data.error || !query.data.code)
    return back(
      query.data.error === "access_denied" ? "cancelled" : "provider_error",
    );
  let profile;
  try {
    const token = await exchangeYandexCode(
      config,
      query.data.code,
      flow.code_verifier,
    );
    profile = await fetchYandexProfile(config, token);
  } catch (e) {
    if (!(e instanceof YandexIdError)) throw e;
    return back("provider_error");
  }

  if (flow.purpose === "link") {
    // The person confirmed the password in this very session; it must still be it.
    const viewer = await currentUser();
    if (
      !viewer ||
      viewer.id !== flow.user_id ||
      (await currentSessionHash()) !== flow.session_hash
    )
      return redirectTo(login("session"));
    const result = await linkIdentity(db, viewer.id, "yandex", profile.subject);
    return redirectTo(account(result));
  }

  const known = await findIdentityUser(db, "yandex", profile.subject);
  if (known) {
    // A blocked account cannot sign in by any method.
    if (known.blocked) return back("blocked");
    if (app && flow.app_challenge)
      return redirectToUrl(
        nativeReturn(app, {
          code: await issueNativeCode(db, known.userId, flow.app_challenge),
        }),
      );
    await startSession(known.userId);
    return redirectTo(flow.return_path);
  }
  // First sign-in. A closed registration only stops new people.
  if (!(await getSite()).settings.registrationOpen)
    return back("registration_closed");
  // A matching address is never a reason to merge: sign in the usual way first.
  if (profile.email && (await emailTaken(db, profile.email)))
    return back("email_exists");
  const token = await savePendingSignup(db, {
    provider: "yandex",
    subject: profile.subject,
    name: profile.name,
    email: profile.email,
    returnPath: flow.return_path,
    // The username and documents are chosen in this browser; the code for the
    // app comes after that (complete).
    appChallenge: app ? flow.app_challenge : null,
  });
  await setFlowCookie(SIGNUP_COOKIE, token, 900);
  return redirectTo("/login/yandex");
});
