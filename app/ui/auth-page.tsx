"use client";
import { errorMessage } from "../../lib/errors.ts";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "./icons.tsx";
import GlobalHeader from "./global-header.tsx";
import { SocialFooter, leavingPage, socialApi } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import AuthForm from "./auth-form.tsx";
import AuthWindow from "./auth-window.tsx";
import styles from "./auth.module.css";

export default function AuthPage({
  initialMode = "login",
  onAuthenticated,
  notice = "",
}: {
  initialMode?: "login" | "register";
  // Replaces the page after sign-in, as the default /account does.
  onAuthenticated?: () => void;
  // The outcome of a provider round trip, already mapped to text (#151).
  notice?: string;
}) {
  const { settings } = useSite();
  const [mode, setMode] = useState(initialMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(notice);
  const register = mode === "register";
  return (
    <>
      <GlobalHeader user={null} />
      <main className={styles.page}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} />
          На главную
        </Link>
        <AuthWindow as="section" aria-labelledby="auth-title" mode={mode}>
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
                  // New session: reload the server viewer and discard private client state.
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  else location.assign("/account");
                  return leavingPage();
                } catch (e) {
                  setError(errorMessage(e));
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
