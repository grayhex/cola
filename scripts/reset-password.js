// Server-owner CLI for accounts that cannot use the email link (mail not
// configured or mailbox lost). The password is read from stdin, never argv.
import pg from "pg";
import { pathToFileURL } from "node:url";
import { emailInput, passwordInput } from "../lib/validation.js";
import { hashPassword } from "../lib/password.js";

// Caller owns the transaction. Every session of the account ends.
export async function setPassword(q, email, password) {
  const address = emailInput.parse(email);
  const hash = await hashPassword(passwordInput.parse(password));
  const user = (
    await q.query(
      "UPDATE users SET password_hash=$2,password_changed_at=now() WHERE email=$1 RETURNING id",
      [address, hash],
    )
  ).rows[0];
  if (!user) throw new Error("Пользователь с таким адресом не найден.");
  await q.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
  await q.query(
    "DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset'",
    [user.id],
  );
  await q.query(
    "INSERT INTO admin_audit(actor_id,action,target) VALUES(NULL,'user.password_cli',$1)",
    [user.id],
  );
  return user.id;
}

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  let connected = false;
  try {
    if (!process.env.DATABASE_URL || !process.argv[2] || process.stdin.isTTY)
      throw new Error(
        "Usage: pass the new password on stdin to node scripts/reset-password.js email with DATABASE_URL set.",
      );
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1024) throw new Error("Пароль слишком длинный.");
      chunks.push(chunk);
    }
    const password = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/, "");
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    await setPassword(client, process.argv[2].trim(), password);
    await client.query("COMMIT");
    console.log("Пароль изменён, все сессии аккаунта завершены.");
  } catch (error) {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    console.error(
      error.name === "ZodError"
        ? "Проверьте email и пароль (10–128 символов)."
        : error.message,
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
