import { NextResponse } from "next/server";
import { withPublicReferences } from "./public-response.js";
export async function json(data, status = 200) {
  const payload =
    status >= 200 && status < 300 ? await withPublicReferences(data) : data;
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export const fail = (error, status = 400) => json({ error }, status);
/** @param {Request} req
 * @param {number} limit */
export async function readBytes(req, limit) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Пустой запрос");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("Превышен допустимый размер запроса");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
/** @param {Request} req
 * @returns {Promise<unknown>} Validate with the endpoint schema before use. */
export async function readJson(req, limit = 1024 * 1024) {
  return JSON.parse((await readBytes(req, limit)).toString());
}
/** @param {Request} req */
export function sameOrigin(req) {
  return (
    req.headers.get("origin") ===
    (process.env.APP_ORIGIN || "http://localhost:3000")
  );
}
