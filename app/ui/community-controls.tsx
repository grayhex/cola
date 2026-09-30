"use client";
import type { ViewerDto, ReportInput } from "../../lib/contracts.ts";
type UiViewer = ViewerDto | null;
import { errorMessage } from "../../lib/errors.ts";

import { useState } from "react";
import { Flag } from "./icons.tsx";
import { socialApi } from "./social-primitives.tsx";
export function PageControls({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  return (
    (page > 1 || hasMore) && (
      <nav className="pager" aria-label="Страницы">
        <button
          className="button secondary small"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Назад
        </button>
        <span>{page}</span>
        <button
          className="button secondary small"
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          Далее
        </button>
      </nav>
    )
  );
}
export function ReportButton({
  entityType,
  targetId,
  user,
}: {
  entityType: ReportInput["entityType"];
  targetId: string;
  user: UiViewer;
}) {
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
              setError(errorMessage(e));
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
