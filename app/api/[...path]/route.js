import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { preparePhoto } from "../../../lib/images.js";
import { db, transaction } from "../../../lib/db.js";
import {
  currentUser,
  startSession,
  endSession,
  rateLimit,
} from "../../../lib/auth.js";
import { hashPassword, verifyPassword, digest } from "../../../lib/password.js";
import {
  bikeInput,
  componentInput,
  credentials,
  uuid,
} from "../../../lib/validation.js";
import {
  ownedBike,
  hydrate,
  sharedBike,
  insertBike,
} from "../../../lib/repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uploads = () => path.resolve(process.env.UPLOAD_DIR || "uploads");
const json = (data, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => json({ error: message }, status);
async function body(req) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 65536) {
      await reader.cancel();
      throw new Error("BODY_LIMIT");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function handler(req, { params }) {
  try {
    const { path: p } = await params;
    const method = req.method;
    if (method !== "GET") {
      if (
        req.headers.get("origin") !==
        (process.env.APP_ORIGIN || "http://localhost:3000")
      )
        return fail("Недопустимый источник запроса", 403);
    }
    if (p[0] === "health" && method === "GET") {
      await db.query("SELECT 1");
      return json({ ok: true });
    }
    if (
      p[0] === "auth" &&
      ["login", "register"].includes(p[1]) &&
      method === "POST"
    ) {
      const input = credentials.parse(await body(req));
      // Global and per-account limits are DB-backed and do not trust proxy headers.
      if (
        !(await rateLimit("auth:global", 300)) ||
        !(await rateLimit("auth:" + digest(input.email), 15))
      )
        return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
      if (p[1] === "register") {
        if (!input.name) return fail("Введите имя");
        const id = randomUUID();
        const hash = await hashPassword(input.password);
        try {
          await db.query(
            "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
            [id, input.email, input.name, hash],
          );
        } catch (e) {
          if (e.code === "23505")
            return fail(
              "Не удалось зарегистрироваться с этим адресом. Попробуйте войти.",
              409,
            );
          throw e;
        }
        await startSession(id);
        return json(
          { user: { id, email: input.email, name: input.name } },
          201,
        );
      }
      const { rows } = await db.query("SELECT * FROM users WHERE email=$1", [
        input.email,
      ]);
      const user = rows[0];
      const valid = await verifyPassword(
        input.password,
        user?.password_hash ||
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      if (!user || !valid) return fail("Неверная почта или пароль", 401);
      await startSession(user.id);
      return json({
        user: { id: user.id, email: user.email, name: user.name },
      });
    }
    if (p[0] === "auth" && p[1] === "logout" && method === "POST") {
      await endSession();
      return json({ ok: true });
    }
    if (p[0] === "shared" && p.length === 2 && method === "GET") {
      if (!uuid.safeParse(p[1]).success)
        return fail("Велосипед не найден", 404);
      const bike = await sharedBike(db, p[1]);
      return bike
        ? json({ bike })
        : fail("Велосипед не найден или доступ закрыт", 404);
    }
    const user = await currentUser();
    if (p[0] === "me" && method === "GET") return json({ user });
    if (p[0] === "photos" && p.length === 2 && method === "GET") {
      if (!uuid.safeParse(p[1]).success) return fail("Фото не найдено", 404);
      const { rows } = await db.query(
        "SELECT p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id WHERE p.id=$1 AND (b.is_public=true OR b.owner_id=$2)",
        [p[1], user?.id || null],
      );
      if (!rows[0]) return fail("Фото не найдено", 404);
      try {
        return new NextResponse(
          await readFile(path.join(uploads(), rows[0].filename)),
          {
            headers: {
              "Content-Type": "image/webp",
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      } catch (e) {
        if (e.code === "ENOENT") return fail("Фото не найдено", 404);
        throw e;
      }
    }
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p[0] !== "bikes") return fail("Не найдено", 404);
    if (p.length === 1) {
      if (method === "GET") {
        const { rows } = await db.query(
          "SELECT * FROM bikes WHERE owner_id=$1 ORDER BY created_at DESC",
          [user.id],
        );
        return json({
          bikes: await Promise.all(rows.map((b) => hydrate(db, b))),
        });
      }
      if (method === "POST") {
        const b = bikeInput.parse(await body(req));
        const id = await insertBike(db, user.id, b);
        return json({ id }, 201);
      }
    }
    if (!uuid.safeParse(p[1]).success) return fail("Велосипед не найден", 404);
    const bike = await ownedBike(db, p[1], user.id);
    if (!bike) return fail("Велосипед не найден", 404);
    if (p.length === 2) {
      if (method === "GET") return json({ bike: await hydrate(db, bike) });
      if (method === "PATCH") {
        const b = bikeInput.parse(await body(req));
        await db.query(
          "UPDATE bikes SET name=$1,brand=$2,model=$3,year=$4,category=$5,description=$6,color=$7,size=$8,weight=$9,updated_at=now() WHERE id=$10 AND owner_id=$11",
          [
            b.name,
            b.brand,
            b.model,
            b.year,
            b.category,
            b.description,
            b.color,
            b.size,
            b.weight,
            bike.id,
            user.id,
          ],
        );
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const { rows } = await db.query(
          "SELECT filename FROM photos WHERE bike_id=$1",
          [bike.id],
        );
        await db.query("DELETE FROM bikes WHERE id=$1 AND owner_id=$2", [
          bike.id,
          user.id,
        ]);
        await Promise.all(
          rows.map((p) =>
            unlink(path.join(uploads(), p.filename)).catch(() => {}),
          ),
        );
        return json({ ok: true });
      }
    }
    if (p[2] === "share" && method === "PATCH") {
      const b = await body(req);
      if (typeof b.is_public !== "boolean")
        return fail("Некорректная настройка");
      // Revocation rotates the token so an old URL stays revoked after republishing.
      await db.query(
        "UPDATE bikes SET is_public=$1,share_id=CASE WHEN $1 THEN share_id ELSE $2 END WHERE id=$3",
        [b.is_public, randomUUID(), bike.id],
      );
      return json({ ok: true });
    }
    if (p[2] === "components") {
      if (p.length === 3 && method === "POST") {
        const c = componentInput.parse(await body(req));
        await db.query(
          "INSERT INTO components(id,bike_id,section,category,name,notes,price) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            bike.id,
            c.section,
            c.category,
            c.name,
            c.notes,
            c.price,
          ],
        );
        return json({ ok: true }, 201);
      }
      if (p.length === 4 && uuid.safeParse(p[3]).success) {
        if (method === "DELETE") {
          await db.query("DELETE FROM components WHERE id=$1 AND bike_id=$2", [
            p[3],
            bike.id,
          ]);
          return json({ ok: true });
        }
        if (method === "PATCH") {
          const c = componentInput.parse(await body(req));
          await db.query(
            "UPDATE components SET section=$1,category=$2,name=$3,notes=$4,price=$5 WHERE id=$6 AND bike_id=$7",
            [c.section, c.category, c.name, c.notes, c.price, p[3], bike.id],
          );
          return json({ ok: true });
        }
      }
    }
    if (p[2] === "photos") {
      if (p.length === 3 && method === "POST") {
        // Stream a raw file instead of buffering an unbounded multipart body.
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(
            req.headers.get("content-type"),
          )
        )
          return fail("Поддерживаются JPEG, PNG и WebP");
        const reader = req.body?.getReader();
        if (!reader) return fail("Выберите фото");
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            return fail("Фото должно быть меньше 10 МБ", 413);
          }
          chunks.push(value);
        }
        let image;
        try {
          image = await preparePhoto(Buffer.concat(chunks));
        } catch {
          return fail("Не удалось прочитать изображение");
        }
        const id = randomUUID(),
          filename = id + ".webp";
        await mkdir(uploads(), { recursive: true });
        await writeFile(path.join(uploads(), filename), image);
        try {
          await transaction(async (client) => {
            await client.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
              bike.id,
            ]);
            const { rows } = await client.query(
              "SELECT count(*)::int AS n FROM photos WHERE bike_id=$1",
              [bike.id],
            );
            if (rows[0].n >= 12) throw new Error("PHOTO_LIMIT");
            await client.query(
              "INSERT INTO photos(id,bike_id,filename,is_cover) VALUES($1,$2,$3,$4)",
              [id, bike.id, filename, rows[0].n === 0],
            );
          });
        } catch (e) {
          await unlink(path.join(uploads(), filename)).catch(() => {});
          if (e.message === "PHOTO_LIMIT")
            return fail("Максимум 12 фотографий");
          throw e;
        }
        return json({ id }, 201);
      }
      if (
        p.length === 4 &&
        uuid.safeParse(p[3]).success &&
        ["DELETE", "PATCH"].includes(method)
      ) {
        let filename;
        await transaction(async (client) => {
          await client.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
            bike.id,
          ]);
          const { rows } = await client.query(
            "SELECT * FROM photos WHERE id=$1 AND bike_id=$2",
            [p[3], bike.id],
          );
          if (!rows[0]) return;
          if (method === "PATCH") {
            await client.query(
              "UPDATE photos SET is_cover=false WHERE bike_id=$1",
              [bike.id],
            );
            await client.query("UPDATE photos SET is_cover=true WHERE id=$1", [
              p[3],
            ]);
          } else {
            filename = rows[0].filename;
            await client.query("DELETE FROM photos WHERE id=$1", [p[3]]);
            if (rows[0].is_cover)
              await client.query(
                "UPDATE photos SET is_cover=true WHERE id=(SELECT id FROM photos WHERE bike_id=$1 ORDER BY created_at,id LIMIT 1)",
                [bike.id],
              );
          }
        });
        if (filename)
          await unlink(path.join(uploads(), filename)).catch(() => {});
        return json({ ok: true });
      }
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e.name === "ZodError")
      return fail(
        "Проверьте заполнение полей: " +
          e.issues.map((i) => i.path.join(".")).join(", "),
      );
    if (
      e instanceof SyntaxError ||
      ["EMPTY_BODY", "BODY_LIMIT"].includes(e.message)
    )
      return fail("Некорректный запрос");
    console.error("API error", e);
    return fail("Не удалось выполнить запрос. Попробуйте ещё раз.", 500);
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
