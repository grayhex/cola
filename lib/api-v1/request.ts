import type { z } from "zod";
import { createHash } from "node:crypto";
import { ApiError, detailsOf } from "./errors.ts";

// The pure rules for reading a writing request of /api/v1 (#305): the body and the
// version an edit is checked against. They have
// no database and no session, so they are tested on their own. Who is writing,
// the Origin of a cookie and the budgets are write.ts.

/**
 * A JSON body of at most `limit` bytes that matches `schema`: 415 for another
 * content type, 413 for a body that is too large, 400 for broken or invalid
 * JSON. The body is never read past the limit.
 */
export async function parseJsonBody<T extends z.ZodType>(
  req: Request,
  schema: T,
  limit = 8192,
): Promise<z.infer<T>> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? ""))
    throw new ApiError(
      "unsupported_media_type",
      "Тело запроса должно быть application/json.",
    );
  const reader = req.body?.getReader();
  if (!reader)
    throw new ApiError("invalid_request", "Тело запроса не разобрано.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new ApiError(
        "payload_too_large",
        `Тело запроса больше ${limit} байт.`,
      );
    }
    chunks.push(value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("invalid_request", "Тело запроса не разобрано.");
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError("invalid_request", "Проверьте поля запроса.", {
      details: detailsOf(result.error),
    });
  return result.data;
}

/**
 * The ETag of a changeable object: a digest of its kind, id and the exact
 * `updated_at` text (microseconds). It changes with every edit and says nothing
 * about the content.
 */
export function etagOf(kind: string, id: string, updatedAt: string) {
  return (
    '"' +
    createHash("sha256")
      .update(`${kind}:${id}:${updatedAt}`)
      .digest("base64url")
      .slice(0, 27) +
    '"'
  );
}

/**
 * Optimistic locking with `If-Match` (RFC 9110): the edit applies only to the
 * version the client saw. `*` means "any existing"; a weak validator never
 * matches (strong comparison). No header when it is `required` is 428, a
 * version that is no longer current is 412: the client reads the object again
 * and repeats its edit on it.
 */
export function checkIfMatch(
  headers: Headers,
  current: string,
  { required = true } = {},
) {
  const header = headers.get("if-match");
  if (header === null) {
    if (required)
      throw new ApiError(
        "precondition_required",
        "Укажите заголовок If-Match с ETag объекта, который вы правите.",
      );
    return;
  }
  const wanted = header.split(",").map((part) => part.trim());
  if (wanted.includes("*") || wanted.includes(current)) return;
  throw new ApiError(
    "precondition_failed",
    "Объект изменился после того, как вы его прочитали. Прочитайте его снова.",
  );
}

/**
 * The raw body of a request of at most `limit` bytes (an upload): 413 as soon
 * as the declared length or the bytes read pass the limit, 400 for an empty
 * body. The body is never read past the limit.
 */
export async function readBoundedBody(
  req: Request,
  limit: number,
): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new ApiError(
      "payload_too_large",
      `Тело запроса больше ${limit} байт.`,
    );
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError("invalid_request", "Тело запроса пусто.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new ApiError(
        "payload_too_large",
        `Тело запроса больше ${limit} байт.`,
      );
    }
    chunks.push(value);
  }
  if (length === 0)
    throw new ApiError("invalid_request", "Тело запроса пусто.");
  return Buffer.concat(chunks);
}
