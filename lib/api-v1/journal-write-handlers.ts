import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { CommunityError } from "../community-validation.ts";
import type { JournalRow } from "../database-rows.ts";
import type { Queryable } from "../db.ts";
import { db, transaction } from "../db.ts";
import { requireVerifiedEmail } from "../email-policy.ts";
import { preparePhoto } from "../images.ts";
import {
  deleteJournal,
  journalBikeLock,
  journalInput,
  journalPhotos,
  journalRow,
  saveJournal,
} from "../journal.ts";
import type { JournalInput } from "../journal.ts";
import { cleanupJournalPhotos, saveJournalPhoto } from "../journal-storage.ts";
import { QuotaError, limits } from "../limits.ts";
import { requireImageType, unreadable, within } from "./bike-photo-handlers.ts";
import { ApiError, detailsOf, notFound } from "./errors.ts";
import { idempotent, requiredKey } from "./idempotency.ts";
import { idOf } from "./journal-handlers.ts";
import { etagOfEntry, ownEntryVersion } from "./journal-version.ts";
import { toJournalEntry } from "./mappers.ts";
import { checkIfMatch, parseJsonBody, readBoundedBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import {
  journalPatchRequestSchema,
  journalRequestSchema,
  parseNoQuery,
} from "./schemas.ts";
import type { JournalPatchRequest } from "./schemas.ts";
import { limited, limitedIn, writer } from "./write.ts";

// Writing the journal through /api/v1 (#347, W3): an entry of one's own bicycle
// and its photos. The engines are the site's (`journalInput`, `saveJournal`,
// `deleteJournal`, `saveJournalPhoto`), so the lock order, the snapshot of the
// parts, the quotas and the publication rules are the same. This layer adds
// the conventions of #305: the credential's Origin rule, a body of its own,
// the shared budgets, versions (`ETag`/`If-Match`) and idempotent creation.

type EntryParams = { params: Promise<{ id: string }> };
type PhotoParams = { params: Promise<{ id: string; photoId: string }> };

/** An entry takes at most this much JSON: 20000 characters of text and the fields around them. */
const MAX_BODY = 100000;
const missingEntry = () => notFound("Запись не найдена.");

/** The engine's failures, in the API's envelope. */
async function throughJournal<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ZodError)
      throw new ApiError("invalid_request", "Проверьте поля запроса.", {
        details: detailsOf(error),
      });
    if (error instanceof QuotaError)
      throw new ApiError("conflict", error.message);
    if (error instanceof CommunityError) {
      if (error.status === 404) throw new ApiError("not_found", error.message);
      if (error.status === 409) throw new ApiError("conflict", error.message);
      throw new ApiError("invalid_request", error.message);
    }
    throw error;
  }
}

/** The entry as its owner reads it, and its version, read in `q`. */
async function entryResponse(q: Queryable, owner: string, id: string) {
  const version = await ownEntryVersion(q, id, owner);
  const row = await journalRow(q, id, owner, "id");
  if (!row || version === undefined) throw missingEntry();
  return {
    body: toJournalEntry(row, await journalPhotos(q, id), owner),
    etag: etagOfEntry(id, version),
  };
}

/** A stored entry together with its version, locked for the change that follows. */
async function lockEntry(q: Queryable, id: string, owner: string) {
  const found = await q.query<{ bike_id: string | null }>(
    "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
    [id, owner],
  );
  const bike = found.rows[0]?.bike_id;
  // An article has no bicycle and is not written here.
  if (!bike) throw missingEntry();
  // The site's order of locks: the owner, the bicycle, then the entry.
  await journalBikeLock(q, bike, owner);
  const { rows } = await q.query<
    Omit<JournalRow, "event_date"> & {
      version: string;
      event_day: string | null;
    }
  >(
    "SELECT *,updated_at::text AS version,event_date::text AS event_day FROM journal_entries WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [id, owner],
  );
  if (!rows[0]) throw missingEntry();
  return rows[0];
}

/** The stored entry with what the patch names changed, as the site's `journalInput`. */
function patchedEntry(
  row: Awaited<ReturnType<typeof lockEntry>>,
  patch: JournalPatchRequest,
): JournalInput {
  return journalInput.parse({
    bikeId: row.bike_id,
    kind: patch.kind ?? row.kind,
    title: patch.title ?? row.title,
    body: patch.body ?? row.body,
    status: patch.status ?? row.status,
    isPublic: patch.isPublic ?? row.is_public,
    eventDate: patch.eventDate !== undefined ? patch.eventDate : row.event_day,
    mileage: patch.mileage !== undefined ? patch.mileage : row.mileage,
    rideId: patch.rideId !== undefined ? patch.rideId : row.ride_id,
    installationResult:
      patch.installationResult !== undefined
        ? patch.installationResult
        : row.installation_result,
    componentIds: patch.componentIds ?? row.components.map((part) => part.id),
  });
}

/** Publishing for everyone needs a confirmed address, as on the site. */
function requireEmailToPublish(
  viewer: Parameters<typeof requireVerifiedEmail>[0],
  input: { status: string; isPublic: boolean },
) {
  if (input.status === "published" && input.isPublic)
    requireVerifiedEmail(viewer);
}

