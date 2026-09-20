"use client";
import { useState } from "react";
import { Heart, MessageCircle, Save } from "./icons.jsx";
import { socialApi } from "./social-primitives.jsx";
import { journalKinds } from "../../lib/journal-kinds.js";
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
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await socialApi(
              "journal/" + entry.id + "/save",
              saved ? "DELETE" : "PUT",
            );
            setSaved(r.saved);
            onChange?.(r.saved);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Save size={14} />
        {saved ? "Сохранено" : "Сохранить"}
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
  return (
    <article className="journal-card">
      {entry.photo && (
        <a href={"/j/" + entry.shareId} className="journal-card-photo">
          <img src={entry.photo} alt="Фотография записи" loading="lazy" />
        </a>
      )}
      <div className="journal-card-content">
        <div className="journal-entry-meta">
          <span>{journalKinds[kind]}</span>
          {entry.solutionId && <span>Решено</span>}
        </div>
        <h2>
          <a href={"/j/" + entry.shareId}>{entry.title}</a>
        </h2>
        <p className="journal-excerpt">{entry.body}</p>
        <a href={"/b/" + entry.bike.shareId}>{entry.bike.name}</a>
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
