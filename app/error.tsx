"use client";
import { useEffect } from "react";
import { RefreshCw } from "./ui/icons.tsx";
import { reportClientError } from "./ui/error-reporting.ts";
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);
  return (
    <main className="empty">
      <h1>Не удалось открыть страницу</h1>
      <p>
        Попробуйте ещё раз. Введённые ранее данные не отправляются повторно.
      </p>
      <button className="button secondary" onClick={reset}>
        <RefreshCw size={16} />
        Попробовать снова
      </button>
    </main>
  );
}
