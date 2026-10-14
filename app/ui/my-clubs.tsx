"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClubBadgeDto, ClubSummaryDto } from "../../lib/club-contracts.ts";
import { socialApi } from "./social-primitives.tsx";
import ClubCard from "./club-card.tsx";
import { ClubBadge } from "./club-badges.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./clubs.module.css";
interface Preferences {
  clubs: (ClubBadgeDto & { visible: boolean })[];
}
export default function MyClubs() {
  const { viewer } = useSite();
  return viewer ? <Contents key={viewer.id} /> : null;
}
function Contents() {
  const [clubs, setClubs] = useState<ClubSummaryDto[]>([]),
    [preferences, setPreferences] = useState<Preferences | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [archived, setArchived] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    socialApi<{ clubs: ClubSummaryDto[]; hasMore: boolean }>(
      "clubs?own=1&page=" + page + (archived ? "&archived=1" : ""),
    )
      .then((r) => {
        if (active) {
          setClubs(r.clubs);
          setHasMore(r.hasMore);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить клубы",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, archived]);
  useEffect(() => {
    let active = true;
    socialApi<Preferences>("clubs/badge-preferences")
      .then((r) => {
        if (active) setPreferences(r);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить бейджи",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const update = (
    index: number,
    change: (row: Preferences["clubs"][number]) => Preferences["clubs"][number],
  ) =>
    setPreferences(
      (p) =>
        p && { clubs: p.clubs.map((c, i) => (i === index ? change(c) : c)) },
    );
  const move = (index: number, delta: number) =>
    setPreferences((p) => {
      if (!p || index + delta < 0 || index + delta >= p.clubs.length) return p;
      const next = [...p.clubs];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return { clubs: next };
    });
  return (
    <section>
      <h2>Мои клубы</h2>
      <div className={styles.actions}>
        <Link className="button" href="/clubs/new">
          Создать клуб
        </Link>
        <Link className="button secondary" href="/clubs">
          Все клубы
        </Link>
      </div>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => {
            setArchived(e.target.checked);
            setPage(1);
          }}
        />
        Показать архивные клубы
      </label>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Загружаем клубы…</p>
      ) : (
        <div className={styles.posts}>
          {clubs.map((c) => (
            <ClubCard key={c.id} club={c} />
          ))}
        </div>
      )}
      {!loading && !clubs.length && (
        <p>Вы пока не состоите в клубах и не отправляли заявок.</p>
      )}
      <div className={styles.actions}>
        {page > 1 && (
          <button
            className="button secondary"
            onClick={() => setPage((v) => v - 1)}
          >
            Назад
          </button>
        )}
        {hasMore && (
          <button
            className="button secondary"
            onClick={() => setPage((v) => v + 1)}
          >
            Дальше
          </button>
        )}
      </div>
      <h2>Бейджи в профиле и на велосипедах</h2>
      <p>
        Первый клуб — основной визуальный бейдж. Настройки общие для всех ваших
        велосипедов. Скрытие бейджа не скрывает ваше имя в открытом составе и
        публичных постах.
      </p>
      {preferences && (
        <div aria-label="Предпросмотр бейджей" className={styles.previewShelf}>
          {preferences.clubs
            .filter((c) => c.visible)
            .slice(0, 2)
            .map((c) => (
              <ClubBadge key={c.id} club={c} />
            ))}
          {preferences.clubs.filter((c) => c.visible).length > 2 && (
            <span>
              +{preferences.clubs.filter((c) => c.visible).length - 2}
            </span>
          )}
        </div>
      )}
      {preferences?.clubs.map((c, i) => (
        <div className={styles.badgeSettings} key={c.id}>
          <ClubBadge club={c} />
          <div className={styles.actions}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={c.visible}
                disabled={busy}
                onChange={(e) =>
                  update(i, (row) => ({ ...row, visible: e.target.checked }))
                }
              />
              Показывать бейдж
            </label>
            <button
              className="button secondary"
              aria-label={"Поднять " + c.name}
              disabled={busy || i === 0}
              onClick={() => move(i, -1)}
            >
              Выше
            </button>
            <button
              className="button secondary"
              aria-label={"Опустить " + c.name}
              disabled={busy || i === preferences.clubs.length - 1}
              onClick={() => move(i, 1)}
            >
              Ниже
            </button>
          </div>
        </div>
      ))}
      {preferences && !preferences.clubs.length && (
        <p>Бейдж появится после вступления в действующий клуб.</p>
      )}
      {!!preferences?.clubs.length && (
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setPreferences(
                await socialApi<Preferences>(
                  "clubs/badge-preferences",
                  "PATCH",
                  {
                    clubs: preferences.clubs.map((c) => ({
                      id: c.id,
                      visible: c.visible,
                    })),
                  },
                ),
              );
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Не удалось сохранить бейджи",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Сохраняем…" : "Сохранить бейджи"}
        </button>
      )}
    </section>
  );
}
