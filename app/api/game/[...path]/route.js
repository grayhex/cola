import { db, transaction } from "../../../../lib/db.js";
import { currentUser, rateLimit } from "../../../../lib/auth.js";
import { json, fail, sameOrigin, readJson } from "../../../../lib/http.js";
import { traced, logError } from "../../../../lib/observability.js";
import { uuid } from "../../../../lib/validation.js";
import { CommunityError, communityPage } from "../../../../lib/community-validation.js";
import { records, awardCatalog, gameShelf, accountAchievements, reactionState, reactToBike, getGameSettings, excludeBike } from "../../../../lib/gamification.js";
import { gameSettingsInput, reactionKey, exclusionInput } from "../../../../lib/gamification-validation.js";
import { loadRules, rulesInput, saveRules, recalculateAwards } from "../../../../lib/game-rules.js";
import { audit } from "../../../../lib/site.js";
export const runtime = "nodejs", dynamic = "force-dynamic";
async function handler(req, { params }) {
  try {
    const { path: p } = await params, m = req.method;
    if (m !== "GET" && !sameOrigin(req)) return fail("Недопустимый источник запроса", 403);
    const user = await currentUser();
    // Records and every award with how many people have it (#106).
    if (p.length === 1 && p[0] === "records" && m === "GET")
      return json({ ...(await records(db)), awards: await awardCatalog(db) });
    if (p[0] === "profiles" && p.length === 2 && m === "GET") {
      const u = (await db.query("SELECT id FROM users WHERE lower(username)=lower($1) AND NOT blocked", [p[1]])).rows[0];
      if (!u) return fail("Профиль недоступен", 404);
      return json(await gameShelf(db, { userId: u.id }));
    }
    if (p[0] === "bikes" && p.length >= 2) {
      const id = uuid.parse(p[1]);
      if (p.length === 2 && m === "GET") {
        await reactionState(db, id, user?.id);
        return json(await gameShelf(db, { bikeId: id }));
      }
      if (p[2] === "reactions") {
        if (p.length === 3 && m === "GET") return json(await reactionState(db, id, user?.id));
        if (p.length === 4 && ["PUT", "DELETE"].includes(m)) {
          if (!user) return fail("Войдите в аккаунт", 401);
          if (!(await rateLimit("reaction:" + user.id, 60))) return fail("Слишком много реакций. Попробуйте позже.", 429);
          const kind = reactionKey.parse(p[3]);
          return json(await transaction((q) => reactToBike(q, id, user.id, kind, m === "PUT")));
        }
      }
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p.length === 1 && p[0] === "me" && m === "GET")
      return json(await accountAchievements(db, user.id));
    if (p[0] === "admin") {
      if (user.role !== "admin") return fail("Доступ только для администратора", 403);
      if (p.length === 2 && p[1] === "settings") {
        if (m === "GET") return json(await getGameSettings(db));
        if (m === "PUT") {
          const input = gameSettingsInput.parse(await readJson(req, 4096));
          return json(await transaction(async (q) => {
            await q.query("SELECT value FROM gamification_settings WHERE id=1 FOR UPDATE");
            await q.query("UPDATE gamification_settings SET value=$1 WHERE id=1", [input]);
            await audit(q, user.id, "gamification.settings", "1");
            return input;
          }));
        }
      }
      // Awards and records as rules: the list with how many people have each
      // award, saved as a whole (#106).
      if (p.length === 2 && p[1] === "rules") {
        if (m === "GET") return json(await adminRules());
        if (m === "PUT") {
          const body = await readJson(req, 131072);
          const parsed = rulesInput.safeParse(body);
          if (!parsed.success) {
            // The message names the rule: its title, or its place in the list.
            const issue = parsed.error.issues[0];
            const index = issue.path[1];
            const name = typeof index === "number" ? body?.rules?.[index]?.name : null;
            const rule = typeof name === "string" && name.trim()
              ? "«" + name.trim().slice(0, 60) + "»: "
              : typeof index === "number" ? "Правило " + (index + 1) + ": " : "";
            return fail(rule + issue.message);
          }
          await transaction((q) => saveRules(q, user.id, parsed.data));
          return json(await adminRules());
        }
      }
      if (p.length === 2 && p[1] === "recalculate" && m === "POST") {
        if (!(await rateLimit("game-recalculate:" + user.id, 10))) return fail("Слишком много пересчётов. Попробуйте позже.", 429);
        return json(await recalculateAwards(transaction, user.id));
      }
      if (p.length === 2 && p[1] === "bikes" && m === "GET") {
        const page = communityPage.parse(new URL(req.url).searchParams.get("page") || 1);
        return json({ bikes: (await db.query("SELECT id,name,share_id,leaderboard_excluded FROM bikes ORDER BY leaderboard_excluded DESC,created_at DESC LIMIT 25 OFFSET $1", [(page - 1) * 25])).rows, page });
      }
      if (p.length === 3 && p[1] === "bikes" && m === "PATCH") {
        const input = exclusionInput.parse(await readJson(req, 2048));
        return json(await transaction((q) => excludeBike(q, user.id, uuid.parse(p[2]), input)));
      }
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e.message === "Превышен допустимый размер запроса") return fail("Слишком большой запрос", 413);
    if (e.name === "ZodError" || e instanceof SyntaxError) return fail("Проверьте поля");
    logError("gamification_request_failed", e);
    return fail("Не удалось выполнить запрос", 500);
  }
}
async function adminRules() {
  const awarded = new Map(
    (await db.query("SELECT achievement_key AS key,count(DISTINCT user_id)::int AS n FROM achievement_awards GROUP BY achievement_key")).rows.map((r) => [r.key, r.n]),
  );
  return {
    rules: (await loadRules(db)).map((r) => ({ ...r, awarded: awarded.get(r.key) || 0 })),
    settings: await getGameSettings(db),
  };
}
export const GET = traced(handler), PUT = traced(handler), POST = traced(handler), DELETE = traced(handler), PATCH = traced(handler);
