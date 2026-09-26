export default async function api(url, method = "GET", data) {
  const r = await fetch("/api/" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  let b;
  try {
    b = await r.json();
  } catch {
    throw new Error("Сервер не ответил. Попробуйте ещё раз.");
  }
  if (!r.ok) {
    const error = new Error(b.error || "Не удалось выполнить запрос");
    error.status = r.status;
    throw error;
  }
  return b;
}
