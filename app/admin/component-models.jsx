"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { socialApi, Pagination } from "../ui/social-primitives.jsx";

export default function ComponentModels() {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const [data, setData] = useState(null),
    [editing, setEditing] = useState(null),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [targetQuery, setTargetQuery] = useState(""),
    [targets, setTargets] = useState([]),
    [targetId, setTargetId] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    socialApi(
      "admin/component-models?" +
        new URLSearchParams({ q: query, page: String(page) }),
    )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [query, page, revision]);
  const field = (key, value) => setEditing((m) => ({ ...m, [key]: value }));
  async function save(merge = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const target = targets.find((t) => t.id === targetId);
      await socialApi(
        "admin/component-models/" + editing.id + (merge ? "/merge" : ""),
        merge ? "POST" : "PATCH",
        merge
          ? {
              targetId,
              version: editing.version,
              targetVersion: target.version,
            }
          : {
              name: editing.name,
              category: editing.category,
              brand: editing.brand,
              archived: editing.archived,
              version: editing.version,
            },
      );
      setEditing(null);
      setRevision((n) => n + 1);
      setMessage(
        merge
          ? "Модели объединены. Прежние ссылки сохранены."
          : "Модель сохранена. Прежние ссылки сохранены.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function findTarget() {
    setBusy(true);
    setError("");
    setTargetId("");
    setConfirmed(false);
    try {
      setTargets(
        (
          await socialApi(
            "admin/component-models?" + new URLSearchParams({ q: targetQuery }),
          )
        ).items.filter((m) => m.id !== editing.id && !m.archived),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Управление каталогом компонентов">
      <h2>Каталог компонентов</h2>
      <p className="help">
        Самостоятельные страницы моделей. Изменения сохраняются здесь сразу.
        Авторские названия деталей в гаражах и снимках журнала остаются
        прежними.
      </p>
      <form
        className="list-add"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
          setPage(1);
        }}
      >
        <input
          aria-label="Найти модель каталога"
          value={search}
          maxLength={150}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="button secondary">Найти</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!data && !error && <p role="status">Загружаем модели…</p>}
      {data && (
        <>
          {!data.items.length && <p>Модели не найдены.</p>}
          {data.items.map((m) => (
            <div className="list-row" key={m.id}>
              <div>
                <Link href={m.path}>{m.name}</Link>
                <p className="help">
                  {m.category} · {m.brand || "Бренд не указан"}
                  {m.archived ? " · В архиве" : ""}
                </p>
              </div>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => {
                  setEditing(m);
                  setTargets([]);
                  setTargetId("");
                  setTargetQuery("");
                  setConfirmed(false);
                  setMessage("");
                  setError("");
                }}
              >
                Изменить
              </button>
            </div>
          ))}
          <Pagination {...data} onPage={setPage} />
        </>
      )}
      {editing && (
        <section
          className="admin-panel"
          aria-label={"Редактирование модели " + editing.name}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <h3>Редактирование модели</h3>
            <div className="form-grid">
              <label className="field">
                <span>Название модели</span>
                <input
                  required
                  maxLength={150}
                  value={editing.name}
                  onChange={(e) => field("name", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Категория модели</span>
                <input
                  required
                  maxLength={60}
                  value={editing.category}
                  onChange={(e) => field("category", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Бренд модели</span>
                <input
                  maxLength={100}
                  value={editing.brand}
                  onChange={(e) => field("brand", e.target.value)}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.archived}
                onChange={(e) => field("archived", e.target.checked)}
              />
              Убрать из витрины (страница и связи сохранятся)
            </label>
            <div className="form-actions">
              <button className="button" disabled={busy}>
                Сохранить модель
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Отмена
              </button>
            </div>
          </form>
          <details>
            <summary>Объединить с другой моделью</summary>
            <p className="help">
              Проверьте категорию, размер и модификацию. Разные варианты нельзя
              объединять только по сходству названий. Установки и старые ссылки
              будут вести на выбранную модель.
            </p>
            <div className="list-add">
              <input
                aria-label="Поиск целевой модели"
                maxLength={150}
                value={targetQuery}
                onChange={(e) => setTargetQuery(e.target.value)}
              />
              <button
                className="button secondary"
                disabled={busy || !targetQuery.trim()}
                onClick={findTarget}
              >
                Найти для объединения
              </button>
            </div>
            <label className="field">
              <span>Сохранить модель</span>
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Выберите модель</option>
                {targets.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.category} · {m.name} · {m.brand || "без бренда"}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Проверено: это одна и та же модель и модификация
            </label>
            <button
              className="button secondary"
              disabled={busy || !targetId || !confirmed}
              onClick={() => save(true)}
            >
              Объединить модели
            </button>
          </details>
        </section>
      )}
    </section>
  );
}
