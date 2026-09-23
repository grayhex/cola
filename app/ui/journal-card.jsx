"use client";
import { useState } from "react";
import {
  Heart,
  MessageCircle,
  Bookmark,
  BookmarkCheck,
  CircleCheck,
  NotebookPen,
  Wrench,
  CircleHelp,
  Route,
  FileText,
} from "./icons.jsx";
import { socialApi } from "./social-primitives.jsx";
import { journalKinds } from "../../lib/journal-kinds.js";
const kindIcons = {
  story: NotebookPen,
  upgrade: Wrench,
  question: CircleHelp,
  ride: Route,
  review: FileText,
};
export function SaveEntry({ entry, onChange }) {
  const [saved, setSaved] = useState(entry.saved),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="quiet"
        aria-label={saved ? "Убрать из сохранённого" : "Сохранить запись"}
        aria-pressed={saved}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const before = saved;
          try {
            const r = await socialApi(
              "journal/" + entry.id + "/save",
              before ? "DELETE" : "PUT",
            );
            setSaved(r.saved);
            onChange?.(r.saved);
          } catch (e) {
            setSaved(before);
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        {busy ? "Сохраняем…" : saved ? "Сохранено" : "Сохранить"}
      </button>
      {error && (
        <span role="alert">
          {error} <a href="/account">Войти</a>
        </span>
      )}
    </>
  );
}
export default function JournalCard({ entry, onSaved }) {
  const kind = entry.entryKind || entry.kind;
  const KindIcon = kindIcons[kind] || NotebookPen;
  return (
    <article className="journal-card">
      {entry.photo && (
        <a href={"/j/" + entry.shareId} className="journal-card-photo">
          <img
            src={entry.photo + "?width=640"}
            alt="Фотография записи"
            loading="lazy"
            decoding="async"
          />
        </a>
      )}
      <div className="journal-card-content">
        <div className="journal-entry-meta">
          <span>
            <KindIcon size={16} /> {journalKinds[kind]}
          </span>
          {entry.solutionId && (
            <span>
              <CircleCheck size={16} /> Решено
            </span>
          )}
        </div>
        <h2>
          <a href={"/j/" + entry.shareId}>{entry.title}</a>
        </h2>
        <p className="journal-excerpt">{entry.excerpt ?? entry.body}</p>
        <a
          className="journal-card-bike"
          title={entry.bike.name}
          href={"/b/" + entry.bike.shareId}
        >
          {entry.bike.name}
        </a>
        <div className="journal-card-social">
          <a href={"/u/" + entry.author.username}>@{entry.author.username}</a>
          <span aria-label={"Лайки: " + entry.likes}>
            <Heart size={13} />
            {entry.likes}
          </span>
          <a
            href={"/j/" + entry.shareId + "#discussion"}
            aria-label={"Комментарии: " + entry.comments}
          >
            <MessageCircle size={13} />
            {entry.comments}
          </a>
          <SaveEntry entry={entry} onChange={onSaved} />
        </div>
      </div>
    </article>
  );
}
