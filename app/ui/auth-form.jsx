"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowUpRight } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import styles from "./auth.module.css";
import { Field } from "../admin/design-controls.jsx";
export default function AuthForm({ mode, busy, onSubmit, switchMode }) {
  const { settings, t } = useSite();
  const [authError, setAuthError] = useState("");
  const [legal, setLegal] = useState(null),
    [legalError, setLegalError] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false),
    [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const snapshot = useRef(null),
    pending = useRef(null),
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
      const result = await response.json();
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
      if (e.name !== "AbortError" && alive.current) {
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
    if (mode === "register") loadLegal();
    const focus = () => {
      if (mode === "register") loadLegal();
    };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      pending.current?.abort();
      window.removeEventListener("focus", focus);
    };
  }, [mode, loadLegal]);
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
        setAuthError("");
        d.delete("confirmPassword");
        const data = Object.fromEntries(d);
        submitLock.current = true;
        setSubmitting(true);
        try {
          if (mode === "register") {
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
          if (mode === "register" && alive.current) await loadLegal();
        } finally {
          submitLock.current = false;
          if (alive.current) setSubmitting(false);
        }
      }}
    >
      <p className="form-intro">
        {mode === "register"
          ? t("Сохраните комплектацию и фотографии своих велосипедов.")
          : t("Войдите, чтобы открыть свои велосипеды.")}
      </p>
      {mode === "register" && (
        <Field label={t("Ваше имя")}>
          <input
            name="name"
            required
            maxLength={60}
            autoComplete="name"
            autoFocus
          />
        </Field>
      )}
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
        />
      </Field>
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
      {mode === "register" && (
        <p className="help">{t("Минимум 10 символов.")}</p>
      )}
      {mode === "login" && (
        <p className={styles.forgot}>
          <a href="/forgot-password">{t("Забыли пароль?")}</a>
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
      {mode === "register" && (
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
        className="button full"
        disabled={busy || submitting || (mode === "register" && !legal?.ready)}
      >
        {busy
          ? t("Подождите…")
          : mode === "register"
            ? t("Создать аккаунт")
            : t("Войти")}
        <ArrowUpRight size={17} aria-hidden="true" />
      </button>
      {(mode === "register" || settings.registrationOpen) && (
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
