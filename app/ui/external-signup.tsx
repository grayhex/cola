"use client";
import { errorMessage } from "../../lib/errors.ts";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "./icons.tsx";
import GlobalHeader from "./global-header.tsx";
import { SocialFooter, socialApi } from "./social-primitives.tsx";
import AuthForm from "./auth-form.tsx";
import AuthWindow from "./auth-window.tsx";
import styles from "./auth.module.css";

// The last step of a first sign-in with Yandex ID (#151): the account is not
// created until the person chooses a username and accepts both documents. The
// pending sign-in lives in an HttpOnly cookie, so this page only asks the
// server what it may prefill.
export default function ExternalSignup() {
  const [pending, setPending] = useState<
    { name: string; email: string | null } | "expired" | null
  >(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    socialApi<{ name: string; email: string | null }>("auth/yandex/pending")
      .then((result) => alive && setPending(result))
      .catch(() => alive && setPending("expired"));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <GlobalHeader user={null} />
      <main className={styles.page}>
        <Link href="/login" className={styles.back}>
          <ArrowLeft size={16} />
          Ко входу
        </Link>
        <AuthWindow as="section" aria-labelledby="auth-title" mode="register">
          <h1 id="auth-title">Завершите регистрацию</h1>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {pending === "expired" ? (
            <p>
              Время входа истекло или страница открыта в другом браузере.{" "}
              <Link href="/login">Войти заново</Link>
            </p>
          ) : pending ? (
            <AuthForm
              mode="complete"
              busy={busy}
              external={pending}
              switchMode={() => {}}
              onSubmit={async (data) => {
                setBusy(true);
                setError("");
                try {
                  const result = await socialApi<{ returnPath: string }>(
                    "auth/yandex/complete",
                    "POST",
                    data,
                  );
                  // A new session: reload the server viewer.
                  location.assign(result.returnPath);
                } catch (e) {
                  setError(errorMessage(e));
                  setBusy(false);
                }
              }}
            />
          ) : (
            <p className="help" role="status">
              Загружаем…
            </p>
          )}
        </AuthWindow>
      </main>
      <SocialFooter />
    </>
  );
}
