import { NextResponse } from "next/server";
export const json = (data, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (error, status = 400) => json({ error }, status);
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
export async function readJson(req, limit = 1024 * 1024) {
  return JSON.parse((await readBytes(req, limit)).toString());
}
export function sameOrigin(req) {
  return (
    req.headers.get("origin") ===
    (process.env.APP_ORIGIN || "http://localhost:3000")
  );
}
