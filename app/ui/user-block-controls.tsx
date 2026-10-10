"use client";
import { useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";
import type { UserSummary } from "../../lib/api-v1/schemas.ts";
import { useSite } from "./site-provider.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { profilePath } from "../../lib/public-urls.ts";
import { useConfirmation } from "./confirmation.tsx";

async function safetyApi<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch("/api/v1/" + path, {
    method,
    cache: "no-store",
  });
  const data: T & { error?: { message?: string } } = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "Не удалось выполнить запрос");
  return data;
}
export function BlockButton({
  userId,
  initialBlocked,
  onChange,
}: {
  userId: string;
  initialBlocked?: boolean;
  onChange?: (blocked: boolean) => void;
}) {
  const { viewer } = useSite();
  const [blocked, setBlocked] = useState<boolean | null>(
    initialBlocked ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ask, confirmation] = useConfirmation();
  const [attempt, setAttempt] = useState(0);
  const viewerId = viewer?.id;
  const changed = useEffectEvent((value: boolean) => onChange?.(value));
  useEffect(() => {
    if (!viewerId || viewerId === userId) return;
    let active = true;
    setError("");
    setBlocked(initialBlocked ?? null);
    safetyApi<{ relationship: { blockedByMe: boolean } }>("users/" + userId)
      .then((person) => {
        if (!active) return;
        setBlocked(person.relationship.blockedByMe);
        changed(person.relationship.blockedByMe);
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, [userId, viewerId, initialBlocked, attempt]);
  if (!viewer || viewer.id === userId) return null;
  return (
    <div>
      <button
        type="button"
        className="button secondary small"
        disabled={busy || blocked === null}
        onClick={async () => {
          if (busy || blocked === null) return;
          if (
            !blocked &&
            !(await ask(
              "Заблокировать человека? Подписки в обе стороны будут удалены, личные сообщения станут недоступны. Разблокировка не восстановит подписки.",
            ))
          )
            return;
          setBusy(true);
          setError("");
          try {
            const result = await safetyApi<{ blocked: boolean }>(
              "users/" + userId + "/block",
              blocked ? "DELETE" : "PUT",
            );
            setBlocked(result.blocked);
            onChange?.(result.blocked);
          } catch (failure) {
            setError(errorMessage(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        {blocked ? "Разблокировать" : "Заблокировать"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Повторить проверку
          </button>
        </p>
      )}
      {confirmation}
    </div>
  );
}
export default function BlockedPeople() {
  const [people, setPeople] = useState<UserSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  async function load(cursor: string | null = null) {
    setBusy(true);
    setError("");
    try {
      const page = await safetyApi<{
        items: UserSummary[];
        nextCursor: string | null;
      }>(
        "me/blocked?limit=20" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      setPeople((previous) =>
        cursor ? [...previous, ...page.items] : page.items,
      );
      setNext(page.nextCursor);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [revision]);
  return (
    <section className="social-panel" aria-labelledby="blocked-people-title">
      <h3 id="blocked-people-title">Заблокированные люди</h3>
      <p className="help">
        Блокировка прекращает личные сообщения и подписки в обе стороны. После
        разблокировки подписки не восстанавливаются.
      </p>
      {people.map((person) => (
        <div className="page-actions" key={person.id}>
          <Link href={profilePath(person.username)}>
            {person.name || person.username}
          </Link>
          <BlockButton
            userId={person.id}
            initialBlocked
            onChange={(blocked) => {
              if (!blocked) setRevision((n) => n + 1);
            }}
          />
        </div>
      ))}
      {!busy && !error && !people.length && <p>Вы никого не заблокировали.</p>}
      {busy && <p role="status">Загружаем…</p>}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button className="quiet" onClick={() => setRevision((n) => n + 1)}>
            Повторить
          </button>
        </p>
      )}
      {next && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load(next)}
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
