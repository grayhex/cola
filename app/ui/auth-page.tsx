"use client";
import { errorMessage } from "../../lib/errors.ts";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "./icons.tsx";
import GlobalHeader from "./global-header.tsx";
import { SocialFooter, leavingPage, socialApi } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import AuthForm from "./auth-form.tsx";
import AuthWindow from "./auth-window.tsx";
import styles from "./auth.module.css";

export default function AuthPage({
  initialMode,
  onAuthenticated,
  notice = "",
}: {
  // Without one the address decides: `?auth=register` is how a guest's
  // «Хочу кататься» and «Организовать покатушку» ask for registration (#378);
  // anything else is a sign-in, as before.
  initialMode?: "login" | "register";
  // Replaces the page after sign-in, as the default /account does.
  onAuthenticated?: () => void;
  // The outcome of a provider round trip, already mapped to text (#151).
  notice?: string;
}) {
  const { settings } = useSite();
  const params = useSearchParams();
  const router = useRouter();
  const asked = params?.get("auth") === "register";
  const [mode, setMode] = useState<"login" | "register">(
      initialMode ?? (asked ? "register" : "login"),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(notice);
  // The page stays mounted when a guest on the sign-in form follows a button
  // that asks for registration (the address changes only by its query): a new
  // ask opens the form of registering; a switch the guest made by hand stays
  // until the next ask.
  const [wasAsked, setWasAsked] = useState(asked);
  if (wasAsked !== asked) {
    setWasAsked(asked);
    if (asked && initialMode === undefined && mode !== "register") {
      setMode("register");
      setError("");
    }
  }
  const register = mode === "register";
  return (
    <>
      <GlobalHeader user={null} />
      <main className={styles.page}>
        <Link
          href="/"
          className={styles.back}
          onClick={(event) => {
            // Cancelling what a button of a page asked for goes back to that
            // page, where the rider was, not to the home page (#378).
            if (
              !asked ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              window.history.length < 2
            )
              return;
            event.preventDefault();
            router.back();
          }}
        >
          <ArrowLeft size={16} />
          {asked ? "Назад" : "На главную"}
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
