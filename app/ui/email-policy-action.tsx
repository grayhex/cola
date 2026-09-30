"use client";
import type {
  EmailVerificationResponse,
  ApiError,
} from "../../lib/contracts.ts";
import { errorMessage } from "../../lib/errors.ts";
import { useState } from "react";
import { useSite } from "./site-provider.tsx";
import { EMAIL_POLICY_MESSAGE } from "../../lib/email-policy.ts";

// Inline even inside dialogs: sending/checking must never navigate away from a draft.
export default function EmailPolicyAction({ message }: { message?: string }) {
  const { refreshViewer } = useSite();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  if (!message?.startsWith(EMAIL_POLICY_MESSAGE)) return null;
  async function act(send: boolean) {
    setBusy(true);
    setStatus("");
    try {
      if (send) {
        const response = await fetch("/api/account/email-verification", {
          method: "POST",
        });
        const result: EmailVerificationResponse & Partial<ApiError> =
          await response.json();
        if (!response.ok)
          throw new Error(result.error || "Не удалось отправить письмо");
        setStatus(
          result.verified
            ? "Почта подтверждена. Повторите действие."
            : "Письмо отправлено. Откройте ссылку и повторите действие здесь.",
        );
      } else {
        const user = await refreshViewer();
        setStatus(
          user?.email_verified_at
            ? "Почта подтверждена. Повторите действие."
            : "Подтверждение ещё не получено. Проверьте почту или измените адрес в кабинете.",
        );
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {" "}
      <button
        type="button"
        className="quiet"
        disabled={busy}
        onClick={() => act(true)}
      >
        Отправить письмо повторно
      </button>{" "}
      <button
        type="button"
        className="quiet"
        disabled={busy}
        onClick={() => act(false)}
      >
        Я подтвердил почту
      </button>
      {status && (
        <span className="help" role="status">
          {status}
        </span>
      )}
    </>
  );
}
