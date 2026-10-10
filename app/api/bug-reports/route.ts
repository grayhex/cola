import { randomUUID } from "node:crypto";
import { currentUser, rateLimit } from "../../../lib/auth.ts";
import { trustedIp } from "../../../lib/auth-limits.ts";
import { allowBugReport, bugReportInput } from "../../../lib/bug-reports.ts";
import { digest } from "../../../lib/password.ts";
import { fail, json, readJson, sameOrigin } from "../../../lib/http.ts";
import {
  bugReportRecipient,
  mailEnabled,
  sendMail,
} from "../../../lib/mail.ts";
import { bugReportMail } from "../../../lib/mail-templates.ts";
import {
  currentRequestId,
  logEvent,
  traced,
} from "../../../lib/observability.ts";
import { appVersion } from "../../../lib/version.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = traced(async (req: Request) => {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  let input;
  try {
    input = bugReportInput.parse(await readJson(req, 32768));
  } catch {
    return fail("Проверьте описание, email и размер сообщения");
  }
  const user = await currentUser();
  const ip = trustedIp(req);
  if (
    !(await allowBugReport(ip ? digest(ip) : null, user?.id || null, rateLimit))
  )
    return fail("Слишком много сообщений. Повторите через 15 минут.", 429);
  const to = bugReportRecipient();
  if (!to || !mailEnabled())
    return fail(
      "Отправка сообщений владельцу пока не настроена. Текст сохранён в форме.",
      503,
    );
  const id = randomUUID();
  const mail = bugReportMail(input, {
    id,
    requestId: currentRequestId() || id,
    at: new Date().toISOString(),
    build: appVersion.build,
    accountId: user?.id || null,
  });
  try {
    await sendMail({ to, ...mail });
    logEvent("bug_report", { reportId: id, status: "accepted" });
    return json({ id, accepted: true });
  } catch {
    // Transport errors can carry message bodies, contacts and SMTP credentials.
    logEvent("bug_report", { reportId: id, status: "unconfirmed" });
    return fail(
      "Не удалось подтвердить отправку. Текст сохранён — попробуйте позже.",
      502,
    );
  }
});
