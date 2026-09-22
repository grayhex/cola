"use client";
import { useConfirmation } from "../ui/confirmation.jsx";
import { useEffect, useRef, useState } from "react";
import PromptComposer from "../ui/prompt-composer.jsx";
import { SectionTabs } from "./design-controls.jsx";
import styles from "./legal-settings.module.css";
const titles = {
  terms: "Пользовательское соглашение",
  privacy: "Политика обработки персональных данных",
};
export default function LegalSettings({ active }) {
  const [ask, confirmation] = useConfirmation();
  const [documents, setDocuments] = useState(null),
    [saved, setSaved] = useState(null);
  const [kind, setKind] = useState("terms"),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    loading = useRef(false);
  const dirty =
    documents && JSON.stringify(documents) !== JSON.stringify(saved);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function reload() {
    if (
      loading.current ||
      (dirty &&
        !(await ask(
          "Отменить несохранённые изменения документов и загрузить опубликованные данные?",
        )))
    )
      return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/legal", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (alive.current) {
        const items = Object.fromEntries(
          result.documents.map((d) => [d.kind, d]),
        );
        setDocuments(items);
        setSaved(items);
      }
    } catch (e) {
      if (alive.current)
        setError(e.message || "Не удалось загрузить документы");
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (active && !documents && !loading.current) reload();
  }, [active]);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function setBody(body) {
    setDocuments((d) => ({ ...d, [kind]: { ...d[kind], body } }));
    setNotice("");
  }
  async function save(publish) {
    if (busy) return;
    if (
      publish &&
      !(await ask(
        "Опубликовать эту редакцию? Она станет обязательной для новых регистраций; прежние принятые версии сохранятся.",
      ))
    )
      return;
    const doc = documents[kind];
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/legal", {
        method: publish ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, body: doc.body, version: doc.version }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось сохранить документ.");
      if (alive.current) {
        setDocuments((d) => ({ ...d, [kind]: result.document }));
        setSaved((d) => ({ ...d, [kind]: result.document }));
        setNotice(
          publish
            ? "Документ опубликован. Новые регистрации принимают эту редакцию."
            : "Черновик сохранён. Публичная редакция не изменена.",
        );
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className={"admin-panel " + styles.panel}
      aria-label="Документы сайта"
    >
      {confirmation}
      <div className={styles.heading}>
        <h2>Документы сайта</h2>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={reload}
        >
          Обновить документы
        </button>
      </div>
      <p className="help">
        Загрузите свой текст в UTF-8 (.txt или .md) либо введите его в редактор.
        Черновики не видны посетителям. Для регистрации должны быть опубликованы
        оба документа.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!documents ? (
        <p>
          {busy
            ? "Загружаем документы…"
            : "Данные недоступны. Нажмите «Обновить документы»."}
        </p>
      ) : (
        <>
          {(!documents.terms.published || !documents.privacy.published) && (
            <p className={styles.warning}>
              Регистрация заблокирована до первой публикации соглашения и
              политики. Тестовые или готовые юридические тексты автоматически не
              подставляются.
            </p>
          )}
          <SectionTabs
            label="Юридические документы"
            items={[
              ["terms", "Соглашение"],
              ["privacy", "Персональные данные"],
            ]}
            value={kind}
            onChange={(next) => {
              if (!busy) {
                setKind(next);
                setNotice("");
                setError("");
              }
            }}
          >
            {() => (
              <>
                <h3>{titles[kind]}</h3>
                <div className={styles.heading}>
                  <p className="help">
                    {documents[kind].published
                      ? `Опубликована редакция ${documents[kind].published.revision}`
                      : "Не опубликован"}{" "}
                    · Версия черновика {documents[kind].version}
                  </p>
                  {documents[kind].published && (
                    <a
                      href={documents[kind].published.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть опубликованную редакцию
                    </a>
                  )}
                </div>
                <label className={styles.upload}>
                  Загрузить текст (.txt, .md, до 1 МБ)
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    disabled={busy}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (
                        documents[kind].body &&
                        !(await ask(
                          "Заменить текст в редакторе содержимым файла?",
                        ))
                      )
                        return;
                      setBusy(true);
                      setError("");
                      try {
                        if (
                          file.size > 1024 * 1024 ||
                          !/\.(txt|md)$/i.test(file.name)
                        )
                          throw new Error("Выберите .txt или .md до 1 МБ.");
                        const text = new TextDecoder("utf-8", { fatal: true })
                          .decode(await file.arrayBuffer())
                          .replace(/^\uFEFF/, "");
                        if (text.length > 200000 || text.includes("\0"))
                          throw new Error(
                            "Максимум 200 000 символов. Файл должен содержать текст UTF-8.",
                          );
                        if (alive.current) {
                          setBody(text);
                          setNotice(
                            "Текст загружен в черновик. Проверьте оформление перед публикацией.",
                          );
                        }
                      } catch (e) {
                        if (alive.current)
                          setError(
                            e.message || "Не удалось прочитать UTF-8 текст.",
                          );
                      } finally {
                        if (alive.current) setBusy(false);
                      }
                    }}
                  />
                </label>
                <PromptComposer
                  key={kind}
                  label={titles[kind]}
                  value={documents[kind].body}
                  onChange={setBody}
                  maxLength={200000}
                  rows={18}
                  disabled={busy}
                  placeholder="Введите текст документа…"
                />
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || documents[kind].body === saved[kind].body}
                    onClick={() => save(false)}
                  >
                    Сохранить черновик документа
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy || !documents[kind].body.trim()}
                    onClick={() => save(true)}
                  >
                    Опубликовать документ
                  </button>
                  <small>
                    {documents[kind].body !== saved[kind].body
                      ? "Есть несохранённые изменения"
                      : "Черновик сохранён"}
                  </small>
                </div>
              </>
            )}
          </SectionTabs>
        </>
      )}
    </section>
  );
}
