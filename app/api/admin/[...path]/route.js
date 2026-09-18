import { traced, logError } from "../../../../lib/observability.js";
import { bikeResolverClient } from "../../../../lib/bike-resolver-client.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db, transaction } from "../../../../lib/db.js";
import { currentUser, startSession } from "../../../../lib/auth.js";
import {
  json,
  fail,
  readJson,
  readBytes,
  sameOrigin,
} from "../../../../lib/http.js";
import { getSite, audit, updateManagedUser } from "../../../../lib/site.js";
import {
  settingsInput,
  catalogInput,
  userInput,
} from "../../../../lib/admin-validation.js";
import { preparePhoto } from "../../../../lib/images.js";
import { uuid } from "../../../../lib/validation.js";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handler(req, { params }) {
  try {
    const user = await currentUser();
    if (!user) return fail("Войдите в аккаунт", 401);
    if (user.role !== "admin")
      return fail("Доступ только для администратора", 403);
    if (req.method !== "GET" && !sameOrigin(req))
      return fail("Недопустимый источник запроса", 403);
    const { path: p } = await params,
      method = req.method;
    if (p[0] === "resolver") {
      try {
        if (p.length === 1 && method === "GET")
          return json(await bikeResolverClient.request("/internal/settings"));
        if (p.length === 1 && method === "PUT") {
          const input = await readJson(req);
          const result = await bikeResolverClient.request(
            "/internal/settings",
            "PUT",
            input,
          );
          await audit(
            db,
            user.id,
            "resolver.settings.update",
            String(result.version),
          );
          return json(result);
        }
        if (p.length === 2 && p[1] === "cache" && method === "DELETE") {
          const adapter = new URL(req.url).searchParams.get("adapter") || "";
          const result = await bikeResolverClient.request(
            "/internal/cache?adapter=" + encodeURIComponent(adapter),
            "DELETE",
          );
          await audit(db, user.id, "resolver.cache.clear", adapter || "all");
          return json(result);
        }
      } catch (e) {
        return fail(e.message, e.status || 503);
      }
    }
    if (p[0] === "overview" && method === "GET") {
      const stats = await db.query(
        "SELECT (SELECT count(*)::int FROM users) AS users,(SELECT count(*)::int FROM bikes) AS bikes,(SELECT count(*)::int FROM photos) AS photos",
      );
      return json({ ...(await getSite()), stats: stats.rows[0], user });
    }
    if (
      ["settings", "catalog"].includes(p[0]) &&
      p.length === 1 &&
      method === "PUT"
    ) {
      const input = await readJson(req);
      const value = (p[0] === "settings" ? settingsInput : catalogInput).parse(
        input.value,
      );
      if (!Number.isInteger(input.version))
        return fail("Не указана версия настроек");
      const table = p[0] === "settings" ? "site_settings" : "site_catalog";
      const result = await transaction(async (q) => {
        if (p[0] === "settings")
          for (const key of [
            "logoId",
            "faviconId",
            "demoImageId",
            "garageImageId",
            "mtbImageId",
            "roadImageId",
            "gravelImageId",
            "navHomeIconId",
            "navProfileIconId",
            "navMessagesIconId",
            "navAdminIconId",
            "navLogoutIconId",
            "addBikeIconId",
            "searchIconId",
            "likeIconId",
            "mtbTypeIconId",
            "roadTypeIconId",
            "gravelTypeIconId",
          ])
            if (value[key]) {
              const a = await q.query(
                "SELECT id FROM site_assets WHERE id=$1 FOR SHARE",
                [value[key]],
              );
              if (!a.rows.length)
                return {
                  error: "Выбранное изображение удалено. Обновите страницу.",
                  status: 409,
                };
            }
        const r = await q.query(
          `UPDATE ${table} SET value=$1,version=version+1,updated_at=now() WHERE id=1 AND version=$2 RETURNING version`,
          [JSON.stringify(value), input.version],
        );
        if (!r.rows.length)
          return {
            error:
              "Настройки уже изменены другим администратором. Обновите страницу и повторите изменения.",
            status: 409,
          };
        await audit(q, user.id, p[0] + ".update", String(r.rows[0].version));
        return r.rows[0];
      });
      return result.error ? fail(result.error, result.status) : json(result);
    }
    if (p[0] === "users") {
      if (p.length === 1 && method === "GET") {
        const url = new URL(req.url);
        const term = (url.searchParams.get("q") || "").slice(0, 100),
          page = Math.max(
            1,
            Math.min(100000, Number(url.searchParams.get("page")) || 1),
          );
        const values = ["%" + term + "%", (page - 1) * 20];
        const { rows } = await db.query(
          "SELECT u.id,u.email,u.name,u.role,u.blocked,u.created_at,(SELECT count(*)::int FROM bikes b WHERE b.owner_id=u.id) AS bikes FROM users u WHERE u.email ILIKE $1 OR u.name ILIKE $1 ORDER BY u.created_at DESC,u.id LIMIT 20 OFFSET $2",
          values,
        );
        const total = await db.query(
          "SELECT count(*)::int AS count FROM users WHERE email ILIKE $1 OR name ILIKE $1",
          [values[0]],
        );
        return json({ users: rows, total: total.rows[0].count, page });
      }
      if (!uuid.safeParse(p[1]).success)
        return fail("Пользователь не найден", 404);
      if (p.length === 2 && method === "PATCH") {
        const input = userInput.parse(await readJson(req));
        const r = await transaction((q) =>
          updateManagedUser(q, user.id, p[1], input),
        );
        if (r.error) return fail(r.error, r.status);
        if (p[1] === user.id) await startSession(user.id);
        return json(r);
      }
      if (p[2] === "sessions" && method === "DELETE") {
        await transaction(async (q) => {
          await q.query("DELETE FROM sessions WHERE user_id=$1", [p[1]]);
          await audit(q, user.id, "user.sessions.revoke", p[1]);
        });
        return json({ ok: true });
      }
      if (p.length === 2 && method === "DELETE") {
        if (p[1] === user.id)
          return fail("Нельзя удалить собственный аккаунт", 409);
        const data = await readJson(req);
        let files = [];
        const result = await transaction(async (q) => {
          await q.query(
            "SELECT id FROM users WHERE role='admin' ORDER BY id FOR UPDATE",
          );
          const { rows } = await q.query(
            "SELECT id,role,email,avatar_id FROM users WHERE id=$1 FOR UPDATE",
            [p[1]],
          );
          if (!rows[0]) return { error: "Пользователь не найден", status: 404 };
          if (rows[0].role === "admin")
            return {
              error: "Сначала снимите права администратора",
              status: 409,
            };
          if (data.confirmEmail !== rows[0].email)
            return {
              error: "Для удаления введите email пользователя",
              status: 400,
            };
          files = (
            await q.query(
              "SELECT p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE b.owner_id=$1",
              [p[1]],
            )
          ).rows;
          if(rows[0].avatar_id) files.push({filename:"avatar-"+rows[0].avatar_id+".webp"});
          await q.query("DELETE FROM users WHERE id=$1", [p[1]]);
          await audit(q, user.id, "user.delete", p[1]);
          return { ok: true };
        });
        if (result.error) return fail(result.error, result.status);
        await Promise.all(
          files.map((f) =>
            unlink(
              path.join(process.env.UPLOAD_DIR || "uploads", f.filename),
            ).catch(() => {}),
          ),
        );
        return json(result);
      }
    }
    if (p[0] === "assets") {
      if (p.length === 1 && method === "GET")
        return json({
          assets: (
            await db.query(
              "SELECT id,name,created_at FROM site_assets ORDER BY created_at DESC",
            )
          ).rows,
        });
      if (p.length === 1 && method === "POST") {
        const bytes = await readBytes(req, 10 * 1024 * 1024);
        let image;
        try {
          image = await preparePhoto(bytes);
        } catch {
          return fail("Выберите изображение JPEG, PNG или WebP до 10 МБ");
        }
        const id = randomUUID(),
          filename = "site-" + id + ".webp",
          dir = process.env.UPLOAD_DIR || "uploads";
        const name = (
          new URL(req.url).searchParams.get("name") || "Изображение"
        ).slice(0, 150);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, filename), image);
        try {
          await transaction(async (q) => {
            await q.query(
              "INSERT INTO site_assets(id,name,filename) VALUES($1,$2,$3)",
              [id, name, filename],
            );
            await audit(q, user.id, "asset.create", id);
          });
        } catch (e) {
          await unlink(path.join(dir, filename)).catch(() => {});
          throw e;
        }
        return json({ id, name }, 201);
      }
      if (
        p.length === 2 &&
        uuid.safeParse(p[1]).success &&
        method === "DELETE"
      ) {
        const result = await transaction(async (q) => {
          const r = await q.query(
            "SELECT filename FROM site_assets WHERE id=$1 FOR UPDATE",
            [p[1]],
          );
          if (!r.rows.length)
            return { error: "Изображение не найдено", status: 404 };
          const config = (
            await q.query("SELECT value FROM site_settings WHERE id=1")
          ).rows[0].value;
          if (
            [
              "logoId",
              "faviconId",
              "demoImageId",
              "garageImageId",
              "mtbImageId",
              "roadImageId",
              "gravelImageId",
              "navHomeIconId",
              "navProfileIconId",
              "navMessagesIconId",
              "navAdminIconId",
              "navLogoutIconId",
              "addBikeIconId",
              "searchIconId",
              "likeIconId",
              "mtbTypeIconId",
              "roadTypeIconId",
              "gravelTypeIconId",
            ].some((k) => config[k] === p[1])
          )
            return {
              error:
                "Изображение используется на сайте. Сначала замените его в оформлении.",
              status: 409,
            };
          await q.query("DELETE FROM site_assets WHERE id=$1", [p[1]]);
          await audit(q, user.id, "asset.delete", p[1]);
          return { filename: r.rows[0].filename };
        });
        if (result.error) return fail(result.error, result.status);
        await unlink(
          path.join(process.env.UPLOAD_DIR || "uploads", result.filename),
        ).catch(() => {});
        return json({ ok: true });
      }
    }
    if (p[0] === "audit" && method === "GET")
      return json({
        events: (
          await db.query(
            "SELECT a.id,a.action,a.target,a.created_at,u.name AS actor FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100",
          )
        ).rows,
      });
    return fail("Не найдено", 404);
  } catch (e) {
    if (e.name === "ZodError")
      return fail(
        "Проверьте поля: " +
          e.issues.map((i) => i.path.join(".") + " — " + i.message).join("; "),
      );
    if (e.code === "23505") return fail("Этот email уже используется", 409);
    if (e instanceof SyntaxError) return fail("Некорректный запрос");
    logError("admin_api_error", e);
    return fail("Не удалось выполнить действие", 500);
  }
}
const route = traced(handler);
export {
  route as GET,
  route as PUT,
  route as POST,
  route as PATCH,
  route as DELETE,
};
