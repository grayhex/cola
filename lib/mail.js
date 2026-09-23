import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class MailUnavailableError extends Error {
  constructor() {
    super("Отправка писем не настроена");
    this.name = "MailUnavailableError";
    this.status = 503;
  }
}

// SMTP_URL: smtps://user:pass@host:465 (TLS) or smtp://user:pass@host:587 (STARTTLS
// required). MAIL_CAPTURE_DIR writes JSON files instead and is for development
// and tests only; production ignores it (see runtime-config.js).
export function mailConfig(env = process.env) {
  if (env.SMTP_URL) {
    let url;
    try {
      url = new URL(env.SMTP_URL);
    } catch {
      return null;
    }
    if (!["smtp:", "smtps:"].includes(url.protocol) || !url.hostname)
      return null;
    return {
      mode: "smtp",
      from: env.MAIL_FROM || null,
      options: {
        host: url.hostname,
        port: Number(url.port) || (url.protocol === "smtps:" ? 465 : 587),
        secure: url.protocol === "smtps:",
        // Plain SMTP only for an explicit local relay: smtp://host:25?tls=none
        requireTLS:
          url.protocol === "smtp:" && url.searchParams.get("tls") !== "none",
        ignoreTLS: url.searchParams.get("tls") === "none",
        auth: url.username
          ? {
              user: decodeURIComponent(url.username),
              pass: decodeURIComponent(url.password),
            }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      },
    };
  }
  if (env.MAIL_CAPTURE_DIR && env.DEPLOYMENT_MODE !== "production")
    return {
      mode: "capture",
      from: env.MAIL_FROM || "ColaBike <noreply@localhost>",
      dir: path.resolve(env.MAIL_CAPTURE_DIR),
    };
  return null;
}
export const mailEnabled = (env = process.env) => !!mailConfig(env)?.from;

let cached = null;
async function smtpTransport(options) {
  const key = JSON.stringify(options);
  if (cached?.key !== key) {
    const { default: nodemailer } = await import("nodemailer");
    cached = { key, transport: nodemailer.createTransport(options) };
  }
  return cached.transport;
}

export async function sendMail({ to, subject, text, html }, env = process.env) {
  const config = mailConfig(env);
  if (!config?.from) throw new MailUnavailableError();
  if (config.mode === "capture") {
    await mkdir(config.dir, { recursive: true, mode: 0o700 });
    const file = path.join(config.dir, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(
      file,
      JSON.stringify({ from: config.from, to, subject, text, html }),
      { mode: 0o600 },
    );
    return { captured: file };
  }
  const transport = await smtpTransport(config.options);
  const info = await transport.sendMail({
    from: config.from,
    to,
    subject,
    text,
    html,
  });
  return { messageId: info.messageId };
}
