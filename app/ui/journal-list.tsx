"use client";
import type { BikeDto } from "../../lib/contracts.ts";
import type { JournalListDto } from "./content-types.ts";
import { useState, useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  Cog,
  FileText,
  Heart,
  Plus,
  Wrench,
} from "./icons.tsx";
import { socialApi } from "./social-primitives.tsx";
import { PageControls } from "./community-controls.tsx";
import { journalKinds } from "../../lib/journal-kinds.ts";
import { publicPath } from "../../lib/public-urls.ts";
// One picture per kind of entry, as on the card's left edge (#291).
const kindIcons: Record<string, LucideIcon> = {
  build: Wrench,
  service: Cog,
  review: FileText,
  question: CircleHelp,
  story: BookOpen,
};
export default function JournalList({
  bike,
  owner = false,
  preview = false,
  onTotal,
}: {
  bike: BikeDto;
  owner?: boolean;
  preview?: boolean;
  // All the entries this reader may see, for the title of the bike's tab (#378).
  onTotal?: (total: number) => void;
}) {
  const [data, setData] = useState<JournalListDto | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
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
  useEffect(() => {
    if (typeof data?.total === "number") onTotal?.(data.total);
  }, [data, onTotal]);
  const entries =
    preview && !expanded ? data?.entries.slice(0, 3) : data?.entries;
  const hasMore = Boolean(
    data && preview && !expanded && (data.entries.length > 3 || data.hasMore),
  );
  return (
    <section
      className="bike-panel bike-journal"
      id="journal"
      aria-labelledby="journal-title"
    >
      <div className="panel-heading">
        <h2 id="journal-title">Записи владельца</h2>
        <div className="panel-heading-actions">
          {owner && (
            <a
              className="button secondary small"
              href={"/j/new?bike=" + bike.id}
            >
              <Plus size={16} aria-hidden="true" />
              Написать
            </a>
          )}
          {hasMore && (
            <button className="text-link" onClick={() => setExpanded(true)}>
              Все записи
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Загружаем записи…</p>}
      {!!entries?.length && (
        <div className="journal-cards">
          {entries.map((e) => {
            const Icon = kindIcons[e.kind] ?? FileText;
            return (
              <article className="journal-list-entry" key={e.id}>
                <span className="journal-kind-icon" aria-hidden="true">
                  <Icon size={30} strokeWidth={1.5} />
                </span>
                <div className="journal-entry-body">
                  <h3>
                    <a href={publicPath("journal", e)}>
                      {e.title || "Без заголовка"}
                    </a>
                  </h3>
                  <div className="journal-entry-meta">
                    <time>
                      {e.eventDate ||
                        new Date(e.createdAt).toLocaleDateString("ru-RU")}
                    </time>
                    <span>
                      {
                        Object.entries(journalKinds).find(
                          ([kind]) => kind === e.kind,
                        )?.[1]
                      }
                    </span>
                    {e.status === "draft" ? (
                      <span>Черновик</span>
                    ) : !e.isPublic || !e.bikePublic ? (
                      <span>Приватная запись</span>
                    ) : null}
                  </div>
                  <p>{e.excerpt ?? e.body}</p>
                  <small>
                    <Heart size={12} aria-label="Лайки" /> {e.likes} ·
                    Комментарии {e.comments}
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data && !data.entries.length && (
        <p className="help">История этого велосипеда ещё не началась.</p>
      )}
      {data && !(preview && !expanded) && (
        <PageControls {...data} onPage={setPage} />
      )}
    </section>
  );
}
