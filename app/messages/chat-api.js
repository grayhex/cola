export async function chatApi(action, data, signal) {
  let response;
  try {
    response = await fetch("/api/chat/" + action, {
      method: data === undefined ? "GET" : "POST",
      cache: "no-store",
      signal,
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      "Нет связи с сервером. Проверьте подключение и повторите.",
      { cause: error },
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Не удалось открыть сообщения");
  return result;
}
