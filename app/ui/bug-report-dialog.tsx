"use client";
import { useEffect, useRef, useState } from "react";
import Modal from "./garage/modal.tsx";
import { useSite } from "./site-provider.tsx";
import { useConfirmation } from "./confirmation.tsx";
import { socialApi } from "./social-primitives.tsx";
import type { BugReportInput } from "../../lib/bug-reports.ts";
import { errorMessage, errorStatus } from "../../lib/errors.ts";

function diagnostics(): BugReportInput["diagnostics"] {
  const match = navigator.userAgent.match(
    /(Firefox|Edg|Chrome|Version)\/([\d.]+)/,
  );
  return {
    path: window.location.pathname.slice(0, 500),
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    width: window.innerWidth,
    height: window.innerHeight,
    browser: match
      ? `${match[1] === "Version" ? "Safari" : match[1]} ${match[2]}`
      : "Other",
  };
}
export default function BugReportDialog({ onClose }: { onClose: () => void }) {
  const { viewer } = useSite();
  const [description, setDescription] = useState("");
  const [reproduction, setReproduction] = useState("");
  const [contact, setContact] = useState(viewer?.email || "");
  const [details] = useState(diagnostics);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const running = useRef(false);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    descriptionInput.current?.focus();
  }, []);
  const [ask, confirmation] = useConfirmation();
  async function close() {
    if (running.current) return;
    if (
      !sent &&
      (description || reproduction) &&
      !(await ask(
        "Закрыть сообщение без отправки? Введённый текст будет потерян.",
      ))
    )
      return;
    onClose();
  }
  return (
    <Modal
      title="Сообщить об ошибке"
      onClose={() => void close()}
      dismissible={!busy}
    >
      {sent ? (
        <div className="notice" role="status">
          <div>
            <p>Почтовый сервер принял сообщение для владельца сайта.</p>
            <p className="help">
              Номер отчёта: {sent}. Это не подтверждение доставки во входящие
              или прочтения.
            </p>
            <div className="form-actions">
              <button type="button" className="button" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (running.current) return;
            running.current = true;
            setBusy(true);
            setError("");
            try {
              const result = await socialApi<{ id: string }>(
                "bug-reports",
                "POST",
                {
                  description,
                  reproduction,
                  contact: contact.trim(),
                  diagnostics: details,
                } satisfies BugReportInput,
              );
              setSent(result.id);
            } catch (failure) {
              setError(
                (errorStatus(failure) ? errorMessage(failure) : "") ||
                  "Не удалось подтвердить отправку. Текст сохранён — попробуйте позже.",
              );
            } finally {
              running.current = false;
              setBusy(false);
            }
          }}
        >
          <p>
            Сообщение уйдёт владельцу сайта. Не добавляйте пароли, секреты или
            чужие личные данные.
          </p>
          <fieldset disabled={busy} className="form-grid">
            <label className="field full">
              <span>Что произошло?</span>
              <textarea
                ref={descriptionInput}
                required
                rows={4}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="field full">
              <span>Как повторить / что ожидали?</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={reproduction}
                onChange={(e) => setReproduction(e.target.value)}
              />
            </label>
            <label className="field full">
              <span>Email для ответа</span>
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </label>
            <p className="help full">
              Необязательно. Оставьте поле пустым, если ответ не нужен.
            </p>
          </fieldset>
          <details>
            <summary>Какая диагностика будет приложена</summary>
            <dl className="kv">
              <div>
                <dt>Страница</dt>
                <dd>{details.path}</dd>
              </div>
              <div>
                <dt>Тема</dt>
                <dd>{details.theme === "dark" ? "Тёмная" : "Светлая"}</dd>
              </div>
              <div>
                <dt>Экран</dt>
                <dd>
                  {details.width} × {details.height}
                </dd>
              </div>
              <div>
                <dt>Браузер</dt>
                <dd>{details.browser}</dd>
              </div>
            </dl>
            <p className="help">
              Сервер добавит время, сборку, номера отчёта и запроса
              {viewer ? ", идентификатор вашего аккаунта" : ""}. Содержимое
              других форм, cookies, хранилище браузера, координаты и переписка
              не собираются.
            </p>
          </details>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="button" disabled={busy} aria-busy={busy}>
              {busy ? "Отправляем…" : "Отправить сообщение"}
            </button>
          </div>
        </form>
      )}
      {confirmation}
    </Modal>
  );
}
