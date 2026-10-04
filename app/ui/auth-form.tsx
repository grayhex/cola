"use client";
import type { LegalMetadataDto } from "../../lib/contracts.ts";
type UsernameState =
  | "idle"
  | "checking"
  | "invalid"
  | "reserved"
  | "format"
  | "unknown"
  | "free"
  | "taken";
import type * as React from "react";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowUpRight } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./auth.module.css";
import { Field } from "../admin/design-controls.tsx";
import {
  reservedUsernames,
  suggestUsername,
  usernamePattern,
} from "../../lib/usernames.ts";
const usernameHelp: Partial<Record<UsernameState, string>> = {
  checking: "Проверяем…",
  invalid: "3–30 символов: латиница, цифры, точка, дефис или подчёркивание.",
  reserved: "Это имя зарезервировано.",
  format: "3–30 символов: латиница, цифры, точка, дефис или подчёркивание.",
  unknown: "Не удалось проверить имя, проверим при регистрации.",
};
// Suggested from the name until the person edits it (#71). An untouched
// suggestion is not sent: the server derives the same username, or the next
// free one if it was taken in the meantime. The check is advisory, the server
// validates a chosen username again.
function UsernameField({
  suggestion,
  onStatus,
}: {
  suggestion: string;
  onStatus: (status: UsernameState) => void;
}) {
  const [value, setValue] = useState(suggestion),
    [edited, setEdited] = useState(false),
    [status, setStatus] = useState<{
      state: UsernameState;
      suggestion?: string;
    }>({ state: "idle" });
  const username = value.trim().toLowerCase();
  useEffect(() => {
    if (!edited) setValue(suggestion);
  }, [suggestion, edited]);
  useEffect(() => {
    onStatus(status.state);
  }, [status.state, onStatus]);
  useEffect(() => {
    if (!username) return setStatus({ state: "idle" });
    if (!usernamePattern.test(username)) return setStatus({ state: "invalid" });
    if (reservedUsernames.has(username))
      return setStatus({ state: "reserved" });
    const controller = new AbortController();
    setStatus({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          "/api/social/usernames/" + encodeURIComponent(username),
          { cache: "no-store", signal: controller.signal },
        );
        const result: {
          available: boolean;
          reason?: UsernameState;
          suggestion?: string;
          error?: string;
        } = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.available) setStatus({ state: "free" });
        // An untouched suggestion quietly moves to the first free variant.
        else if (!edited && result.suggestion) setValue(result.suggestion);
        else
          setStatus({
            state: result.reason || "taken",
            suggestion: result.suggestion,
          });
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError"))
          setStatus({ state: "unknown" });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, edited]);
  return (
    <>
      <Field label="Имя пользователя">
        <input
          name={edited ? "username" : undefined}
          required
          minLength={3}
          maxLength={30}
          pattern={"[a-zA-Z0-9._\\-]{3,30}"}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="username-help"
          value={value}
          onChange={(e) => {
            setEdited(true);
            setValue(e.target.value);
          }}
        />
      </Field>
      <p id="username-help" className="help" aria-live="polite">
        {status.state === "taken" ? (
          <>
            Имя @{username} занято.
            {status.suggestion && (
              <>
                {" "}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setValue(status.suggestion!)}
                >
                  Взять @{status.suggestion}
                </button>
              </>
            )}
          </>
        ) : (
          usernameHelp[status.state] ||
          (username
            ? (status.state === "free" ? "Свободно. " : "") +
              "Адрес профиля: /@" +
              username
            : "Будет в адресе профиля и в ссылках на ваши публикации.")
        )}
      </p>
    </>
  );
}
export default function AuthForm({
  mode,
  busy,
  onSubmit,
  switchMode,
  // Context-specific first line, e.g. answering a ride (#235).
  intro = null,
  external = null,
}: {
  mode: "login" | "register" | "complete";
  busy: boolean;
  // Resolving keeps the form: after a refused sign-up it rereads the documents.
  // A handler that replaces the page returns leavingPage() instead.
  onSubmit: (
    data: Record<string, FormDataEntryValue | boolean | number | null>,
  ) => Promise<void>;
  switchMode: () => void;
  intro?: Partial<Record<"login" | "register", React.ReactNode>> | null;
  // First sign-in with an external provider (#151): no password, the name and
  // address come from the provider, the rest is as in registration.
  external?: { name: string; email: string | null } | null;
}) {
  const { settings, t, yandexIdEnabled } = useSite();
  // Registration and the completion of a provider sign-in share the username
  // and the explicit acceptance of both documents.
  const signup = mode !== "login";
  const [authError, setAuthError] = useState("");
  const [person, setPerson] = useState({ name: "", email: "" }),
    [usernameState, setUsernameState] = useState("idle");
  const [legal, setLegal] = useState<LegalMetadataDto | null>(null),
    [legalError, setLegalError] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false),
    [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const snapshot = useRef<LegalMetadataDto | null>(null),
    pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  const loadLegal = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/legal", {
        cache: "no-store",
        signal: controller.signal,
      });
      const result: LegalMetadataDto = await response.json();
      if (!response.ok)
        throw new Error("Не удалось загрузить документы. Повторите попытку.");
      if (controller.signal.aborted || !alive.current) return null;
      const old = snapshot.current;
      const changed =
        old &&
        ["terms", "privacy"].some(
          (k) => old.documents[k].revision !== result.documents[k].revision,
        );
      if (changed) {
        setTermsAccepted(false);
        setPrivacyAccepted(false);
        setAuthError(
          "Документы обновились. Прочитайте новые версии и отметьте оба согласия заново.",
        );
      }
      snapshot.current = result;
      setLegal(result);
      setLegalError("");
      return { ...result, changed };
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError") && alive.current) {
        setLegalError("Не удалось загрузить документы. Повторите попытку.");
        setLegal(null);
      }
      return null;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    setAuthError("");
    setTermsAccepted(false);
    setPrivacyAccepted(false);
    snapshot.current = null;
    setLegal(null);
    if (signup) loadLegal();
    const focus = () => {
      if (signup) loadLegal();
    };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      pending.current?.abort();
      window.removeEventListener("focus", focus);
    };
  }, [signup, loadLegal]);
  return (
    <form
      className="auth-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || submitLock.current) return;
        const d = new FormData(e.currentTarget);
        if (
          mode === "register" &&
          d.get("password") !== d.get("confirmPassword")
        ) {
          setAuthError("Пароли не совпадают");
          return;
        }
        if (signup && usernameState === "taken") {
          setAuthError("Это имя пользователя занято. Выберите другое.");
          return;
        }
        setAuthError("");
        d.delete("confirmPassword");
        const data = Object.fromEntries(d);
        submitLock.current = true;
        setSubmitting(true);
        try {
          if (signup) {
            if (!termsAccepted || !privacyAccepted || !legal?.ready) {
              setAuthError("Примите оба документа для регистрации.");
              return;
            }
            const fresh = await loadLegal();
            if (!fresh?.ready || fresh.changed) return;
            Object.assign(data, {
              termsAccepted: true,
              privacyAccepted: true,
              termsRevision: fresh.documents.terms.revision,
              privacyRevision: fresh.documents.privacy.revision,
            });
          }
          await onSubmit(data);
          // The server rechecks revisions atomically; recover from a publication
          // that raced the preflight without clearing any entered credentials.
          if (signup && alive.current) await loadLegal();
        } finally {
          submitLock.current = false;
          if (alive.current) setSubmitting(false);
        }
      }}
    >
      <p className="form-intro">
        {(mode !== "complete" && intro?.[mode]) ||
          (mode === "complete"
            ? "Последний шаг: выберите имя пользователя и примите документы."
            : mode === "register"
              ? t("Сохраните комплектацию и фотографии своих велосипедов.")
              : t("Войдите, чтобы открыть свои велосипеды."))}
      </p>
      {signup && (
        <>
          <Field label={t("Ваше имя")}>
            <input
              name="name"
              required
              maxLength={60}
              autoComplete="name"
              autoFocus
              defaultValue={external?.name || ""}
              onChange={(e) =>
                setPerson((p) => ({ ...p, name: e.target.value }))
              }
            />
          </Field>
          <UsernameField
            suggestion={suggestUsername(
              person.name || external?.name || "",
              person.email || external?.email || "",
              "",
            )}
            onStatus={setUsernameState}
          />
        </>
      )}
      {mode === "complete" && external?.email && (
        <p className={`help ${styles.externalEmail}`}>
          Почта из Яндекса: {external.email}. Подтвердите её по ссылке из
          письма: до этого публиковать записи нельзя.
        </p>
      )}
      {(mode !== "complete" || !external?.email) && (
        <Field label={t("Электронная почта")}>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            pattern={"[^\\s@]+@[^\\s@]+\\.[^\\s@]+"}
            autoFocus={mode === "login"}
            onChange={(e) =>
              signup && setPerson((p) => ({ ...p, email: e.target.value }))
            }
          />
        </Field>
      )}
      {mode === "complete" && !external?.email && (
        <p className={`help ${styles.externalEmail}`}>
          Яндекс не передал адрес. Укажите свой: на него придёт ссылка для
          подтверждения, он нужен и для восстановления доступа.
        </p>
      )}
      {mode !== "complete" && (
        <Field label={t("Пароль")}>
          <input
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
          />
        </Field>
      )}
      {mode === "register" && (
        <p className="help">{t("Минимум 10 символов.")}</p>
      )}
      {mode === "login" && (
        <p className={styles.forgot}>
          <Link href="/forgot-password">{t("Забыли пароль?")}</Link>
        </p>
      )}
      {mode === "register" && (
        <Field label="Подтвердите пароль">
          <input
            name="confirmPassword"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
            onChange={() => setAuthError("")}
          />
        </Field>
      )}
      {signup && (
        <>
          <fieldset
            className={styles.consents}
            disabled={busy || submitting || !legal?.ready}
          >
            <legend className="sr-only">Согласия при регистрации</legend>
            <label>
              <input
                type="checkbox"
                name="termsAccepted"
                required
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
              />
              <span>
                Принять пользовательское{" "}
                <a
                  href={legal?.documents.terms.href || "/legal/terms"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  соглашение
                </a>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                name="privacyAccepted"
                required
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
              />
              <span>
                Согласен с{" "}
                <a
                  href={legal?.documents.privacy.href || "/legal/privacy"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  политикой
                </a>{" "}
                обработки персональных данных
              </span>
            </label>
          </fieldset>
          {legal && !legal.ready && (
            <p className="help" role="status">
              Регистрация временно недоступна: документы ещё не опубликованы.
            </p>
          )}
          {!legal && !legalError && (
            <p className="help" role="status">
              Загружаем документы…
            </p>
          )}
          {legalError && (
            <p role="alert" className="help">
              {legalError}{" "}
              <button type="button" className="quiet" onClick={loadLegal}>
                Повторить загрузку документов
              </button>
            </p>
          )}
        </>
      )}
      {authError && <p role="alert">{authError}</p>}
      <button
        className="button block"
        disabled={busy || submitting || (signup && !legal?.ready)}
      >
        {busy ? t("Подождите…") : signup ? t("Создать аккаунт") : t("Войти")}
        <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      {mode !== "complete" && yandexIdEnabled && (
        <>
          <p className={styles.or}>или</p>
          <button
            type="button"
            className="button secondary block"
            disabled={busy || submitting}
            onClick={() => {
              // Back to the page the person was on; the sign-in pages go to the account.
              const here = location.pathname + location.search;
              const target = ["/login", "/register"].includes(location.pathname)
                ? "/account"
                : here;
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              location.assign(
                "/api/auth/yandex/start?return=" + encodeURIComponent(target),
              );
            }}
          >
            {mode === "register"
              ? "Зарегистрироваться через Яндекс"
              : "Войти через Яндекс"}
          </button>
        </>
      )}
      {mode !== "complete" &&
        (mode === "register" || settings.registrationOpen) && (
          <button
            type="button"
            disabled={busy || submitting}
            className="quiet switch-auth"
            onClick={switchMode}
          >
            {mode === "register"
              ? t("Уже есть аккаунт? Войти")
              : t("Нет аккаунта? Зарегистрироваться")}
          </button>
        )}
    </form>
  );
}
