"use client";
import type {
  NotificationEmailPreferences,
  NotificationEmailSettings,
} from "../../lib/notification-preferences.ts";
import { useEffect, useRef, useState } from "react";
import { socialApi } from "./social-primitives.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { useMotionFeedback } from "./motion.tsx";
const empty: NotificationEmailPreferences = {
  enabled: false,
  discussions: false,
  rides: false,
  market: false,
};
export default function AccountNotifications() {
  const [data, setData] = useState<NotificationEmailSettings | null>(null),
    [form, setForm] = useState(empty),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0);
  const saved = useRef(empty),
    feedback = useMotionFeedback<HTMLParagraphElement>(message);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    socialApi<NotificationEmailSettings>("account/notifications")
      .then((value) => {
        if (disposed) return;
        setData(value);
        const { enabled, discussions, rides, market } = value;
        saved.current = { enabled, discussions, rides, market };
        setForm(saved.current);
      })
      .catch((e) => {
        if (!disposed) setError(errorMessage(e));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [attempt]);
  return (
    <section
      className="account-notifications"
      aria-labelledby="notification-email-title"
    >
      <h3 id="notification-email-title">Уведомления по почте</h3>
      <p className="help">
        Важные события — на подтверждённый адрес. Получать предложения покатушек
        и подписаться на письма — отдельные настройки.
      </p>
      {loading ? (
        <p role="status">Загружаем настройки…</p>
      ) : data ? (
        <form
          className="account-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const value = await socialApi<NotificationEmailSettings>(
                "account/notifications",
                "PATCH",
                form,
              );
              setData(value);
              saved.current = {
                enabled: value.enabled,
                discussions: value.discussions,
                rides: value.rides,
                market: value.market,
              };
              setForm(saved.current);
              setMessage("Настройки уведомлений сохранены");
            } catch (e) {
              setForm(saved.current);
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="notification-email-fields">
            <legend className="sr-only">Письма от ColaBike</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={!form.enabled && (!data.available || !data.verified)}
                onChange={(e) =>
                  setForm({ ...form, enabled: e.target.checked })
                }
              />
              <span>Получать уведомления по почте</span>
            </label>
            {!data.verified && (
              <p className="help">Сначала подтвердите адрес почты.</p>
            )}
            {!data.available && (
              <p className="help">
                Отправка уведомлений по почте пока не настроена. Уведомления на
                сайте работают.
              </p>
            )}
            {(
              [
                ["discussions", "Комментарии и ответы"],
                ["rides", "Покатушки и приглашения"],
                ["market", "Окончание срока объявлений"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) =>
                    setForm({ ...form, [key]: e.target.checked })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
            <p className="help">
              Письма безопасности и восстановление доступа не зависят от этих
              настроек. В каждом уведомлении есть ссылка отписки.
            </p>
            <button type="submit" className="button small" aria-busy={busy}>
              {busy ? "Сохраняем…" : "Сохранить уведомления"}
            </button>
          </fieldset>
        </form>
      ) : (
        <button
          type="button"
          className="button secondary small"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Повторить загрузку уведомлений
        </button>
      )}
      <p ref={feedback} role="status" className="help">
        {message}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
