"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { clubChatState } from "../../lib/club-chat.ts";
import type { JsonData } from "../../lib/contracts.ts";
import { useSite } from "./site-provider.tsx";
import { socialApi } from "./social-primitives.tsx";
import styles from "./clubs.module.css";
type State = JsonData<Awaited<ReturnType<typeof clubChatState>>>;
export default function ClubChat({
  club,
  settings = false,
}: {
  club: ClubDto;
  settings?: boolean;
}) {
  const { viewer } = useSite();
  if (
    !viewer ||
    club.hidden ||
    club.membership?.userId !== viewer.id ||
    club.membership.state !== "active"
  )
    return null;
  return (
    <Contents
      key={viewer.id + ":" + club.id + ":" + club.version}
      club={club}
      settings={settings}
    />
  );
}
function Contents({ club, settings }: { club: ClubDto; settings: boolean }) {
  const { viewer } = useSite(),
    router = useRouter(),
    [data, setData] = useState<State | null>(null),
    [attempt, setAttempt] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    socialApi<State>("clubs/" + club.id + "/chat")
      .then((d) => {
        if (active) {
          setData(d);
          setUrl(d.externalUrl || "");
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Чат недоступен");
      });
    return () => {
      active = false;
    };
  }, [club.id, attempt]);
  if (data?.viewerId !== viewer?.id && data) return null;
  async function open() {
    setBusy(true);
    setError("");
    try {
      const result = await socialApi<{ cid: string }>("chat/channels", "POST", {
        kind: "club",
        clubId: club.id,
      });
      router.push("/messages?channel=" + encodeURIComponent(result.cid));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось открыть чат. Попробуйте позже.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={settings ? "Настройки чата клуба" : "Чат клуба"}>
      {settings ? <h2>Чат клуба</h2> : null}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Проверяем доступ к чату…</p>}
      {error && (
        <button
          className="button secondary"
          onClick={() => setAttempt((v) => v + 1)}
        >
          Повторить проверку чата
        </button>
      )}
      {data && (
        <>
          <div className={styles.actions}>
            <button
              className="button"
              disabled={busy || !data.enabled || !data.verified}
              onClick={() => void open()}
            >
              {busy
                ? "Открываем…"
                : club.archived
                  ? "Читать чат клуба"
                  : "Чат клуба"}
            </button>
            {data.externalUrl && (
              <a
                className="button secondary"
                href={data.externalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Дополнительный чат
              </a>
            )}
          </div>
          {!data.enabled && (
            <p className="help">
              Внутренний чат временно недоступен. Лента и выезды продолжают
              работать.
            </p>
          )}
          {data.enabled && !data.verified && (
            <p className="help">
              Подтвердите почту в профиле, чтобы пользоваться внутренним чатом.
            </p>
          )}
          {data.enabled && data.status !== "ready" && (
            <p className="help">
              Подключаем чат. Если он не откроется, попробуйте позже.
            </p>
          )}
          {data.externalUrl && (
            <p className="help">Внешний чат: членство управляется отдельно.</p>
          )}
          {settings && data.canModerate && !club.archived && (
            <form
              className={styles.form}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await socialApi("clubs/" + club.id + "/chat", "PATCH", {
                    externalUrl: url.trim(),
                    version: club.version,
                  });
                  router.refresh();
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Не удалось сохранить ссылку",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                <span>Дополнительный чат · HTTPS-ссылка</span>
                <input
                  type="url"
                  value={url}
                  maxLength={2048}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p className="help">
                Ссылка доступна только действующим участникам. Основной чат
                клуба остаётся внутри ColaBike.
              </p>
              <button className="button" disabled={busy}>
                Сохранить ссылку чата
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
