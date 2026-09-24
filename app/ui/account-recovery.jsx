"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, KeyRound, MailCheck } from "./icons.jsx";
import GlobalHeader from "./global-header.jsx";
import { SocialFooter, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { Field } from "../admin/design-controls.jsx";
import styles from "./auth.module.css";

function RecoveryLayout({ icon: Icon, title, children }) {
  return (
    <>
      <GlobalHeader user={null} />
      <main className={styles.page}>
        <Link href="/login" className={styles.back}>
          <ArrowLeft size={16} />
          Ко входу
        </Link>
        <section className={styles.card} aria-labelledby="recovery-title">
          <span className={styles.mark}>
            <Icon size={26} strokeWidth={1.5} />
          </span>
          <h1 id="recovery-title">{title}</h1>
          {children}
        </section>
      </main>
      <SocialFooter />
    </>
  );
}

// The token arrives in the URL fragment and is removed from the address bar
// right away, so it does not stay in history or reach any request.
function useLinkToken() {
  const [token, setToken] = useState(undefined);
  useEffect(() => {
    const value = window.location.hash.slice(1);
    setToken(/^[A-Za-z0-9_-]{43}$/.test(value) ? value : null);
    if (value)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  }, []);
  return token;
}

export function ForgotPassword() {
  const [state, setState] = useState("idle"),
    [error, setError] = useState("");
  return (
    <RecoveryLayout icon={KeyRound} title="Восстановление пароля">
      {state === "sent" ? (
        <>
          <p className={styles.done} role="status">
            Если адрес зарегистрирован, мы отправили на него письмо со ссылкой
            для нового пароля. Ссылка действует 1 час. Письма нет — проверьте
            папку «Спам» или запросите ещё раз через несколько минут.
          </p>
          <Link className="button secondary full" href="/login">
            Вернуться ко входу
          </Link>
        </>
      ) : (
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (state === "busy") return;
            setState("busy");
            setError("");
            try {
              await socialApi("auth/password-reset", "POST", {
                email: new FormData(e.currentTarget).get("email"),
              });
              setState("sent");
            } catch (err) {
              setError(err.message);
              setState("idle");
            }
          }}
        >
          <p className="form-intro">
            Укажите почту аккаунта — пришлём ссылку, по которой можно задать
            новый пароль.
          </p>
          <Field label="Электронная почта">
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              placeholder="name@example.com"
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <button
            className="button full"
            disabled={state === "busy"}
            aria-busy={state === "busy"}
          >
            {state === "busy" ? "Отправляем…" : "Отправить ссылку"}
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        </form>
      )}
    </RecoveryLayout>
  );
}

export function ResetPassword() {
  const token = useLinkToken();
  const { refreshViewer } = useSite();
  const [state, setState] = useState("idle"),
    [error, setError] = useState("");
  const confirm = useRef(null);
  if (token === undefined)
    return (
      <RecoveryLayout icon={KeyRound} title="Новый пароль">
        <p role="status">Проверяем ссылку…</p>
      </RecoveryLayout>
    );
  if (!token || state === "invalid")
    return (
      <RecoveryLayout icon={KeyRound} title="Ссылка не работает">
        <p className={styles.done} role="alert">
          Ссылка недействительна или устарела: она работает один раз и 1 час.
          Запросите новое письмо.
        </p>
        <Link className="button full" href="/forgot-password">
          Запросить новую ссылку
        </Link>
      </RecoveryLayout>
    );
  if (state === "done")
    return (
      <RecoveryLayout icon={KeyRound} title="Пароль изменён">
        <p className={styles.done} role="status">
          Готово: вы вошли с новым паролем. Остальные устройства вышли из
          аккаунта.
        </p>
        <Link className="button full" href="/account">
          Открыть кабинет
        </Link>
      </RecoveryLayout>
    );
  return (
    <RecoveryLayout icon={KeyRound} title="Новый пароль">
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (state === "busy") return;
          const data = new FormData(e.currentTarget);
          if (data.get("password") !== data.get("confirmPassword")) {
            setError("Пароли не совпадают");
            confirm.current?.focus();
            return;
          }
          setState("busy");
          setError("");
          try {
            await socialApi("auth/password-reset/confirm", "POST", {
              token,
              password: data.get("password"),
            });
            // The reset signs the reader in: the header and the account
            // page reached by a link must know it without a reload (#74).
            await refreshViewer().catch(() => {});
            setState("done");
          } catch (err) {
            if (/недействительна|устарела/.test(err.message))
              setState("invalid");
            else {
              setError(err.message);
              setState("idle");
            }
          }
        }}
      >
        <p className="form-intro">
          Придумайте новый пароль. После сохранения все остальные сессии
          завершатся.
        </p>
        <Field label="Новый пароль">
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        <p className="help">Минимум 10 символов.</p>
        <Field label="Повторите пароль">
          <input
            ref={confirm}
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            onChange={() => setError("")}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        <button
          className="button full"
          disabled={state === "busy"}
          aria-busy={state === "busy"}
        >
          {state === "busy" ? "Сохраняем…" : "Сохранить пароль"}
          <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </form>
    </RecoveryLayout>
  );
}

export function VerifyEmail() {
  const token = useLinkToken();
  const [state, setState] = useState("checking");
  const started = useRef(false);
  useEffect(() => {
    if (token === undefined || started.current) return;
    started.current = true;
    if (!token) {
      setState("invalid");
      return;
    }
    socialApi("auth/verify-email", "POST", { token }).then(
      () => setState("done"),
      () => setState("invalid"),
    );
  }, [token]);
  return (
    <RecoveryLayout icon={MailCheck} title="Подтверждение почты">
      {state === "checking" && <p role="status">Проверяем ссылку…</p>}
      {state === "done" && (
        <>
          <p className={styles.done} role="status">
            Адрес подтверждён. Теперь по нему можно восстановить доступ к
            аккаунту.
          </p>
          <Link className="button full" href="/account">
            Открыть кабинет
          </Link>
        </>
      )}
      {state === "invalid" && (
        <>
          <p className={styles.done} role="alert">
            Ссылка недействительна или устарела. Отправьте письмо ещё раз из
            кабинета: Аккаунт → Почта.
          </p>
          <Link className="button full" href="/account?tab=account">
            Открыть настройки аккаунта
          </Link>
        </>
      )}
    </RecoveryLayout>
  );
}
