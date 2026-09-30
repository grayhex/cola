"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Modal from "./garage/modal.tsx";
import AuthWindow from "./auth-window.tsx";
import { socialApi } from "./social-primitives.tsx";

// The form loads on demand; a failed chunk leaves a working way to sign in.
const AuthForm = dynamic(
  () =>
    import("./auth-form.tsx").catch(() => ({
      default: function AuthUnavailable() {
        return (
          <p role="alert" className="error">
            Не удалось загрузить форму входа.{" "}
            <Link href="/login">Открыть страницу входа</Link>
          </p>
        );
      },
    })),
  {
    ssr: false,
    loading: () => <p role="status">Загружаем форму входа…</p>,
  },
);

/** Sign in or register without leaving the ride (#235). The page then loads
 * again at the same address, so the server checks the new session's access
 * to this ride from scratch; nothing is answered on the person's behalf.
 * Registration stays subject to `registrationOpen`, blocking and the usual
 * e-mail rules. */
export default function RideAuthDialog({ onClose }) {
  const [mode, setMode] = useState("login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={mode === "register" ? "Регистрация" : "Вход"}
      onClose={() => !busy && onClose()}
    >
      <AuthWindow mode={mode}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <AuthForm
          key={mode}
          mode={mode}
          busy={busy}
          intro={{
            login: "Войдите, чтобы ответить на покатушку.",
            register:
              "Аккаунт нужен, чтобы ответить организатору. Добавлять велосипед не обязательно.",
          }}
          switchMode={() => {
            setError("");
            setMode(mode === "register" ? "login" : "register");
          }}
          onSubmit={async (data) => {
            setBusy(true);
            setError("");
            try {
              await socialApi("auth/" + mode, "POST", data);
              location.reload();
            } catch (e) {
              setError(e.message);
              setBusy(false);
            }
          }}
        />
      </AuthWindow>
    </Modal>
  );
}
