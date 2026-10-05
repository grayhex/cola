import { createHash } from "node:crypto";
import type { Queryable } from "../db.ts";
import { ApiError } from "./errors.ts";

// Idempotent creation for /api/v1 (#305). A client that lost the answer to a
// POST repeats it with the same `Idempotency-Key` and receives the first answer
// instead of a second object. The key and the object are written in one
// transaction: two simultaneous requests with one key meet on the primary key,
// the second waits for the first and then replays its answer, and a request
// that failed leaves no key, so repeating it simply runs again.

export const IDEMPOTENCY_DAYS = 1;
/** Expired rows of anyone removed by one keyed request at most. */
const CLEANUP_BATCH = 200;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdempotentResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
type Transaction = <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;

/** JSON with sorted keys, so the same request body always has one digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, inner]) => inner !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => JSON.stringify(key) + ":" + canonical(inner))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

/** The key of a request: a UUID, or null when the header is absent. */
export function idempotencyKey(headers: Headers): string | null {
  const key = headers.get("idempotency-key");
  if (key === null) return null;
  if (!uuidPattern.test(key.trim()))
    throw new ApiError("invalid_request", "Idempotency-Key должен быть UUID.", {
      details: [{ path: "Idempotency-Key", message: "Ожидается UUID." }],
    });
  return key.trim().toLowerCase();
}

/**
 * The key of a request that cannot be made without one: the same 400 that
 * `idempotent` gives, asked before the body is read.
 */
export function requiredKey(headers: Headers): string {
  const key = idempotencyKey(headers);
  if (key === null)
    throw new ApiError(
      "invalid_request",
      "Для этого запроса нужен заголовок Idempotency-Key (UUID).",
      {
        details: [
          { path: "Idempotency-Key", message: "Заголовок обязателен." },
        ],
      },
    );
  return key;
}

/**
 * Runs `run` once per `(person, request, key)` within a day.
 *
 * - no key: `run` just runs (or 400 when `required`);
 * - a new key: `run` and the stored answer commit together;
 * - a known key and the same body: the stored answer, `replayed: true`;
 * - a known key and another body: 409 `conflict`.
 *
 * `route` is the method and path of the request, so one key on another object
 * is another request. `run` throws for a failure; only an answer is stored.
 */
export async function idempotent(
  transaction: Transaction,
  options: {
    userId: string;
    route: string;
    key: string | null;
    body: unknown;
    required?: boolean;
  },
  run: (q: Queryable) => Promise<IdempotentResponse>,
): Promise<{ response: IdempotentResponse; replayed: boolean }> {
  const { userId, route, key, body } = options;
  if (key === null) {
    if (options.required)
      throw new ApiError(
        "invalid_request",
        "Для этого запроса нужен заголовок Idempotency-Key (UUID).",
        {
          details: [
            { path: "Idempotency-Key", message: "Заголовок обязателен." },
          ],
        },
      );
    return { response: await transaction(run), replayed: false };
  }
  const hash = createHash("sha256").update(canonical(body)).digest("hex");
  return transaction(async (q) => {
    // An expired key is forgotten here, before it can be matched; and a bounded
    // batch of anyone's expired rows goes with it, so rows of people who never
    // send another keyed request do not pile up. SKIP LOCKED: cleaning never
    // waits for a request that is still running.
    await q.query(
      `DELETE FROM api_idempotency WHERE user_id=$1 AND created_at<now()-make_interval(days=>${IDEMPOTENCY_DAYS})`,
      [userId],
    );
    await q.query(
      `DELETE FROM api_idempotency WHERE (user_id,route,key) IN (
         SELECT user_id,route,key FROM api_idempotency
         WHERE created_at<now()-make_interval(days=>${IDEMPOTENCY_DAYS})
         ORDER BY created_at LIMIT ${CLEANUP_BATCH} FOR UPDATE SKIP LOCKED)`,
    );
    const claimed = await q.query(
      `INSERT INTO api_idempotency(user_id,route,key,request_hash,status,response)
       VALUES($1,$2,$3,$4,200,'null'::jsonb) ON CONFLICT DO NOTHING RETURNING key`,
      [userId, route, key, hash],
    );
    if (!claimed.rows.length) {
      const stored = (
        await q.query<{
          request_hash: string;
          status: number;
          response: unknown;
          headers: Record<string, string>;
        }>(
          "SELECT request_hash,status,response,headers FROM api_idempotency WHERE user_id=$1 AND route=$2 AND key=$3",
          [userId, route, key],
        )
      ).rows[0];
      if (stored.request_hash !== hash)
        throw new ApiError(
          "conflict",
          "Этот Idempotency-Key уже использован с другим телом запроса.",
        );
      return {
        response: {
          status: stored.status,
          body: stored.response,
          headers: stored.headers,
        },
        replayed: true,
      };
    }
    const response = await run(q);
    await q.query(
      "UPDATE api_idempotency SET status=$4,response=$5,headers=$6 WHERE user_id=$1 AND route=$2 AND key=$3",
      [
        userId,
        route,
        key,
        response.status,
        JSON.stringify(response.body ?? null),
        JSON.stringify(response.headers ?? {}),
      ],
    );
    return { response, replayed: false };
  });
}