/** POST /api/v1/journal */
export function handleCreateJournalEntry(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    parseNoQuery(new URL(req.url));
    const request = await parseJsonBody(req, journalRequestSchema, MAX_BODY);
    const input = await throughJournal(async () => journalInput.parse(request));
    requireEmailToPublish(viewer, input);
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key: requiredKey(req.headers),
        body: request,
        required: true,
      },
      async (q) => {
        await limitedIn(q, "journal-write:" + viewer.id, limits.journalWrites);
        const saved = await throughJournal(() =>
          saveJournal(q, viewer.id, input),
        );
        const { body, etag } = await entryResponse(q, viewer.id, saved.id);
        return { status: 201, body, headers: { ETag: etag } };
      },
    );
    return ok(response.body, response.status, {
      ...response.headers,
      ...(replayed ? { "Idempotency-Replayed": "true" } : {}),
    });
  });
}

/** PATCH /api/v1/journal/{id} */
export function handlePatchJournalEntry(req: Request, { params }: EntryParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Запись не найдена.");
    parseNoQuery(new URL(req.url));
    const patch = await parseJsonBody(req, journalPatchRequestSchema, MAX_BODY);
    await limited("journal-write:" + viewer.id, limits.journalWrites);
    const { body, etag } = await transaction((q) =>
      throughJournal(async () => {
        const row = await lockEntry(q, id, viewer.id);
        // The version this edit applies to, under the entry's lock: a second
        // device that edited first makes this one 412, not a silent overwrite.
        checkIfMatch(req.headers, etagOfEntry(id, row.version));
        if (Object.keys(patch).length > 0) {
          const merged = patchedEntry(row, patch);
          requireEmailToPublish(viewer, merged);
          await saveJournal(q, viewer.id, merged, id);
        }
        return entryResponse(q, viewer.id, id);
      }),
    );
    return ok(body, 200, { ETag: etag });
  });
}

/** DELETE /api/v1/journal/{id} */
export function handleDeleteJournalEntry(
  req: Request,
  { params }: EntryParams,
) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Запись не найдена.");
    parseNoQuery(new URL(req.url));
    await limited("journal-write:" + viewer.id, limits.journalWrites);
    await transaction((q) =>
      throughJournal(() => deleteJournal(q, id, viewer.id)),
    );
    // The files of its photos go after the commit.
    await cleanupJournalPhotos(db);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** POST /api/v1/journal/{id}/photos */
export function handleUploadJournalPhoto(
  req: Request,
  { params }: EntryParams,
) {
  return safely(async () => {
    const viewer = await writer(req);
    const id = idOf((await params).id, "Запись не найдена.");
    parseNoQuery(new URL(req.url));
    // Everything that can be refused without the body is refused before it is read.
    const key = requiredKey(req.headers);
    requireImageType(req);
    const entry = (
      await db.query<{ status: string; is_public: boolean }>(
        "SELECT status,is_public FROM journal_entries WHERE id=$1 AND owner_id=$2",
        [id, viewer.id],
      )
    ).rows[0];
    if (!entry) throw missingEntry();
    // A photo of a published public entry is a public write.
    requireEmailToPublish(viewer, {
      status: entry.status,
      isPublic: entry.is_public,
    });
    const bytes = await readBoundedBody(req, limits.fileBytes);
    const prepared = await preparePhoto(bytes, { bikePhoto: false }).catch(
      unreadable,
    );
    const { response, replayed } = await idempotent(
      transaction,
      {
        userId: viewer.id,
        route: `POST ${new URL(req.url).pathname}`,
        key,
        // The digest stands for the file: the same bytes under one key are one
        // upload, other bytes under it are a conflict.
        body: { sha256: createHash("sha256").update(bytes).digest("hex") },
        required: true,
      },
      async (q) => {
        await limitedIn(q, "photo-upload:" + viewer.id, limits.photoUploads);
        const photo = await throughJournal(() =>
          saveJournalPhoto(
            within(q) as unknown as typeof transaction,
            id,
            viewer.id,
            prepared,
          ),
        );
        return { status: 201, body: photo };
      },
    );
    return ok(
      response.body,
      response.status,
      replayed ? { "Idempotency-Replayed": "true" } : {},
    );
  });
}

/** DELETE /api/v1/journal/{id}/photos/{photoId} */
export function handleDeleteJournalPhoto(
  req: Request,
  { params }: PhotoParams,
) {
  return safely(async () => {
    const viewer = await writer(req);
    const { id: rawId, photoId: rawPhoto } = await params;
    const id = idOf(rawId, "Запись не найдена.");
    const photoId = idOf(rawPhoto, "Фото не найдено.");
    parseNoQuery(new URL(req.url));
    // Taking a photo away is not writing text: it spends the budget of edits, not of entries.
    await limited("bike-write:" + viewer.id, limits.bikeWrites);
    await transaction((q) =>
      throughJournal(async () => {
        const found = await q.query<{ bike_id: string | null }>(
          "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
          [id, viewer.id],
        );
        if (!found.rows[0]) throw missingEntry();
        await journalBikeLock(q, found.rows[0].bike_id, viewer.id);
        // Gone already is as good as removed now: a repeat is 204 too.
        await q.query(
          "DELETE FROM journal_photos WHERE id=$1 AND entry_id=$2",
          [photoId, id],
        );
      }),
    );
    await cleanupJournalPhotos(db);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
