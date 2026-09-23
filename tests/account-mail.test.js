import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
import {
  mailConfig,
  mailEnabled,
  sendMail,
  MailUnavailableError,
} from "../lib/mail.js";
import {
  emailVerificationMail,
  passwordResetMail,
} from "../lib/mail-templates.js";
import {
  accountLink,
  consumeToken,
  issueToken,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "../lib/account.js";
import { digest, hashPassword, verifyPassword } from "../lib/password.js";
import { setPassword } from "../scripts/reset-password.js";

test("mail configuration: TLS by default, explicit local relay, capture only outside production", () => {
  const smtps = mailConfig({
    SMTP_URL: "smtps://user%40x:p%3Ass@smtp.example.com",
    MAIL_FROM: "C <a@b.c>",
  });
  assert.equal(smtps.mode, "smtp");
  assert.deepEqual(
    {
      host: smtps.options.host,
      port: smtps.options.port,
      secure: smtps.options.secure,
    },
    { host: "smtp.example.com", port: 465, secure: true },
  );
  assert.deepEqual(smtps.options.auth, { user: "user@x", pass: "p:ss" });
  const starttls = mailConfig({
    SMTP_URL: "smtp://smtp.example.com:587",
    MAIL_FROM: "a@b.c",
  });
  assert.equal(starttls.options.requireTLS, true);
  assert.equal(starttls.options.ignoreTLS, false);
  const relay = mailConfig({
    SMTP_URL: "smtp://127.0.0.1:2525?tls=none",
    MAIL_FROM: "a@b.c",
  });
  assert.equal(relay.options.requireTLS, false);
  assert.equal(relay.options.ignoreTLS, true);
  assert.equal(mailConfig({ SMTP_URL: "https://smtp.example.com" }), null);
  assert.equal(mailConfig({}), null);
  assert.equal(mailConfig({ MAIL_CAPTURE_DIR: "/tmp/x" }).mode, "capture");
  assert.equal(
    mailConfig({ MAIL_CAPTURE_DIR: "/tmp/x", DEPLOYMENT_MODE: "production" }),
    null,
  );
  assert.equal(
    mailEnabled({ SMTP_URL: "smtps://h" }),
    false,
    "a sender address is required",
  );
  assert.equal(
    mailEnabled({ SMTP_URL: "smtps://h", MAIL_FROM: "a@b.c" }),
    true,
  );
});

test("templates escape user data and carry the link in text and HTML", () => {
  const link = accountLink("/reset-password", "a".repeat(43), {
    APP_ORIGIN: "https://colabike.ru",
  });
  assert.equal(link, "https://colabike.ru/reset-password#" + "a".repeat(43));
  const reset = passwordResetMail({
    name: '<img src=x onerror="alert(1)">',
    link,
  });
  assert.match(reset.subject, /Восстановление пароля/);
  assert.ok(reset.text.includes(link));
  assert.ok(reset.html.includes(link));
  assert.doesNotMatch(reset.html, /<img src=x/);
  assert.match(reset.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  const verify = emailVerificationMail({ name: "", link });
  assert.match(verify.text, /^Здравствуйте!/);
});

test("capture transport writes private JSON files; missing config refuses to send", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-mail-"));
  try {
    const result = await sendMail(
      { to: "rider@example.test", subject: "S", text: "T", html: "<p>H</p>" },
      { MAIL_CAPTURE_DIR: dir },
    );
    const saved = JSON.parse(await readFile(result.captured, "utf8"));
    assert.deepEqual(saved, {
      from: "ColaBike <noreply@localhost>",
      to: "rider@example.test",
      subject: "S",
      text: "T",
      html: "<p>H</p>",
    });
    assert.equal((await stat(result.captured)).mode & 0o777, 0o600);
    await assert.rejects(sendMail({ to: "a@b.c" }, {}), MailUnavailableError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SMTP delivery through nodemailer reaches a relay with the expected envelope", async () => {
  const sessions = [];
  const server = net.createServer((socket) => {
    const session = { commands: [], data: "" };
    sessions.push(session);
    let buffer = "",
      inData = false;
    socket.write("220 relay.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 queued\r\n");
          } else session.data += line + "\n";
          continue;
        }
        session.commands.push(line);
        if (/^EHLO/i.test(line))
          socket.write("250-relay.test\r\n250 8BITMIME\r\n");
        else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = {
      SMTP_URL: `smtp://127.0.0.1:${server.address().port}?tls=none`,
      MAIL_FROM: "ColaBike <noreply@colabike.test>",
    };
    const message = passwordResetMail({
      name: "Алиса",
      link: "https://colabike.test/reset-password#token",
    });
    const result = await sendMail(
      { to: "alice@example.test", ...message },
      env,
    );
    assert.ok(result.messageId);
    const session = sessions.find((s) => s.data);
    assert.ok(
      session.commands.some((c) => c === "MAIL FROM:<noreply@colabike.test>"),
    );
    assert.ok(
      session.commands.some((c) => c === "RCPT TO:<alice@example.test>"),
    );
    assert.match(session.data, /Subject: =\?UTF-8\?/);
    assert.match(session.data, /multipart\/alternative/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function database() {
  const db = new PGlite();
  const files = (await readdir(new URL("../db/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(
      await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
    );
    if (file === "002_admin.sql") {
      await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
        JSON.stringify(defaultSettings),
      ]);
      await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
        JSON.stringify(defaultCatalog),
      ]);
    }
  }
  return db;
}
async function user(db, email) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Rider',$3)",
    [id, email, await hashPassword("old-password-123")],
  );
  return id;
}

test("tokens are single-use, expire, match their purpose and replace older links", async () => {
  const db = await database();
  try {
    const id = await user(db, "tokens@example.test");
    const first = await issueToken(
      db,
      id,
      "password_reset",
      "tokens@example.test",
    );
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    const stored = (
      await db.query(
        "SELECT token_hash,expires_at-now() > interval '50 minutes' fresh FROM auth_tokens",
      )
    ).rows;
    assert.deepEqual(
      stored.map((r) => r.token_hash),
      [digest(first)],
      "only the digest is stored",
    );
    assert.equal(stored[0].fresh, true);
    const second = await issueToken(
      db,
      id,
      "password_reset",
      "tokens@example.test",
    );
    assert.equal(
      await consumeToken(db, first, "password_reset"),
      null,
      "a new link replaces the old one",
    );
    assert.equal(
      await consumeToken(db, second, "email_verify"),
      null,
      "purpose must match",
    );
    assert.equal(await consumeToken(db, "short", "password_reset"), null);
    assert.equal(
      (await consumeToken(db, second, "password_reset")).user_id,
      id,
    );
    assert.equal(
      await consumeToken(db, second, "password_reset"),
      null,
      "single use",
    );
    const expired = await issueToken(
      db,
      id,
      "email_verify",
      "tokens@example.test",
    );
    await db.query(
      "UPDATE auth_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
      [digest(expired)],
    );
    assert.equal(await consumeToken(db, expired, "email_verify"), null);
    const blocked = await issueToken(
      db,
      id,
      "email_verify",
      "tokens@example.test",
    );
    await db.query("UPDATE users SET blocked=true WHERE id=$1", [id]);
    assert.equal(
      await consumeToken(db, blocked, "email_verify"),
      null,
      "blocked accounts cannot use links",
    );
  } finally {
    await db.close();
  }
});

test("password reset changes the hash, verifies the address and ends every session", async () => {
  const db = await database();
  try {
    const id = await user(db, "reset@example.test");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day'),($3,$2,now()+interval '1 day')",
      ["a".repeat(64), id, "b".repeat(64)],
    );
    assert.equal(await requestPasswordReset(db, "unknown@example.test"), null);
    const { token, user: found } = await requestPasswordReset(
      db,
      "reset@example.test",
    );
    assert.equal(found.id, id);
    assert.equal(await resetPassword(db, token, "new-password-456"), id);
    const row = (
      await db.query(
        "SELECT password_hash,email_verified_at,password_changed_at FROM users WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(
      await verifyPassword("new-password-456", row.password_hash),
      true,
    );
    assert.equal(
      await verifyPassword("old-password-123", row.password_hash),
      false,
    );
    assert.ok(row.email_verified_at);
    assert.ok(row.password_changed_at);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM sessions WHERE user_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      await resetPassword(db, token, "another-password-789"),
      null,
      "the link works once",
    );
    // A link sent to an address that changed since is no longer valid.
    const stale = await requestPasswordReset(db, "reset@example.test");
    await db.query("UPDATE users SET email='moved@example.test' WHERE id=$1", [
      id,
    ]);
    assert.equal(
      await resetPassword(db, stale.token, "another-password-789"),
      null,
    );
  } finally {
    await db.close();
  }
});

