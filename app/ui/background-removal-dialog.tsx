"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { PhotoPreview } from "../../lib/contracts.ts";
import { X } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./background-removal.module.css";

// Taking the backdrop off a photo (#370): the window of the bike page and of
// the wizard. It says what the method is for, makes the try, shows the picture
// before and after at one scale on a backdrop that shows transparency, and
// lets the owner take the result or keep the photo as it is. Closing,
// cancelling and every failure leave the photo untouched; a late answer of a
// try that was cancelled or replaced is never shown, and its preview is let go.
export type BackgroundSource =
  // A photo of the bike, saved: the server holds the file.
  | { kind: "photo"; bikeId: string; photoId: string; beforeUrl: string }
  // A photo the search offered, which the wizard has not imported yet.
  | { kind: "candidate"; candidateId: string }
  // A file chosen in the wizard, which the server has not seen yet.
  | { kind: "upload"; file: File; beforeUrl: string };
/** What the owner is shown, and takes: the preview and the picture as it was. */
export interface BackgroundResult {
  preview: PhotoPreview;
  beforeUrl: string;
}

// Every try, and every way of dropping one, takes a new number: an answer is
// shown only while its number is the current one.
let serial = 0;
// The server gives a try twenty seconds; the rest is the wire.
const waitMs = 40_000;
const backdrops = ["checker", "light", "dark"] as const;
type Backdrop = (typeof backdrops)[number];
type Phase =
  | { name: "intro" }
  | { name: "working" }
  | { name: "result" | "applying"; result: BackgroundResult }
  | { name: "error"; message: string; retry: boolean };
interface Answer {
  error?: unknown;
  reason?: unknown;
  preview?: PhotoPreview;
}

