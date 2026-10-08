import {
  errorCode,
  errorConstraint,
  errorMessage,
} from "../../../lib/errors.ts";
import { ZodError } from "zod";
import {
  requireVerifiedEmail,
  EmailPolicyError,
} from "../../../lib/email-policy.ts";
import {
  classificationOf,
  categoryFilterLabels,
} from "../../../lib/bike-classification.ts";
import { classificationQueryInput } from "../../../lib/classification-validation.ts";
import {
  checkLegalAcceptance,
  recordLegalAcceptance,
  LegalError,
} from "../../../lib/legal-documents.ts";
import { traced, logError } from "../../../lib/observability.ts";
import { resolverProxy } from "../../../lib/resolver-proxy.ts";
import { allowAuth } from "../../../lib/auth-limits.ts";
import { limits, QuotaError } from "../../../lib/limits.ts";
import { savePhotos } from "../../../lib/photo-storage.ts";
import {
  showcase,
  decorateBike,
  visibleBike,
  vote,
} from "../../../lib/showcase.ts";
import { searchExperience, searchInput } from "../../../lib/search.ts";
import { validatePurposes } from "../../../lib/repository.ts";
import { CommunityError } from "../../../lib/community-validation.ts";
import {
  profileInput,
  registrationInput,
} from "../../../lib/social-validation.ts";
import { candidateBytes, importPhotos } from "../../../lib/photo-import.ts";
import {
  PhotoBackgroundError,
  applyPreview,
  cutOut,
  discardPreview,
  readPictureBody,
  readPreview,
  restoreOriginal,
  storePreview,
} from "../../../lib/photo-background.ts";
import { appVersion } from "../../../lib/version.js";
import { mailEnabled } from "../../../lib/mail.ts";
import { emailVerificationMail } from "../../../lib/mail-templates.ts";
import { accountLink, requestEmailVerification } from "../../../lib/account.ts";
import { sendAfterResponse } from "../../../lib/account-mail.ts";
import { z } from "zod";
import { wizardInput, createWizardBike } from "../../../lib/bike-wizard.ts";
import { reorderComponents } from "../../../lib/component-order.ts";
import { saveFactorySpecification } from "../../../lib/factory-import.ts";
import {
  bikeResolverClient,
  resolverQuery,
} from "../../../lib/bike-resolver-client.ts";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  isTooSmall,
  preparePhoto,
  prepareThumbnail,
  tooSmallMessage,
} from "../../../lib/images.ts";
import {
  mediaEtag,
  mediaResponse,
  mediaVariant,
  mediaWidth,
  notModified,
  notModifiedResponse,
  purgeMediaVariants,
} from "../../../lib/media-cache.ts";
import { getSite } from "../../../lib/site.ts";
import { db, transaction } from "../../../lib/db.ts";
import {
  currentUser,
  startSession,
  endSession,
  rateLimit,
} from "../../../lib/auth.ts";
import { hashPassword, verifyPassword } from "../../../lib/password.ts";
import {
  bikeInput,
  componentInput,
  credentials,
  uuid,
} from "../../../lib/validation.ts";
import { suggestUsername } from "../../../lib/usernames.ts";
import { photoTooLargeMessage } from "../../../lib/photo-upload.ts";
import { allocateUsername } from "../../../lib/username-allocation.ts";
import { ownedBike, insertBike } from "../../../lib/repository.ts";
import { mediaVary, mediaViewer } from "../../../lib/media-viewer.ts";
import {
  addComponentRow,
  changePhoto,
  componentRowOf,
  deleteComponentRow,
  ownBikeRows,
  removeBike,
  setBikeSharing,
  setGroupOrder,
  updateBikeRow,
  updateComponentRow,
} from "../../../lib/bike-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uploads = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "uploads");
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) =>
  json({ error: message }, status);

// One try to take a backdrop off costs a pass over the pixels: a budget per person.
async function backgroundBudget(userId: string) {
  if (!(await rateLimit("photo-background:" + userId, limits.photoBackgrounds)))
    throw new PhotoBackgroundError(
      429,
      "Слишком много попыток удалить фон. Попробуйте позже.",
      "busy",
      60,
    );
}

