"use client";
import { useEffect, useRef, useState } from "react";
import { socialApi } from "./social-primitives.tsx";
import { errorMessage } from "../../lib/errors.ts";
import Link from "next/link";
export default function NotificationUnsubscribe() {
  const originalToken = useRef<string | null>(null);
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    originalToken.current ??= window.location.hash.slice(1);
    setToken(originalToken.current);
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);
  return (
    <main className="page narrow">
      <section className="social-panel">
        <h1>Уведомления по почте</h1>
        {done ? (
          <p role="status">
            Уведомления отключены. Восстановление доступа и письма безопасности
            продолжат работать.
          </p>
        ) : (
          <>
            <p>
              Отключить email об обсуждениях, приглашениях и объявлениях?
              Уведомления на сайте останутся доступны.
            </p>
            <p className="help">
              Для отписки входить в аккаунт не нужно. Восстановление доступа и
              письма безопасности останутся включены.
            </p>
            <button
              type="button"
              className="button"
              disabled={!token || busy}
              aria-busy={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await socialApi("notification-email/unsubscribe", "POST", {
                    token,
                  });
                  setDone(true);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Сохраняем…" : "Отключить уведомления"}
            </button>
            {!token && (
              <p className="help">
                Откройте ссылку из письма или измените настройки в кабинете.
              </p>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p>
          <Link href="/account?tab=account">Настройки аккаунта</Link>
        </p>
      </section>
    </main>
  );
}
