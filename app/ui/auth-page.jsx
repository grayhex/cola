"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "./icons.jsx";
import GlobalHeader from "./global-header.jsx";
import { SocialFooter, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import AuthForm from "./auth-form.jsx";
import AuthWindow from "./auth-window.jsx";
import styles from "./auth.module.css";

export default function AuthPage({ initialMode = "login", onAuthenticated }) {
  const { settings } = useSite();
  const [mode, setMode] = useState(initialMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const register = mode === "register";
  return (
    <>
      <GlobalHeader user={null} />
      <main className={styles.page}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} />
          На главную
        </Link>
        <AuthWindow as="section" aria-labelledby="auth-title">
          <h1 id="auth-title">
            {register ? "Присоединиться к ColaBike" : "С возвращением"}
          </h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {register && !settings.registrationOpen ? (
            <p>
              Регистрация временно закрыта.{" "}
              <button className="quiet" onClick={() => setMode("login")}>
                Войти в аккаунт
              </button>
            </p>
          ) : (
            <AuthForm
              key={mode}
              mode={mode}
              busy={busy}
              switchMode={() => {
                setMode(register ? "login" : "register");
                setError("");
              }}
              onSubmit={async (data) => {
                setBusy(true);
                setError("");
                try {
                  await socialApi("auth/" + mode, "POST", data);
                  if (onAuthenticated) onAuthenticated();
                  else location.assign("/account");
                } catch (e) {
                  setError(e.message);
                  setBusy(false);
                }
              }}
            />
          )}
        </AuthWindow>
      </main>
      <SocialFooter />
    </>
  );
}
