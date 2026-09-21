"use client";
import { RefreshCw } from "./ui/icons.jsx";
export default function Error({ reset }) {
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
