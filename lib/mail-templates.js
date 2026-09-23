// Plain text plus minimal inline HTML. Names come from users: always escaped.
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function layout({ greeting, lines, action, link, footer }) {
  const text = [greeting, "", ...lines, "", link, "", footer, "", "ColaBike"].join(
    "\n",
  );
  const html = `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:#f6f7f8;font-family:Arial,Helvetica,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e1e4e8;border-radius:10px;padding:28px">
<p style="margin:0 0 16px;font-size:16px">${escape(greeting)}</p>
${lines.map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escape(line)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escape(link)}" style="display:inline-block;background:#1f2328;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">${escape(action)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#57606a;word-break:break-all">${escape(link)}</p>
<p style="margin:16px 0 0;font-size:13px;color:#57606a">${escape(footer)}</p>
</div></body></html>`;
  return { text, html };
}

const greet = (name) => (name ? `Здравствуйте, ${name}!` : "Здравствуйте!");

export function passwordResetMail({ name, link }) {
  return {
    subject: "Восстановление пароля ColaBike",
    ...layout({
      greeting: greet(name),
      lines: [
        "Мы получили запрос на смену пароля для вашего аккаунта ColaBike.",
        "Ссылка действует 1 час и сработает один раз. После смены пароля все открытые сессии завершатся.",
      ],
      action: "Задать новый пароль",
      link,
      footer:
        "Если вы не запрашивали восстановление, просто проигнорируйте письмо: пароль останется прежним.",
    }),
  };
}

export function emailVerificationMail({ name, link }) {
  return {
    subject: "Подтвердите адрес почты для ColaBike",
    ...layout({
      greeting: greet(name),
      lines: [
        "Подтвердите, что этот адрес принадлежит вам: так мы сможем восстановить доступ к аккаунту и присылать важные уведомления.",
        "Ссылка действует 24 часа.",
      ],
      action: "Подтвердить адрес",
      link,
      footer: "Если вы не регистрировались на ColaBike, просто проигнорируйте письмо.",
    }),
  };
}
