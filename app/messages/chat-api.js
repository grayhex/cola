export async function chatApi(action, data, signal) {
  const response = await fetch("/api/chat/" + action, {
    method: data === undefined ? "GET" : "POST",
    cache: "no-store",
    signal,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Не удалось открыть сообщения");
  return result;
}