async function body(req: Request) {
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

async function handler(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
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
        await db.query<{ "?column?": number }>("SELECT 1");
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
        await db.query<{ "?column?": number }>("SELECT 1");
        database = true;
      } catch {
        /* Status reports unavailable dependencies without failing the other probe. */
      }
      try {
        const r = await fetch(
          new URL("/ready", process.env.BIKE_RESOLVER_URL),
          { signal: AbortSignal.timeout(2000), cache: "no-store" },
        );
        resolver = r.ok;
      } catch {
        /* An optional Resolver outage is represented by resolver=false. */
      }
      return json({ ok: database, database, resolver }, database ? 200 : 503);
    }
    if (
      p[0] === "auth" &&
      p.length === 2 &&
      ["login", "register"].includes(p[1]) &&
      method === "POST"
    ) {
      const raw = await body(req);
      const registration = p[1] === "register";
      const input = registration
        ? registrationInput.parse(raw)
        : credentials.parse(raw);
      // Global and per-account limits are DB-backed and do not trust proxy headers.
      if (!(await allowAuth(req, input.email, rateLimit)))
        return fail("Слишком много попыток. Попробуйте через 15 минут.", 429);
      if (p[1] === "register") {
        if (!(await getSite()).settings.registrationOpen)
          return fail("Регистрация временно закрыта", 403);
        if (!input.name) return fail("Введите имя");
        const id = randomUUID();
        const hash = await hashPassword(input.password);
        let username;
        // A derived username that lost a race to a concurrent sign-up is
        // allocated again; a username the person chose is reported back.
        for (let attempt = 1; !username; attempt++) {
          const candidate =
            ("username" in input ? input.username : undefined) ||
            (await allocateUsername(
              db,
              suggestUsername(input.name, input.email),
            ));
          try {
            await transaction(async (q) => {
              const accepted = await checkLegalAcceptance(q, raw);
              await q.query(
                "INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,$3,$4,$5)",
                [id, input.email, input.name, hash, candidate],
              );
              await recordLegalAcceptance(q, id, accepted);
            });
            username = candidate;
          } catch (e) {
            if (
              errorCode(e) === "23505" &&
              errorConstraint(e) === "users_username_ci"
            ) {
              if (!("username" in input && input.username) && attempt < 3)
                continue;
              return json(
                {
                  error: "Это имя пользователя уже занято. Выберите другое.",
                  code: "username_taken",
                },
                409,
              );
            }
            if (errorCode(e) === "23505")
              return fail(
                "Не удалось зарегистрироваться с этим адресом. Попробуйте войти.",
                409,
              );
            throw e;
          }
        }
        await startSession(id);
        // Confirmation is optional for using the site; the link is sent when mail works.
        if (mailEnabled()) {
          const verification = await requestEmailVerification(db, id);
          if (verification)
            sendAfterResponse({
              to: input.email,
              ...emailVerificationMail({
                name: input.name,
                link: accountLink("/verify-email", verification.token),
              }),
            });
        }
        return json(
          { user: { id, email: input.email, name: input.name, username } },
          201,
        );
      }
      const { rows } = await db.query<{
        id: string;
        email: string;
        name: string;
        password_hash: string;
        created_at: Date;
        role: string;
        blocked: boolean;
        preferences: unknown;
        username: string;
        bio: string;
        location: string;
        avatar_id: string | null;
        avatar_size_bytes: string;
        email_verified_at: Date;
        password_changed_at: Date;
        public_id: string;
        slug: string;
      }>("SELECT * FROM users WHERE email=$1", [input.email]);
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
      // The bike page loads the same DTO on the server (#74).
      const bike = await visibleBike(db, p[1], user?.id, await getSite());
      return bike
        ? json({ bike })
        : fail("Велосипед не найден или доступ закрыт", 404);
    }
    if (p[0] === "versions" && method === "GET") {
      let resolver = null;
      try {
        resolver = await bikeResolverClient.request("/version");
      } catch {
        /* A missing optional Resolver version stays null. */
      }
      return json({ app: appVersion, resolver });
    }
    if (p[0] === "me" && method === "GET") return json({ user });
    if (p[0] === "photos" && p.length === 2 && method === "GET") {
      if (!uuid.safeParse(p[1]).success) return fail("Фото не найдено", 404);
      const width = mediaWidth(new URL(req.url).searchParams.get("width"));
      if (width === undefined) return fail("Неверный размер фотографии");
      // A private bike's photo is its owner's: by cookie or by Bearer (#324).
      const who = await mediaViewer(req, user);
      if ("denied" in who) return who.denied;
      const { rows } = await db.query<{ filename: string }>(
        "SELECT p.filename FROM photos p JOIN bikes b ON b.id=p.bike_id JOIN users u ON u.id=b.owner_id WHERE p.id=$1 AND u.blocked=false AND (b.is_public=true OR b.owner_id=$2)",
        [p[1], who.viewer?.id || null],
      );
      if (!rows[0]) return fail("Фото не найдено", 404);
      // Access is checked above on every request, including revalidation.
      const etag = mediaEtag(p[1], width);
      if (notModified(req, etag))
        return notModifiedResponse(etag, { headers: mediaVary });
      try {
        const original = () =>
          readFile(
            /*turbopackIgnore: true*/ path.join(uploads(), rows[0].filename),
          );
        return mediaResponse(
          width ? await mediaVariant(p[1], width, original) : await original(),
          etag,
          { headers: mediaVary },
        );
      } catch (e) {
        if (errorCode(e) === "ENOENT") return fail("Фото не найдено", 404);
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
        await showcase(db, user?.id, {
          page,
          category,
          search,
          sort,
          classification: classificationQueryInput.parse(
            Object.fromEntries(url.searchParams),
          ),
        }),
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
      if (input.bike.is_public) requireVerifiedEmail(user);
      try {
        return json(
          await transaction((q) => createWizardBike(q, user.id, input)),
          201,
        );
      } catch (e) {
        if (errorMessage(e) === "PREVIEW_EXPIRED")
          return fail(
            "Результат поиска устарел. Вернитесь к поиску или сохраните без привязки к источнику.",
            409,
          );
        if (errorMessage(e) === "IDENTITY_CONFIRMATION_REQUIRED")
          return json(
            {
              error: "Подтвердите отличие модели или года источника",
              code: "IDENTITY_CONFIRMATION_REQUIRED",
            },
            409,
          );
        if (errorMessage(e) === "REQUEST_CONFLICT")
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
      const { rows } = await db.query<{ id: string }>(
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
    // Taking the backdrop off a photo (#370). The try, its picture and its
    // refusal belong to the person who asked: nobody else may read a preview.
    if (p[1] === "previews" && p.length === 2 && method === "POST") {
      await backgroundBudget(user.id);
      const source = await readPictureBody(req);
      const result = await cutOut(source, user.id, { signal: req.signal });
      // The page holds only a thumbnail of the file: «before» is this picture.
      const before = await prepareThumbnail(source, 1280);
      return json(
        {
          preview: await storePreview(
            db,
            user.id,
            { kind: "upload" },
            result,
            before,
          ),
        },
        201,
      );
    }
    if (p[1] === "previews" && p.length === 3 && uuid.safeParse(p[2]).success) {
      if (method === "GET") {
        const side =
          new URL(req.url).searchParams.get("side") === "before"
            ? "before"
            : "after";
        const bytes = await readPreview(db, user.id, p[2], side);
        if (!bytes) return fail("Предпросмотр не найден или устарел", 404);
        return new NextResponse(bytes, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (method === "DELETE") {
        await discardPreview(db, user.id, p[2]);
        return json({ ok: true });
      }
    }
    if (
      p[1] === "photo-candidates" &&
      p.length === 4 &&
      p[3] === "background" &&
      method === "POST"
    ) {
      await backgroundBudget(user.id);
      const id = uuid.parse(p[2]);
      let found;
      try {
        found = await candidateBytes(db, user.id, id);
      } catch (e) {
        throw new PhotoBackgroundError(
          errorMessage(e).startsWith("Поиск устарел") ? 404 : 502,
          errorMessage(e).startsWith("Поиск устарел")
            ? errorMessage(e)
            : "Не удалось получить фотографию. Повторите поиск.",
          errorMessage(e).startsWith("Поиск устарел") ? "gone" : "unavailable",
        );
      }
      // The import would refuse this photo with or without its backdrop: say
      // so before the person spends a try (and a preview) on it.
      if (await isTooSmall(found.bytes))
        throw new PhotoBackgroundError(422, tooSmallMessage, "too_small");
      const result = await cutOut(found.bytes, user.id, {
        signal: req.signal,
      });
      // The page holds only a thumbnail of a found photo: «before» is this one.
      const before = await prepareThumbnail(found.bytes, 1280);
      return json(
        {
          preview: await storePreview(
            db,
            user.id,
            { kind: "candidate", candidateId: id },
            result,
            before,
          ),
        },
        201,
      );
    }
    if (p.length === 1) {
      if (method === "GET") {
        const rows = await ownBikeRows(db, user.id);
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
        if (b.is_public) requireVerifiedEmail(user);
        const id = await transaction((q) => insertBike(q, user.id, b));
        return json({ id }, 201);
      }
    }
    if (!uuid.safeParse(p[1]).success) return fail("Велосипед не найден", 404);
    const bike = await ownedBike(db, p[1], user.id);
    if (!bike) return fail("Велосипед не найден", 404);
    // New data/photos on an already public legacy bike are public writes too.
    // Likes returned above; deletion and explicit privacy changes stay available.
    if (
      bike.is_public &&
      p.length >= 3 &&
      p[2] !== "share" &&
      ["POST", "PATCH", "PUT"].includes(method)
    )
      requireVerifiedEmail(user);
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
        const oldType =
          Object.hasOwn(input, "category") && input.category !== bike.category
            ? classificationOf({ category: input.category })
            : previous;
        const b = bikeInput.parse({
          ...bike,
          classification: {
            ...previous,
            category: oldType.category,
            subtype: oldType.subtype,
          },
          weight: bike.weight === null ? null : Number(bike.weight),
          price: bike.price === null ? null : Number(bike.price),
          ...input,
        });
        if (b.is_public) requireVerifiedEmail(user);
        await validatePurposes(db, b.purposes, bike.purposes);
        // Updating this row serializes with the FOR UPDATE guard in ride writes.
        await updateBikeRow(db, bike.id, user.id, b);
        return json({ ok: true });
      }
      if (method === "DELETE") {
        if (!(await removeBike(db, bike.id, user.id, uploads())))
          return fail(
            "У велосипеда есть покатушки. Сначала удалите их или перенесите на другой велосипед.",
            409,
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
        if (input.groups) await setGroupOrder(q, bike.id, input.groups);
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
      if (b.is_public) requireVerifiedEmail(user);
      // Revocation rotates the token so an old URL stays revoked after republishing.
      await setBikeSharing(db, bike.id, b.is_public);
      return json({ ok: true });
    }
    if (p[2] === "components") {
      if (p.length === 3 && method === "POST") {
        const c = componentInput.parse(await body(req));
        await transaction((q) => addComponentRow(q, bike.id, c));
        return json({ ok: true }, 201);
      }
      if (p.length === 4 && uuid.safeParse(p[3]).success) {
        if (method === "DELETE") {
          await deleteComponentRow(db, bike.id, p[3]);
          return json({ ok: true });
        }
        if (method === "PATCH") {
          const existing = await componentRowOf(db, bike.id, p[3]);
          if (!existing) return fail("Компонент не найден", 404);
          const c = componentInput.parse({
            ...existing,
            price: existing.price === null ? null : Number(existing.price),
            ...(await body(req)),
          });
          await updateComponentRow(db, bike.id, p[3], c);
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
      const { ids, cutouts } = z
        .object({
          ids: z
            .array(uuid)
            .min(1)
            .max(3)
            .refine((a) => new Set(a).size === a.length),
          // Found photo → the preview of it without its backdrop (#370).
          cutouts: z.record(uuid, uuid).optional(),
        })
        .refine((v) =>
          Object.keys(v.cutouts || {}).every((k) => v.ids.includes(k)),
        )
        .parse(await body(req));
      try {
        return json(
          await importPhotos(
            db,
            transaction,
            bike.id,
            user.id,
            ids,
            uploads(),
            cutouts,
          ),
          201,
        );
      } catch (e) {
        if (e instanceof QuotaError || e instanceof PhotoBackgroundError)
          throw e;
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
            req.headers.get("content-type") ?? "",
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
            return fail(photoTooLargeMessage(), 413);
          }
          chunks.push(value);
        }
        let image;
        try {
          image = await preparePhoto(Buffer.concat(chunks));
        } catch (e) {
          return fail(
            errorMessage(e)?.startsWith("Фото слишком")
              ? errorMessage(e)
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
        p.length === 5 &&
        p[4] === "background" &&
        uuid.safeParse(p[3]).success
      ) {
        if (method === "POST") {
          await backgroundBudget(user.id);
          const { rows } = await db.query<{
            filename: string;
            original_filename: string | null;
          }>(
            "SELECT filename,original_filename FROM photos WHERE id=$1 AND bike_id=$2",
            [p[3], bike.id],
          );
          if (!rows[0]) return fail("Фото не найдено", 404);
          if (rows[0].original_filename)
            throw new PhotoBackgroundError(
              409,
              "Фон уже удалён. Верните исходное фото, чтобы обработать его заново.",
              "already_removed",
            );
          let source: Buffer;
          try {
            source = await readFile(
              /*turbopackIgnore: true*/ path.join(uploads(), rows[0].filename),
            );
          } catch (e) {
            if (errorCode(e) === "ENOENT") return fail("Фото не найдено", 404);
            throw e;
          }
          const result = await cutOut(source, user.id, { signal: req.signal });
          return json(
            {
              preview: await storePreview(
                db,
                user.id,
                { kind: "photo", photoId: p[3] },
                result,
              ),
            },
            201,
          );
        }
        if (method === "PUT") {
          const { previewId } = z
            .object({ previewId: uuid })
            .parse(await body(req));
          return json(
            await applyPreview(transaction, {
              owner: user.id,
              bikeId: bike.id,
              photoId: p[3],
              previewId,
              directory: uploads(),
            }),
          );
        }
        if (method === "DELETE")
          return json(
            await restoreOriginal(transaction, {
              owner: user.id,
              bikeId: bike.id,
              photoId: p[3],
              directory: uploads(),
            }),
          );
      }
      if (
        p.length === 4 &&
        uuid.safeParse(p[3]).success &&
        ["DELETE", "PATCH"].includes(method)
      ) {
        const filenames = await changePhoto(
          transaction,
          bike.id,
          p[3],
          method === "PATCH" ? "cover" : "remove",
        );
        if (filenames.length) {
          await Promise.all(
            filenames.map((filename) =>
              unlink(
                /*turbopackIgnore: true*/ path.join(uploads(), filename),
              ).catch(() => {}),
            ),
          );
          await purgeMediaVariants([p[3]]);
        }
        return json({ ok: true });
      }
    }
    return fail("Не найдено", 404);
  } catch (e) {
    if (e instanceof EmailPolicyError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof LegalError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof CommunityError) return fail(e.message, e.status);
    if (e instanceof QuotaError) return fail(e.message, e.status);
    if (e instanceof PhotoBackgroundError)
      return NextResponse.json(
        { error: e.message, reason: e.reason },
        {
          status: e.status,
          headers: {
            "Cache-Control": "no-store",
            ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}),
          },
        },
      );
    if (e instanceof ZodError)
      return fail(
        "Проверьте заполнение полей: " +
          e.issues.map((i) => i.path.join(".")).join(", "),
      );
    if (
      e instanceof SyntaxError ||
      ["EMPTY_BODY", "BODY_LIMIT"].includes(errorMessage(e))
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