function ask(source: BackgroundSource, signal: AbortSignal) {
  if (source.kind === "photo")
    return fetch(
      `/api/bikes/${source.bikeId}/photos/${source.photoId}/background`,
      { method: "POST", signal },
    );
  if (source.kind === "candidate")
    return fetch(
      `/api/bikes/photo-candidates/${source.candidateId}/background`,
      { method: "POST", signal },
    );
  return fetch("/api/bikes/previews", {
    method: "POST",
    headers: { "Content-Type": source.file.type },
    body: source.file,
    signal,
  });
}
const discard = (id: string) =>
  void fetch(`/api/bikes/previews/${id}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => {});

export default function BackgroundRemovalDialog({
  source,
  apply,
  onClose,
}: {
  source: BackgroundSource;
  /**
   * The owner took the result. Throwing keeps the window open with the
   * message; returning closes it.
   */
  apply: (result: BackgroundResult) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useSite();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    start = useRef<HTMLButtonElement>(null),
    accept = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "intro" }),
    [problem, setProblem] = useState(""),
    [backdrop, setBackdrop] = useState<Backdrop>("checker");
  // `attempt` names the try whose answer may still be shown; `held` is the
  // preview nobody has taken yet, which is let go when the window goes.
  const attempt = useRef(0),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true),
    spending = useRef(false),
    held = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    const element = dialog.current!,
      opener = document.activeElement;
    element.showModal();
    start.current?.focus();
    return () => {
      alive.current = false;
      attempt.current = ++serial;
      controller.current?.abort();
      if (held.current) discard(held.current);
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  // The result takes the focus: the person has just waited for it.
  const showing = phase.name === "result";
  useEffect(() => {
    if (showing) accept.current?.focus();
  }, [showing]);

  const close = () => {
    attempt.current = ++serial;
    controller.current?.abort();
    onClose();
  };

  async function begin() {
    const mine = (attempt.current = ++serial);
    setProblem("");
    setPhase({ name: "working" });
    const own = new AbortController();
    controller.current = own;
    let tooLong = false;
    const timer = setTimeout(() => {
      tooLong = true;
      own.abort();
    }, waitMs);
    try {
      const response = await ask(source, own.signal);
      const answer: Answer | null = await response.json().catch(() => null);
      if (mine !== attempt.current || !alive.current) {
        // Cancelled, closed or replaced while it ran: never shown, never kept.
        if (response.ok && answer?.preview) discard(answer.preview.id);
        return;
      }
      const preview = answer?.preview;
      if (!response.ok || !preview) {
        const words =
          typeof answer?.error === "string" && answer.error
            ? answer.error
            : t("Не удалось обработать фото. Оно не изменилось.");
        // A refusal about the picture itself does not change on a repeat.
        const reason = typeof answer?.reason === "string" ? answer.reason : "";
        setPhase({
          name: "error",
          message: words,
          retry:
            response.status >= 500 ||
            ["busy", "timeout", "aborted"].includes(reason),
        });
        return;
      }
      held.current = preview.id;
      setPhase({
        name: "result",
        result: {
          preview,
          beforeUrl:
            source.kind === "candidate"
              ? (preview.beforeUrl ?? "")
              : source.beforeUrl,
        },
      });
    } catch {
      if (mine !== attempt.current || !alive.current) return;
      setPhase({
        name: "error",
        message: tooLong
          ? t("Обработка заняла слишком много времени. Фото не изменилось.")
          : t("Не удалось связаться с сайтом. Фото не изменилось."),
        retry: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function take(result: BackgroundResult) {
    // One press counts: a second one finds the work already going.
    if (spending.current) return;
    spending.current = true;
    setProblem("");
    setPhase({ name: "applying", result });
    try {
      await apply(result);
      held.current = null;
      if (alive.current) onClose();
    } catch (e) {
      spending.current = false;
      if (!alive.current) return;
      setProblem(
        e instanceof Error && e.message
          ? e.message
          : t("Не удалось применить результат. Фото не изменилось."),
      );
      setPhase({ name: "result", result });
    }
  }

  const labels: Record<Backdrop, string> = {
    checker: t("Шахматная"),
    light: t("Светлая"),
    dark: t("Тёмная"),
  };
  const result =
    phase.name === "result" || phase.name === "applying" ? phase.result : null;
  const applying = phase.name === "applying";
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={id + "-title"}
      aria-busy={phase.name === "working" || applying}
      onCancel={(event) => {
        event.preventDefault();
        if (!applying) close();
      }}
    >
      <div className="modal-head">
        <h2 id={id + "-title"}>{t("Удалить фон")}</h2>
        <button
          type="button"
          className="icon"
          aria-label={t("Закрыть окно")}
          disabled={applying}
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {phase.name === "intro" && (
        <>
          <p className={styles.note}>
            {t(
              "Лучше подходит для каталожных и студийных фото на однотонном фоне. Проверьте, что детали велосипеда сохранились.",
            )}
          </p>
          <div className={styles.actions}>
            <button type="button" className="button secondary" onClick={close}>
              {t("Отмена")}
            </button>
            <button
              ref={start}
              type="button"
              className="button"
              onClick={() => void begin()}
            >
              {t("Удалить фон")}
            </button>
          </div>
        </>
      )}
      {phase.name === "working" && (
        <>
          <div className={styles.working} role="status">
            <span className={styles.bar} aria-hidden="true" />
            <p className={styles.note}>
              {t("Убираем фон… Это занимает несколько секунд.")}
            </p>
          </div>
          <div className={styles.actions}>
            <button type="button" className="button secondary" onClick={close}>
              {t("Отмена")}
            </button>
          </div>
        </>
      )}
      {phase.name === "error" && (
        <>
          <p className={styles.problem} role="alert">
            {phase.message}
          </p>
          <div className={styles.actions}>
            <button type="button" className="button secondary" onClick={close}>
              {t("Закрыть")}
            </button>
            {phase.retry && (
              <button
                ref={start}
                type="button"
                className="button"
                onClick={() => void begin()}
              >
                {t("Повторить")}
              </button>
            )}
          </div>
        </>
      )}
      {result && (
        <>
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.compare}>
            <figure className={styles.figure}>
              <figcaption>{t("Было")}</figcaption>
              <div
                className={styles.picture}
                style={{
                  aspectRatio: `${result.preview.width} / ${result.preview.height}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a private preview, not a site image */}
                <img src={result.beforeUrl} alt={t("Фото до обработки")} />
              </div>
            </figure>
            <figure className={styles.figure}>
              <figcaption>{t("Стало")}</figcaption>
              <div
                className={`${styles.picture} ${styles[backdrop]}`}
                data-backdrop={backdrop}
                style={{
                  aspectRatio: `${result.preview.width} / ${result.preview.height}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a private preview, not a site image */}
                <img src={result.preview.url} alt={t("Фото без фона")} />
              </div>
            </figure>
          </div>
          <fieldset className={styles.backdrops}>
            <legend>{t("Подложка")}</legend>
            {backdrops.map((kind) => (
              <label key={kind}>
                <input
                  type="radio"
                  name={id + "-backdrop"}
                  checked={backdrop === kind}
                  onChange={() => setBackdrop(kind)}
                />
                <span>{labels[kind]}</span>
              </label>
            ))}
          </fieldset>
          <p className={styles.note} role="status">
            {applying
              ? t("Применяем…")
              : `${t("Фон убран с {n} % кадра.").replace("{n}", String(Math.round(result.preview.removed * 100)))} ${t("Проверьте, что детали велосипеда сохранились.")}`}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className="button secondary"
              disabled={applying}
              onClick={close}
            >
              {t("Оставить исходное")}
            </button>
            <button
              ref={accept}
              type="button"
              className="button"
              disabled={applying}
              onClick={() => void take(result)}
            >
              {t("Применить")}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
