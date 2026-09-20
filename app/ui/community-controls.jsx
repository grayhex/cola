"use client";
import { useState } from "react";
import { Flag } from "./icons.jsx";
import { socialApi } from "./social-primitives.jsx";
export function PageControls({ page, hasMore, onPage }) {
  return (
    (page > 1 || hasMore) && (
      <nav className="feed-pages" aria-label="Страницы">
        <button
          className="quiet"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Назад
        </button>
        <span>{page}</span>
        <button
          className="quiet"
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          Далее
        </button>
      </nav>
    )
  );
}
export function ReportButton({ entityType, targetId, user }) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState("spam"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  if (!user) return null;
  return (
    <div className="report-control">
      <button
        className="quiet report-trigger"
        aria-label="Пожаловаться"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Flag size={12} />
        <span>Пожаловаться</span>
      </button>
      {open && (
        <form
          className="report-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await socialApi("community/reports", "POST", {
                entityType,
                targetId,
                reason,
              });
              setOpen(false);
              setMessage("Жалоба отправлена модератору");
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Причина
            <select
              aria-label="Причина жалобы"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {[
                ["spam", "Спам"],
                ["abuse", "Оскорбления"],
                ["inappropriate", "Недопустимый контент"],
                ["copyright", "Авторские права"],
                ["other", "Другое"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="button small" disabled={busy}>
            Отправить жалобу
          </button>
        </form>
      )}
      {message && <small role="status">{message}</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
