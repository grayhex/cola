"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import type { JsonData } from "../../lib/contracts.ts";
import type { ownerBikeWeek } from "../../lib/bike-week.ts";
import { socialApi } from "./social-primitives.tsx";
import { errorMessage } from "../../lib/errors.ts";
import styles from "./bike-week.module.css";
type OwnerWeek = JsonData<Awaited<ReturnType<typeof ownerBikeWeek>>>;
export default function BikeWeekStory() {
  const [data, setData] = useState<OwnerWeek>(null),
    [text, setText] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    socialApi<OwnerWeek>("bike-week/me")
      .then((v) => {
        if (active) {
          setData(v);
          setText(v?.story || v?.text || "");
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(action: "publish" | "decline") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const v = await socialApi<OwnerWeek>(
        "bike-week/me",
        "PUT",
        action === "publish" ? { action, text } : { action },
      );
      setData(v);
      setMessage(
        action === "publish"
          ? "Текст опубликован для главной"
          : "Вы отказались от участия на этой неделе",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="social-panel">
      <h2>Велосипед недели</h2>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p role="status">Загрузка…</p>
      ) : data ? (
        <div className={styles.layout}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save("publish");
            }}
          >
            <p>
              Ваш {data.bike.name} выбран для главной. Расскажите о нём своими
              словами.
            </p>
            <label className="field">
              <span>История для главной</span>
              <textarea
                rows={7}
                maxLength={600}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                aria-describedby="spotlight-help"
              />
            </label>
            <p id="spotlight-help" className="help">
              {text.length}/600 · Этот текст хранится отдельно от описания
              велосипеда. До публикации показывается публичное описание.
            </p>
            <div className={styles.actions}>
              <button className="button" disabled={busy || !text.trim()}>
                Опубликовать текст
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => void save("decline")}
              >
                Отказаться от участия
              </button>
            </div>
          </form>
          <aside className={styles.preview} aria-label="Предпросмотр материала">
            <Image
              unoptimized
              src={data.cover.url}
              alt={data.bike.name}
              width={600}
              height={400}
              className={styles.photo}
            />
            <h3>{data.bike.name}</h3>
            <p className={styles.story}>{text || data.text}</p>
            <p className="help">
              {data.owner.name} · Неделя с {data.weekStart}
            </p>
          </aside>
        </div>
      ) : (
        !error && (
          <p className="help">
            Когда ваш велосипед станет велосипедом недели, здесь появится форма
            для главной, а вы получите уведомление.
          </p>
        )
      )}
    </section>
  );
}
