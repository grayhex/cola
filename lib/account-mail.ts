import type { MailMessage as MailMessageType } from "./mail.ts";
import { after } from "next/server";
import { sendMail } from "./mail.ts";
import { logError } from "./observability.ts";
// Mail goes out after the response: timing does not reveal whether an address
// is registered, and a slow SMTP server does not block the page.
export function sendAfterResponse(message: MailMessageType) {
  after(async () => {
    try {
      await sendMail(message);
    } catch (e) {
      logError("mail_send_failed", e);
    }
  });
}
