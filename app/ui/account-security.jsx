"use client";
import { useEffect, useId, useState } from "react";
import { socialApi } from "./social-primitives.jsx";
import { LogOut, Download, Trash2, MonitorSmartphone } from "./icons.jsx";

// The «Account» tab (#70): address, password, signed-in devices, data
// export and deletion. Every action asks the server, which checks the
// session, the origin and, where it matters, the password.

// A short name for a device from its browser's own description.
export function deviceName(agent = "") {
  const browser =
    [
      [/YaBrowser\//, "Яндекс Браузер"],
      [/Edg\//, "Edge"],
      [/OPR\/|Opera/, "Opera"],
      [/Firefox\//, "Firefox"],
      [/Chrome\//, "Chrome"],
      [/Safari\//, "Safari"],
    ].find(([test]) => test.test(agent))?.[1] || "Браузер";
  const system =
    [
      [/iPhone|iPad|iPod/, "iOS"],
      [/Android/, "Android"],
      [/Windows/, "Windows"],
      [/Mac OS X|Macintosh/, "macOS"],
      [/CrOS/, "ChromeOS"],
      [/Linux/, "Linux"],
    ].find(([test]) => test.test(agent))?.[1] || "";
  return system ? `${browser} · ${system}` : browser;
}

const when = (value) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

function useAction() {
  const [state, setState] = useState({ busy: false, error: "", done: "" });
  async function run(action, done = "") {
    setState({ busy: true, error: "", done: "" });
    try {
      const result = await action();
      setState({ busy: false, error: "", done });
      return result;
    } catch (e) {
      setState({ busy: false, error: e.message, done: "" });
      return null;
    }
  }
  return [state, run];
}

function Status({ state }) {
  return (
    <>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.done && (
        <p className="notice" data-tone="success" role="status">
          {state.done}
        </p>
      )}
    </>
  );
}

function EmailChange() {
  const [state, run] = useAction();
  return (
    <form
      className="account-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        const ok = await run(
          () => socialApi("account/email", "POST", data),
          "Письмо отправлено на новый адрес. Откройте ссылку из него — до этого для входа работает прежний адрес.",
        );
        if (ok) form.reset();
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Новый адрес</span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Текущий пароль</span>
          <input
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </label>
      </div>
      <Status state={state} />
      <div className="form-actions">
        <button className="button secondary" disabled={state.busy}>
          {state.busy ? "Отправляем…" : "Сменить адрес"}
        </button>
      </div>
    </form>
  );
}

function PasswordChange() {
  const [state, run] = useAction();
  const [mismatch, setMismatch] = useState(false);
  const id = useId();
  return (
    <form
      className="account-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        if (data.password !== data.repeat) {
          setMismatch(true);
          return;
        }
        setMismatch(false);
        const ok = await run(
          () =>
            socialApi("account/password", "POST", {
              currentPassword: data.currentPassword,
              password: data.password,
            }),
          "Пароль изменён. На других устройствах нужно войти заново.",
        );
        if (ok) form.reset();
      }}
    >
      <label className="field">
        <span>Текущий пароль</span>
        <input
          name="currentPassword"
          type="password"
          required
          maxLength={128}
          autoComplete="current-password"
        />
      </label>
      {/* Hints sit outside the labels: they describe the fields and do
          not become part of their names. */}
      <div className="form-grid">
        <div className="field">
          <label htmlFor={id + "new"}>Новый пароль</label>
          <input
            id={id + "new"}
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            aria-describedby={id + "hint"}
          />
          <small id={id + "hint"}>Минимум 10 символов.</small>
        </div>
        <div className="field">
          <label htmlFor={id + "repeat"}>Новый пароль ещё раз</label>
          <input
            id={id + "repeat"}
            name="repeat"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? id + "mismatch" : undefined}
          />
          {mismatch && (
            <small className="field-error" id={id + "mismatch"}>
              Пароли не совпадают
            </small>
          )}
        </div>
      </div>
      <Status state={state} />
      <div className="form-actions">
        <button className="button secondary" disabled={state.busy}>
          {state.busy ? "Сохраняем…" : "Сменить пароль"}
        </button>
      </div>
    </form>
  );
}

