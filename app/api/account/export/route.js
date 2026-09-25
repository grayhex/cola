import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { db } from "../../../../lib/db.js";
import { fail, sameOrigin } from "../../../../lib/http.js";
import { exportAccount } from "../../../../lib/account-data.js";
import { traced } from "../../../../lib/observability.js";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Everything the account owns as one JSON file (#70). A POST, so the
// origin check applies like to every other account action.
export const POST = traced(async function POST(req) {
  if (!sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  if (!(await rateLimit("account-export:" + user.id, 5)))
    return fail("Выгрузку можно повторить через 15 минут.", 429);
  const data = await exportAccount(
    db,
    user.id,
    process.env.APP_ORIGIN || "http://localhost:3000",
  );
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="colabike-${user.username}-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
