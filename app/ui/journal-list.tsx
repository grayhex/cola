"use client";
import type { JournalSaved } from "./content-types.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { BikeDto } from "../../lib/contracts.ts";
import type { JournalListDto } from "./content-types.ts";
import { useState, useEffect, useRef } from "react";
import { Plus, NotebookPen, Heart, X } from "./icons.tsx";
import { socialApi } from "./social-primitives.tsx";
import { PageControls } from "./community-controls.tsx";
import { journalKinds } from "../../lib/journal-kinds.ts";
import { publicPath } from "../../lib/public-urls.ts";
export default function JournalList({
  bike,
  owner = false,
  editable = false,
}: {
  bike: BikeDto;
  owner?: boolean;
  editable?: boolean;
}) {
  const [data, setData] = useState<JournalListDto | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [change, setChange] = useState<{ componentIds: string[] } | null>(null),
    [busy, setBusy] = useState(false);
  const previous = useRef<{ id: string; parts: BikeDto["components"] } | null>(
    null,
  );
  useEffect(() => {
    const state = { id: bike.id, parts: bike.components || [] };
    if (
      editable &&
      previous.current?.id === bike.id &&
      JSON.stringify(previous.current.parts) !== JSON.stringify(state.parts)
    ) {
      const old = new Map(
        previous.current.parts.map((p) => [p.id, JSON.stringify(p)]),
      );
      setChange({
        componentIds: state.parts
          .filter((p) => old.get(p.id) !== JSON.stringify(p))
          .map((p) => p.id)
          .slice(0, 50),
      });
    } else if (previous.current?.id !== bike.id) setChange(null);
    previous.current = state;
  }, [bike.id, bike.components, editable]);
  useEffect(() => {
    let active = true;
    setData(null);
    socialApi<JournalListDto>("journal?bikeId=" + bike.id + "&page=" + page)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [bike.id, page]);
  async function draft() {
    if (!change) return;
    setBusy(true);
    setError("");
    try {
      const e = await socialApi<JournalSaved>("journal", "POST", {
        bikeId: bike.id,
        kind: "build",
        title: "Изменения комплектации",
        body: "",
        status: "draft",
        isPublic: false,
        componentIds: change.componentIds,
      });
      location.assign(publicPath("journal", e) + "?edit=1");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bike-journal" id="journal">
      <div className="section-heading">
        <div>
          <h2>
            <NotebookPen size={20} /> Журнал велосипеда
          </h2>
          <p className="help">Изменения, опыт и истории владельца.</p>
        </div>
        {owner && (
          <a className="button secondary small" href={"/j/new?bike=" + bike.id}>
            <Plus size={16} />
            Написать
          </a>
        )}
      </div>
      {change && (
        <div className="journal-prompt">
          <span>Комплектация обновлена.</span>
          <button className="quiet" disabled={busy} onClick={draft}>
            Рассказать об изменении
          </button>
          <small>Создадим черновик, не публикацию.</small>
          <button
            className="quiet"
            onClick={() => setChange(null)}
            aria-label="Закрыть предложение"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Загружаем журнал…</p>}
      {data?.entries.map((e) => (
        <article className="journal-list-entry" key={e.id}>
          <div className="journal-entry-meta">
            <span>
              {
                Object.entries(journalKinds).find(
                  ([kind]) => kind === e.kind,
                )?.[1]
              }
            </span>
            <time>
              {e.eventDate || new Date(e.createdAt).toLocaleDateString("ru-RU")}
            </time>
            {e.status === "draft" ? (
              <span>Черновик</span>
            ) : !e.isPublic || !e.bikePublic ? (
              <span>Приватная запись</span>
            ) : null}
          </div>
          <h3>
            <a href={publicPath("journal", e)}>{e.title || "Без заголовка"}</a>
          </h3>
          <p>{e.excerpt ?? e.body}</p>
          <small>
            <Heart size={12} aria-label="Лайки" /> {e.likes} · Комментарии{" "}
            {e.comments}
          </small>
        </article>
      ))}
      {data && !data.entries.length && (
        <p className="help">История этого велосипеда ещё не началась.</p>
      )}
      {data && <PageControls {...data} onPage={setPage} />}
    </section>
  );
}
