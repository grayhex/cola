"use client";
export default function Error({ reset }) {
  return (
    <main className="empty">
      <h1>Не удалось открыть страницу</h1>
      <button onClick={reset}>Попробовать снова</button>
    </main>
  );
}
