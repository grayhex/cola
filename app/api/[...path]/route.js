import { classificationOf, categoryFilterLabels } from "../../../lib/bike-classification.js";
import { classificationQueryInput } from "../../../lib/classification-validation.js";
import { checkLegalAcceptance, recordLegalAcceptance, LegalError } from "../../../lib/legal-documents.js";
import { traced, logError } from "../../../lib/observability.js";
import { resolverProxy } from "../../../lib/resolver-proxy.js";
import { allowAuth } from "../../../lib/auth-limits.js";
import { limits, QuotaError } from "../../../lib/limits.js";
import { savePhotos } from "../../../lib/photo-storage.js";
import { showcase, decorateBike, vote } from "../../../lib/showcase.js";
import { searchExperience, searchInput } from "../../../lib/search.js";
import { validatePurposes } from "../../../lib/repository.js";
import { CommunityError } from "../../../lib/community-validation.js";
import { profileInput } from "../../../lib/social-validation.js";
import { importPhotos } from "../../../lib/photo-import.js";
import { appVersion } from "../../../lib/version.js";
import { z } from "zod";
import { wizardInput, createWizardBike } from "../../../lib/bike-wizard.js";
import { reorderComponents } from "../../../lib/component-order.js";
import { saveFactorySpecification } from "../../../lib/factory-import.js";
import {
  bikeResolverClient,
  resolverQuery,
} from "../../../lib/bike-resolver-client.js";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { preparePhoto, prepareThumbnail } from "../../../lib/images.js";
import { getSite } from "../../../lib/site.js";
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
      return json({ ok: true });
    }
    if (p[0] === "ready" && p.length === 1 && method === "GET") {
      try {
        await db.query("SELECT 1");
        return json({ ok: true });
      } catch (e) {
        logError("database_unavailable", e);
        return json({ ok: false }, 503);
      }
    }
    if (p[0] === "status" && p.length === 1 && method === "GET") {
      let database = false,
        resolver = false;
      try {
        await db.query("SELECT 1");
        database = true;
      } catch {}
      try {
        const r = await fetch(
          new URL("/ready", process.env.BIKE_RESOLVER_URL),
          { signal: AbortSignal.timeout(2000), cache: "no-store" },
        );
        resolver = r.ok;
      } catch {}
      return json({ ok: database, database, resolver }, database ? 200 : 503);
    }
    if (
      p[0] === "auth" && p.length === 2 &&
      ["login", "register"].includes(p[1]) &&
      method === "POST"
    ) {
      const raw = await body(req);
      const input = credentials.parse(raw);
      // Global and per-account limits are DB-backed and do not trust proxy headers.
      if (!(await allowAuth(req, input.email, rateLimit)))
        return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
      if (p[1] === "register") {
        if (!(await getSite()).settings.registrationOpen)
          return fail("Регистрация временно закрыта", 403);
        if (!input.name) return fail("Введите имя");
        const id = randomUUID();
        const hash = await hashPassword(input.password);
        try {
          await transaction(async (q) => {
            const accepted = await checkLegalAcceptance(q, raw);
            await q.query(
              "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
              [id, input.email, input.name, hash],
            );
            await recordLegalAcceptance(q, id, accepted);
          });
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
      if (!user || !valid || user.blocked)
        return fail("Неверная почта или пароль либо аккаунт заблокирован", 401);
      await startSession(user.id);
      return json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    }
    if (p[0] === "auth" && p[1] === "logout" && method === "POST") {
      await endSession();
      return json({ ok: true });
    }
    const user = await currentUser();
    if (p[0] === "shared" && p.length === 2 && method === "GET") {
      if (!uuid.safeParse(p[1]).success)
        return fail("Велосипед не найден", 404);
      const rows = await db.query(
        "SELECT b.* FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.share_id=$1 AND b.is_public=true AND u.blocked=false",
        [p[1]],
      );
      const bike = rows.rows[0]
        ? await decorateBike(db, rows.rows[0], user?.id, await getSite(), true)
        : null;
      return bike
        ? json({ bike })
        : fail("Велосипед не найден или доступ закрыт", 404);
    }
    if (p[0] === "versions" && method === "GET") {
      let resolver = null;
      try {
        resolver = await bikeResolverClient.request("/version");
      } catch {}
      return json({ app: appVersion, resolver });
    }
    if (p[0] === "me" && method === "GET") return json({ user });
    if (p[0] === "photos" && p.length === 2 && method === "GET") {
      if (!uuid.safeParse(p[1]).success) return fail("Фото не найдено", 404);
      const { rows } = await db.query(
        "SELECT p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id JOIN users u ON u.id=b.owner_id WHERE p.id=$1 AND u.blocked=false AND (b.is_public=true OR b.owner_id=$2)",
        [p[1], user?.id || null],
      );
      if (!rows[0]) return fail("Фото не найдено", 404);
      try {
        const width = new URL(req.url).searchParams.get("width");
        if (width && !["160", "320"].includes(width))
          return fail("Неверный размер фотографии");
        const bytes = await readFile(path.join(uploads(), rows[0].filename));
        return new NextResponse(
          width ? await prepareThumbnail(bytes, Number(width)) : bytes,
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
    if (p[0] === "showcase" && p.length === 1 && method === "GET") {
      const url = new URL(req.url);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(url.searchParams.get("page") || 1);
      const category = z
        .string()
        .max(2000)
        .parse(url.searchParams.get("category") || "");
      const selectedCategories = category.split(",").filter(Boolean);
      if (selectedCategories.length) {
        const available = categoryFilterLabels;
        if (
          selectedCategories.length > 50 ||
          selectedCategories.some((key) => !Object.hasOwn(available, key))
        )
          return fail("Неверный тип велосипеда");
      }
      const search = z
        .string()
        .trim()
        .max(150)
        .parse(url.searchParams.get("q") || "");
      const sort = z
        .enum(["new", "popular", "records"])
        .parse(url.searchParams.get("sort") || "new");
      return json(
        await showcase(db, user?.id, { page, category, search, sort, classification: classificationQueryInput.parse(Object.fromEntries(url.searchParams)) }),
      );
    }
    if (p[0] === "search" && p.length === 1 && method === "GET")
      return json(
        await searchExperience(
          db,
          user?.id || null,
          searchInput.parse(Object.fromEntries(new URL(req.url).searchParams)),
        ),
      );
    if (!user) return fail("Войдите в аккаунт", 401);
    if (p[0] === "profile" && p.length === 1 && method === "PATCH") {
      const input = profileInput.parse(await body(req));
      await db.query("UPDATE users SET name=$1,preferences=$2 WHERE id=$3", [
        input.name,
        JSON.stringify(input.preferences),
        user.id,
      ]);
      return json({ user: { ...user, ...input } });
    }
    if (
      p[0] === "bikes" &&
      p.length === 3 &&
      p[2] === "like" &&
      ["PUT", "DELETE"].includes(method)
    ) {
      if (!uuid.safeParse(p[1]).success)
        return fail("Велосипед не найден", 404);
      if (!(await rateLimit("likes:" + user.id, 120)))
        return fail("Слишком много голосов. Попробуйте позже.", 429);
      const result = await transaction((q) =>
        vote(q, p[1], user.id, method === "PUT"),
      );
      return result.error ? fail(result.error, result.status) : json(result);
    }
    if (p[0] !== "bikes") return fail("Не найдено", 404);
    if (p[1] === "wizard" && p.length === 2 && method === "POST") {
      if (!(await rateLimit("bike-create:" + user.id, limits.bikeCreates)))
        return fail("Слишком много созданий велосипедов", 429);
      const input = wizardInput.parse(await body(req));
      try {
        return json(
          await transaction((q) => createWizardBike(q, user.id, input)),
          201,
        );
      } catch (e) {
        if (e.message === "PREVIEW_EXPIRED")
          return fail(
            "Результат поиска устарел. Вернитесь к поиску или сохраните без привязки к источнику.",
            409,
          );
        if (e.message === "IDENTITY_CONFIRMATION_REQUIRED")
          return json({ error: "Подтвердите отличие модели или года источника", code: "IDENTITY_CONFIRMATION_REQUIRED" }, 409);
        if (e.message === "REQUEST_CONFLICT")
          return fail("Конфликт запроса", 409);
        throw e;
      }
    }
    if (p.length === 2 && p[1] === "resolver-brands" && method === "GET") {
      try {
        return json(await bikeResolverClient.request("/v1/brands"));
      } catch {
        return json({ brands: [], autoResolve: false });
      }
    }
    if (p.length === 2 && p[1] === "resolve-stream" && method === "POST") {
      if (!(await rateLimit("resolver:" + user.id, 30)))
        return fail("Слишком много запросов поиска", 429);
      return resolverProxy(req, resolverQuery.parse(await body(req)), user.id);
    }
    if (p.length === 2 && p[1] === "resolve" && method === "POST") {
      if (!(await rateLimit("resolver:" + user.id, 30)))
        return fail("Слишком много запросов поиска", 429);
      const result = await bikeResolverClient.resolve(
        resolverQuery.parse(await body(req)),
      );
      if (result.status === "resolved") {
        const previewId = randomUUID();
        await db.query("DELETE FROM resolver_previews WHERE expires_at<now()");
        await db.query(
          "INSERT INTO resolver_previews(id,owner_id,response) VALUES($1,$2,$3)",
          [previewId, user.id, result],
        );
        return json({ ...result, previewId });
      }
      return json(result);
    }
    if (p[1] === "photo-search" && p.length === 2 && method === "POST") {
      if (!(await rateLimit("photo-search:" + user.id, 15)))
        return fail("Слишком много запросов", 429);
      const input = resolverQuery.parse(await body(req));
      const data = await bikeResolverClient.request(
        "/v1/photos/search",
        "POST",
        input,
      );
      await db.query(
        "DELETE FROM photo_search_candidates WHERE expires_at<now()",
      );
      for (const p of data.photos)
        await db.query(
          "INSERT INTO photo_search_candidates(id,owner_id) VALUES($1,$2)",
          [uuid.parse(p.id), user.id],
        );
      return json(data);
    }
    if (p[1] === "photo-candidates" && p.length === 3 && method === "GET") {
      const id = uuid.parse(p[2]);
      const { rows } = await db.query(
        "SELECT id FROM photo_search_candidates WHERE id=$1 AND owner_id=$2 AND expires_at>now()",
        [id, user.id],
      );
      if (!rows.length) return fail("Поиск устарел", 404);
      const photo = await bikeResolverClient.request("/v1/photos/" + id);
      const bytes = await prepareThumbnail(
        await preparePhoto(Buffer.from(photo.data, "base64"), {
          bikePhoto: false,
        }),
        160,
      );
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (p.length === 1) {
      if (method === "GET") {
        const { rows } = await db.query(
          "SELECT * FROM bikes WHERE owner_id=$1 ORDER BY created_at DESC",
          [user.id],
        );
        const site = await getSite();
        return json({
          bikes: await Promise.all(
            rows.map((b) => decorateBike(db, b, user.id, site)),
          ),
        });
      }
      if (method === "POST") {
        if (!(await rateLimit("bike-create:" + user.id, limits.bikeCreates)))
          return fail("Слишком много созданий велосипедов", 429);
        const b = bikeInput.parse(await body(req));
        const id = await transaction((q) => insertBike(q, user.id, b));
        return json({ id }, 201);
      }
    }
    if (!uuid.safeParse(p[1]).success) return fail("Велосипед не найден", 404);
    const bike = await ownedBike(db, p[1], user.id);
    if (!bike) return fail("Велосипед не найден", 404);
    if (p.length === 3 && p[2] === "factory-spec" && method === "POST") {
      if (!(await rateLimit("resolver:" + user.id, 30)))
        return fail("Слишком много запросов поиска", 429);
      const selection = await body(req);
      const input = resolverQuery.parse({
        brand: bike.brand,
        model: bike.model,
        trim: bike.trim || null,
        year: bike.year,
        ...(selection.sourceUrl ? { sourceUrl: selection.sourceUrl } : {}),
        ...(selection.candidateId
          ? { candidateId: selection.candidateId }
          : {}),
      });
      const result = await bikeResolverClient.resolve(input);
      if (result.status !== "resolved") return json(result);
      const saved = await transaction((q) =>
        saveFactorySpecification(
          q,
          bike,
          user.id,
          result,
          selection.initializeCurrent === true,
        ),
      );
      if (saved.conflict)
        return fail("Данные велосипеда изменились. Повторите поиск.", 409);
      return json({ ...result, importedCount: saved.importedCount });
    }
    if (p.length === 2) {
      if (method === "GET")
        return json({
          bike: await decorateBike(db, bike, user.id, await getSite()),
        });
      if (method === "PATCH") {
        const input = await body(req);
        const previous = classificationOf(bike);
        // A legacy PATCH must preserve independent features. Only an explicit
        // old category change resets the family/subtype; missing facets never do.
        const oldType = Object.hasOwn(input, "category") && input.category !== bike.category
          ? classificationOf({ category: input.category }) : previous;
        const b = bikeInput.parse({
          ...bike,
          classification: { ...previous, category: oldType.category, subtype: oldType.subtype },
          weight: bike.weight === null ? null : Number(bike.weight),
          price: bike.price === null ? null : Number(bike.price),
          ...input,
        });
        await validatePurposes(db, b.purposes, bike.purposes);
        await db.query(
          "UPDATE bikes SET name=$1,brand=$2,model=$3,year=$4,category=$5,description=$6,color=$7,size=$8,weight=$9,trim=$12,manufacturer_url=$13,price=$14,show_bike_price=$15,show_component_prices=$16,show_accessory_prices=$17,mileage=$18,is_public=$19,purposes=$20,classification=$21,factory_spec=CASE WHEN brand=$2 AND model=$3 AND year=$4 AND trim=$12 THEN factory_spec ELSE NULL END,updated_at=now() WHERE id=$10 AND owner_id=$11",
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
            b.trim,
            b.manufacturer_url,
            b.price,
            b.show_bike_price,
            b.show_component_prices,
            b.show_accessory_prices,
            b.mileage,
            b.is_public,
            b.purposes,
            JSON.stringify(b.classification),
          ],
        );
        return json({ ok: true });
      }
      if (method === "DELETE") {
        if (
          (
            await db.query("SELECT 1 FROM rides WHERE bike_id=$1 LIMIT 1", [
              bike.id,
            ])
          ).rowCount
        )
          return fail(
            "У велосипеда есть покатушки. Сначала удалите их или перенесите на другой велосипед.",
            409,
          );
        const { rows } = await db.query(
          "SELECT filename FROM photos WHERE bike_id=$1",
          [bike.id],
        );
        try {
          await db.query("DELETE FROM bikes WHERE id=$1 AND owner_id=$2", [
            bike.id,
            user.id,
          ]);
        } catch (e) {
          if (e.code === "23503")
            return fail(
              "У велосипеда есть покатушки. Сначала удалите их или перенесите на другой велосипед.",
              409,
            );
          throw e;
        }
        await Promise.all(
          rows.map((p) =>
            unlink(path.join(uploads(), p.filename)).catch(() => {}),
          ),
        );
        return json({ ok: true });
      }
    }
    if (p[2] === "order" && p.length === 3 && method === "PUT") {
      const input = z
        .object({
          components: z.array(uuid).max(2000).optional(),
          groups: z
            .array(z.string().regex(/^[a-z0-9_-]{1,50}$/))
            .max(31)
            .refine((a) => new Set(a).size === a.length)
            .optional(),
        })
        .strict()
        .parse(await body(req));
      const ok = await transaction(async (q) => {
        if (
          input.components &&
          !(await reorderComponents(q, bike.id, input.components))
        )
          return false;
        if (input.groups)
          await q.query("UPDATE bikes SET group_order=$1 WHERE id=$2", [
            JSON.stringify(input.groups),
            bike.id,
          ]);
        return true;
      });
      return ok
        ? json({ ok: true })
        : fail("Список компонентов изменился. Обновите страницу.", 409);
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
        await transaction(async (q) => {
          await q.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [
            bike.id,
          ]);
          await q.query(
            "INSERT INTO components(id,bike_id,section,category,name,notes,price,url,group_id,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(sort_order),-1)+1 FROM components WHERE bike_id=$2))",
            [
              randomUUID(),
              bike.id,
              c.section,
              c.category,
              c.name,
              c.notes,
              c.price,
              c.url,
              c.group_id,
            ],
          );
        });
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
          const existing = await db.query(
            "SELECT * FROM components WHERE id=$1 AND bike_id=$2",
            [p[3], bike.id],
          );
          if (!existing.rows[0]) return fail("Компонент не найден", 404);
          const c = componentInput.parse({
            ...existing.rows[0],
            price:
              existing.rows[0].price === null
                ? null
                : Number(existing.rows[0].price),
            ...(await body(req)),
          });
          await db.query(
            "UPDATE components SET section=$1,category=$2,name=$3,notes=$4,price=$5,url=$8,group_id=$9 WHERE id=$6 AND bike_id=$7",
            [
              c.section,
              c.category,
              c.name,
              c.notes,
              c.price,
              p[3],
              bike.id,
              c.url,
              c.group_id,
            ],
          );
          return json({ ok: true });
        }
      }
    }
    if (
      p[2] === "photos" &&
      p[3] === "import" &&
      p.length === 4 &&
      method === "POST"
    ) {
      if (!(await rateLimit("photo-upload:" + user.id, limits.photoUploads)))
        return fail("Слишком много запросов", 429);
      const { ids } = z
        .object({
          ids: z
            .array(uuid)
            .min(1)
            .max(3)
            .refine((a) => new Set(a).size === a.length),
        })
        .parse(await body(req));
      try {
        return json(
          await importPhotos(db, transaction, bike.id, user.id, ids, uploads()),
          201,
        );
      } catch (e) {
        if (e instanceof QuotaError) throw e;
        logError("photo_import_failed", e);
        return fail("Не удалось импортировать фотографию. Повторите поиск.");
      }
    }
    if (p[2] === "photos") {
      if (p.length === 3 && method === "POST") {
        if (!(await rateLimit("photo-upload:" + user.id, limits.photoUploads)))
          return fail("Слишком много загрузок фотографий", 429);
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
          if (size > limits.fileBytes) {
            await reader.cancel();
            return fail("Фото должно быть меньше 10 МБ", 413);
          }
          chunks.push(value);
        }
        let image;
        try {
          image = await preparePhoto(Buffer.concat(chunks));
        } catch (e) {
          return fail(
            e.message?.startsWith("Фото слишком")
              ? e.message
              : "Не удалось прочитать изображение",
          );
        }
        const id = randomUUID(),
          filename = id + ".webp";
        await savePhotos(
          transaction,
          user.id,
          bike.id,
          [{ id, filename, bytes: image }],
          uploads(),
        );
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
    if (e instanceof LegalError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e instanceof QuotaError) return fail(e.message, e.status);
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
    logError("api_error", e);
    return fail("Не удалось выполнить запрос. Попробуйте ещё раз.", 500);
  }
}
const route = traced(handler);
export {
  route as GET,
  route as POST,
  route as PUT,
  route as PATCH,
  route as DELETE,
};
