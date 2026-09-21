"use client";
import { useState, useEffect } from "react";
import { ArrowUpRight } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import { Field } from "../admin/design-controls.jsx";
export default function AuthForm({ mode, busy, onSubmit, switchMode }) {
  const { settings, t } = useSite();
  const [authError, setAuthError] = useState("");
  useEffect(() => setAuthError(""), [mode]);
  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault();
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
        onSubmit(Object.fromEntries(d));
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
      {authError && <p role="alert">{authError}</p>}
      <button className="button full" disabled={busy}>
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
