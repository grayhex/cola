"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { ClubBadgesDto, ClubBadgeDto } from "../../lib/club-contracts.ts";
import { socialApi } from "./social-primitives.tsx";
import styles from "./club-badges.module.css";
export function ClubBadge({ club }: { club: ClubBadgeDto }) {
  return (
    <Link href={club.href} className={styles.badge} title={club.name}>
      {club.logo ? (
        <Image unoptimized src={club.logo} width={40} height={40} alt="" />
      ) : (
        <span className={styles.monogram} aria-hidden="true">
          {Array.from(club.name).slice(0, 2).join("").toUpperCase()}
        </span>
      )}
      <span>{club.name}</span>
    </Link>
  );
}
export default function ClubBadges({
  ownerId,
  initial,
}: {
  ownerId: string;
  initial?: ClubBadgesDto;
}) {
  const [expanded, setExpanded] = useState(false),
    [more, setMore] = useState<ClubBadgeDto[]>([]),
    [data, setData] = useState(initial),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      running = false;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const current = await socialApi<ClubBadgesDto>(
          "clubs/badges/" + ownerId,
        );
        if (active) {
          setData(current);
          setMore([]);
          setPage(1);
        }
      } catch {
        if (active) {
          setData({ items: [], total: 0 });
          setMore([]);
        }
      } finally {
        running = false;
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ownerId]);
  if (!data?.total) return null;
  const items = [
    ...new Map([...data.items, ...more].map((c) => [c.id, c])).values(),
  ];
  return (
    <div className={styles.shelf} aria-label="Клубы участника">
      {(expanded ? items : items.slice(0, 2)).map((c) => (
        <ClubBadge key={c.id} club={c} />
      ))}
      {data.total > 2 && (
        <button
          className={"button secondary " + styles.expand}
          type="button"
          disabled={busy}
          onClick={async () => {
            if (expanded) {
              setExpanded(false);
              return;
            }
            setBusy(true);
            setError("");
            try {
              const result = await socialApi<ClubBadgesDto>(
                "clubs/badges/" + ownerId,
              );
              setData(result);
              setMore([]);
              setPage(1);
              setExpanded(true);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Не удалось загрузить клубы",
              );
            } finally {
              setBusy(false);
            }
          }}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? "Свернуть список клубов"
              : "Показать ещё клубы: " + (data.total - 2)
          }
        >
          {expanded ? "Свернуть" : "+" + (data.total - 2)}
        </button>
      )}
      {expanded && items.length < data.total && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await socialApi<ClubBadgesDto>(
                "clubs/badges/" + ownerId + "?page=" + (page + 1),
              );
              if (!result.items.length) {
                setExpanded(false);
                setPage(1);
                setMore([]);
                setData(
                  await socialApi<ClubBadgesDto>("clubs/badges/" + ownerId),
                );
              } else {
                setMore((v) => [...v, ...result.items]);
                setPage((v) => v + 1);
              }
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Не удалось загрузить клубы",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Ещё клубы
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
