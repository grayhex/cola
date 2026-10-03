import { startSession } from "../../../../../lib/auth.ts";
import { db, transaction } from "../../../../../lib/db.ts";
import { fail, json, readJson, sameOrigin } from "../../../../../lib/http.ts";
import {
  SIGNUP_COOKIE,
  allowProviderStep,
  clearFlowCookie,
  readFlowCookie,
} from "../../../../../lib/identity-http.ts";
import {
  completeSignup,
  completionInput,
  readPendingSignup,
} from "../../../../../lib/identities.ts";
import {
  issueNativeCode,
  nativeAuthReturnUrl,
  nativeReturn,
} from "../../../../../lib/native-auth.ts";
import { LegalError } from "../../../../../lib/legal-documents.ts";
import { sendAfterResponse } from "../../../../../lib/account-mail.ts";
import {
  accountLink,
  requestEmailVerification,
} from "../../../../../lib/account.ts";
import { mailEnabled } from "../../../../../lib/mail.ts";
import { emailVerificationMail } from "../../../../../lib/mail-templates.ts";
import { traced } from "../../../../../lib/observability.ts";
import { getSite } from "../../../../../lib/site.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Finishes the first sign-in with Yandex ID (#151): the same username and
// explicit acceptance of both documents as the password registration.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  if (!(await allowProviderStep(req)))
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  const token = await readFlowCookie(SIGNUP_COOKIE);
  if (!token)
    return json(
      {
        error: "Время входа истекло. Войдите через Яндекс заново.",
        code: "signup_expired",
      },
      410,
    );
  if (!(await getSite()).settings.registrationOpen)
    return fail("Регистрация временно закрыта", 403);
  let raw: unknown, input;
  try {
    raw = await readJson(req, 8192);
    input = completionInput.parse(raw);
  } catch {
    return fail("Проверьте заполнение полей");
  }
  // A parked sign-in of the native app (#304) ends in a code for the app, never
  // in a web session of this browser: if the app's link was withdrawn since,
  // nothing is created and the parked sign-in stays until it expires.
  const parked = await readPendingSignup(db, token);
  if (parked?.app_challenge && !nativeAuthReturnUrl())
    return json(
      {
        error:
          "Вход из приложения сейчас недоступен. Начните вход в приложении заново.",
        code: "native_unavailable",
      },
      409,
    );
  let result;
  try {
    result = await completeSignup(transaction, token, input, raw);
  } catch (e) {
    if (e instanceof LegalError)
      return json({ error: e.message, code: e.code }, e.status);
    throw e;
  }
  if (!result.ok) {
    if (result.code === "signup_expired") await clearFlowCookie(SIGNUP_COOKIE);
    return json({ error: result.error, code: result.code }, result.status);
  }
  await clearFlowCookie(SIGNUP_COOKIE);
  // A first sign-in that a native app started (#304): no web session is opened
  // in this browser; the app gets its one-time code on its own HTTPS link.
  const app = result.appChallenge ? nativeAuthReturnUrl() : null;
  // Only a sign-in that never came from the app opens a web session.
  if (!result.appChallenge) await startSession(result.userId);
  // The provider does not promise a confirmed address, so the usual link is sent.
  if (mailEnabled()) {
    const verification = await requestEmailVerification(db, result.userId);
    if (verification)
      sendAfterResponse({
        to: result.email,
        ...emailVerificationMail({
          name: result.name,
          link: accountLink("/verify-email", verification.token),
        }),
      });
  }
  return json(
    {
      user: {
        id: result.userId,
        email: result.email,
        name: result.name,
        username: result.username,
      },
      returnPath:
        app && result.appChallenge
          ? nativeReturn(app, {
              code: await issueNativeCode(
                db,
                result.userId,
                result.appChallenge,
              ),
            }).toString()
          : result.returnPath,
    },
    201,
  );
});