function Devices() {
  const [sessions, setSessions] = useState(null);
  const [state, run] = useAction();
  async function load() {
    const r = await run(() => socialApi("account/sessions"));
    if (r) setSessions(r.sessions);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {!sessions && !state.error && (
        <p role="status" className="help">
          Загружаем устройства…
        </p>
      )}
      {sessions && (
        <ul className="session-list" aria-label="Устройства со входом">
          {sessions.map((s) => (
            <li key={s.id}>
              <MonitorSmartphone size={18} aria-hidden="true" />
              <span>
                <strong>{deviceName(s.userAgent)}</strong>
                {s.current && (
                  <span className="badge" data-tone="success">
                    Этот браузер
                  </span>
                )}
                <small>
                  Вход {when(s.createdAt)} · активность {when(s.lastSeenAt)}
                </small>
              </span>
              {!s.current && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={state.busy}
                  onClick={async () => {
                    if (
                      await run(() =>
                        socialApi("account/sessions/" + s.id, "DELETE"),
                      )
                    )
                      await load();
                  }}
                >
                  Завершить
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Status state={state} />
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={state.busy}
          onClick={async () => {
            if (await run(() => socialApi("account/sessions", "DELETE")))
              // New session: reload the server viewer and discard private client state.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/");
          }}
        >
          <LogOut size={16} aria-hidden="true" />
          Выйти на всех устройствах
        </button>
      </div>
    </>
  );
}

function DataExport() {
  const [state, run] = useAction();
  return (
    <>
      <Status state={state} />
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={state.busy}
          aria-busy={state.busy}
          onClick={() =>
            run(async () => {
              const response = await fetch("/api/account/export", {
                method: "POST",
                cache: "no-store",
              });
              if (!response.ok)
                throw new Error(
                  (await response.json().catch(() => ({}))).error ||
                    "Не удалось собрать выгрузку",
                );
              const name =
                /filename="([^"]+)"/.exec(
                  response.headers.get("content-disposition") || "",
                )?.[1] || "colabike-export.json";
              const url = URL.createObjectURL(await response.blob());
              const link = Object.assign(document.createElement("a"), {
                href: url,
                download: name,
              });
              document.body.append(link);
              link.click();
              link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              return true;
            }, "Файл с данными сохранён.")
          }
        >
          <Download size={16} aria-hidden="true" />
          {state.busy ? "Собираем данные…" : "Скачать мои данные"}
        </button>
      </div>
    </>
  );
}

function AccountDeletion() {
  const [state, run] = useAction();
  return (
    <form
      className="account-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        if (await run(() => socialApi("account/delete", "POST", data)))
          // New session: reload the server viewer and discard private client state.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/");
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Пароль</span>
          <input
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </label>
        <label className="field">
          <span>Введите слово УДАЛИТЬ</span>
          <input
            name="confirm"
            required
            pattern="УДАЛИТЬ"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      <Status state={state} />
      <div className="form-actions">
        <button className="button danger" disabled={state.busy}>
          <Trash2 size={16} aria-hidden="true" />
          {state.busy ? "Удаляем…" : "Удалить аккаунт навсегда"}
        </button>
      </div>
    </form>
  );
}

export default function AccountSecurity({ emailStatus }) {
  return (
    <div className="account-settings">
      <section aria-labelledby="account-email">
        <h3 id="account-email">Почта</h3>
        <p className="help">
          Адрес для входа и восстановления пароля. Другие люди его не видят.
        </p>
        <div className="account-email">{emailStatus}</div>
        <EmailChange />
      </section>
      <section aria-labelledby="account-password">
        <h3 id="account-password">Пароль</h3>
        <p className="help">
          После смены пароля на других устройствах нужно будет войти заново.
        </p>
        <PasswordChange />
      </section>
      <section aria-labelledby="account-devices">
        <h3 id="account-devices">Устройства</h3>
        <p className="help">
          Браузеры, где выполнен вход. Незнакомое устройство — завершите его
          сеанс и смените пароль.
        </p>
        <Devices />
      </section>
      <section aria-labelledby="account-export">
        <h3 id="account-export">Мои данные</h3>
        <p className="help">
          Профиль, велосипеды с компонентами, записи журнала, покатушки и
          объявления одним JSON-файлом, со ссылками на фотографии и треки.
        </p>
        <DataExport />
      </section>
      <section className="danger-zone" aria-labelledby="account-delete">
        <h3 id="account-delete">Удаление аккаунта</h3>
        <p className="help">
          Удалятся профиль, велосипеды, журнал, покатушки, объявления, подписки,
          комментарии и фотографии; там, где на ваш комментарий ответили,
          останется отметка «Комментарий недоступен». Отменить удаление нельзя —
          сначала скачайте свои данные.
        </p>
        <AccountDeletion />
      </section>
    </div>
  );
}
