import { z } from "zod";
import {
  currentSessionHash,
  currentUser,
  rateLimit,
} from "../../../../../../lib/auth.ts";
import { db } from "../../../../../../lib/db.ts";
import {
  fail,
  json,
  readJson,
  sameOrigin,
} from "../../../../../../lib/http.ts";
import {
  FLOW_COOKIE,
  setFlowCookie,
} from "../../../../../../lib/identity-http.ts";
import {
  confirmPassword,
  listIdentities,
  safeReturnPath,
  saveFlow,
} from "../../../../../../lib/identities.ts";
import { traced } from "../../../../../../lib/observability.ts";
import {
  newFlowSecrets,
  yandexAuthorizeUrl,
  yandexIdConfig,
} from "../../../../../../lib/yandex-id.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const input = z.object({ password: z.string().min(1).max(128) }).strict();

// Starts linking Yandex ID to the signed-in account (#151). The password is
// asked again, so a stolen session alone cannot attach someone's Yandex
// account; the flow is tied to this session and this browser.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  const config = yandexIdConfig();
  if (!config) return fail("Вход через Яндекс сейчас недоступен", 503);
  if (!(await rateLimit("account-identity:" + user.id, 10)))
    return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
  let data;
  try {
    data = input.parse(await readJson(req, 4096));
  } catch {
    return fail("Введите пароль");
  }
  const confirmed = await confirmPassword(db, user.id, data.password);
  if (confirmed === "no_password")
    return fail(
      "У аккаунта нет пароля, привязывать нечего: Яндекс уже способ входа",
      409,
    );
  if (confirmed !== "ok") return fail("Пароль не подходит", 403);
  if (
    (await listIdentities(db, user.id)).identities.some(
      (i) => i.provider === "yandex",
    )
  )
    return fail("Яндекс уже привязан к аккаунту", 409);
  const secrets = newFlowSecrets();
  await saveFlow(db, {
    provider: "yandex",
    purpose: "link",
    state: secrets.state,
    browser: secrets.browser,
    verifier: secrets.verifier,
    returnPath: safeReturnPath("/account?tab=account"),
    userId: user.id,
    sessionHash: await currentSessionHash(),
  });
  await setFlowCookie(FLOW_COOKIE, secrets.browser, 600);
  return json({
    url: yandexAuthorizeUrl(config, secrets.state, secrets.challenge),
  });
});
