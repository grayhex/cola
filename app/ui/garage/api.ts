import type { ApiError } from "../../../lib/contracts.ts";
export default async function api<T = unknown>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api/" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  let b: T & Partial<ApiError>;
  try {
    b = await r.json();
  } catch {
    throw new Error("Сервер не ответил. Попробуйте ещё раз.");
  }
  if (!r.ok) {
    const error = Object.assign(
      new Error(b.error || "Не удалось выполнить запрос"),
      { status: r.status },
    );
    throw error;
  }
  return b;
}
