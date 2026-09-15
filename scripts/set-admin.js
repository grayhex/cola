import pg from "pg";
const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/set-admin.js user@example.com");
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const result = await client.query(
    "UPDATE users SET role='admin',blocked=false WHERE email=$1 RETURNING email",
    [email],
  );
  if (!result.rowCount)
    throw new Error("Сначала зарегистрируйте пользователя с этим email.");
  console.log("Администратор назначен:", result.rows[0].email);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
