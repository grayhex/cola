// Server-owner CLI only. Public registration never bypasses document acceptance.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { credentials } from "../lib/validation.js";
import { hashPassword } from "../lib/password.js";

// Caller owns the transaction; a table lock makes concurrent first-owner attempts exclusive.
export async function bootstrapAdmin(q, raw) {
  const input = credentials.parse(raw);
  if (!input.name) throw new Error("Укажите имя администратора.");
  const hash = await hashPassword(input.password);
  await q.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
  if (
    (await q.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows
      .length
  )
    throw new Error(
      "Администратор уже существует. Для существующего аккаунта используйте set-admin.js.",
    );
  const id = randomUUID();
  await q.query(
    "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
    [id, input.email, input.name, hash],
  );
  await q.query(
    "INSERT INTO admin_audit(actor_id,action,target) VALUES($1,'admin.bootstrap',$2)",
    [id, id],
  );
  return { id, email: input.email };
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let connected = false;
  try {
    if (
      !process.env.DATABASE_URL ||
      !process.argv[2] ||
      !process.argv[3] ||
      process.stdin.isTTY
    )
      throw new Error(
        "Usage: pass password on stdin to node scripts/bootstrap-admin.js email name with DATABASE_URL set.",
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
    const result = await bootstrapAdmin(client, {
      email: process.argv[2].trim(),
      name: process.argv[3],
      password,
    });
    await client.query("COMMIT");
    console.log("Первый администратор создан:", result.email);
    console.log("Войдите и опубликуйте оба документа в Система → Документы.");
  } catch (error) {
    if (connected) await client.query("ROLLBACK").catch(() => {});
    console.error(
      error.name === "ZodError"
        ? "Проверьте email, имя и пароль (10–128 символов)."
        : error.message,
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