test("email verification confirms only the address the link was sent to", async () => {
  const db = await database();
  try {
    const id = await user(db, "verify@example.test");
    const { token } = await requestEmailVerification(db, id);
    assert.equal(await verifyEmail(db, token), id);
    assert.ok(
      (await db.query("SELECT email_verified_at FROM users WHERE id=$1", [id]))
        .rows[0].email_verified_at,
    );
    assert.equal(
      await requestEmailVerification(db, id),
      null,
      "already verified",
    );
    const other = await user(db, "change@example.test");
    const pending = await requestEmailVerification(db, other);
    await db.query("UPDATE users SET email='new@example.test' WHERE id=$1", [
      other,
    ]);
    assert.equal(await verifyEmail(db, pending.token), null);
    assert.equal(
      (
        await db.query("SELECT email_verified_at FROM users WHERE id=$1", [
          other,
        ])
      ).rows[0].email_verified_at,
      null,
    );
  } finally {
    await db.close();
  }
});

test("operator CLI sets a password, revokes sessions and records an audit entry", async () => {
  const db = await database();
  try {
    const id = await user(db, "cli@example.test");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      ["c".repeat(64), id],
    );
    assert.equal(
      await setPassword(db, "CLI@example.test", "cli-password-123"),
      id,
    );
    const row = (
      await db.query("SELECT password_hash FROM users WHERE id=$1", [id])
    ).rows[0];
    assert.equal(
      await verifyPassword("cli-password-123", row.password_hash),
      true,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM sessions WHERE user_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT action FROM admin_audit WHERE target=$1", [id]))
        .rows[0].action,
      "user.password_cli",
    );
    await assert.rejects(
      setPassword(db, "nobody@example.test", "cli-password-123"),
      /не найден/,
    );
    await assert.rejects(setPassword(db, "cli@example.test", "short"), {
      name: "ZodError",
    });
  } finally {
    await db.close();
  }
});
