"use client";
import { useEffect, useState } from "react";
import Versions from "../ui/versions.jsx";
import ResolverInspector from "./resolver-inspector.jsx";
async function request(method = "GET", body, path = "") {
  const r = await fetch("/api/admin/resolver" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Сервис недоступен");
  return data;
}
export default function ResolverSettings() {
  const [data, setData] = useState(null),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const dirty =
    !!draft && JSON.stringify(draft) !== JSON.stringify(data?.value);
  async function load() {
    setError("");
    try {
      const d = await request();
      setData(d);
      setDraft(d.value);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
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
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <section className="admin-panel">
      <h2>Bike Resolver</h2>
      <Versions />
      <ResolverInspector />
      <p className="help">
        Поиск заводской комплектации на официальных сайтах. Изменения
        применяются без перезапуска. Текущие компоненты пользователей не
        заменяются.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!draft ? (
        <button className="button secondary" onClick={load}>
          Проверить подключение
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const d = await request("PUT", {
                value: draft,
                version: data.version,
              });
              setData(d);
              setDraft(d.value);
              setNotice("Настройки сервиса сохранены");
            });
          }}
        >
          <label className="admin-toggle">
            Сервис включён
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
          </label>
          <label className="admin-toggle">
            Автопоиск при создании велосипеда
            <input
              type="checkbox"
              checked={draft.autoResolve}
              onChange={(e) => set("autoResolve", e.target.checked)}
            />
          </label>
          <label className="admin-toggle">
            Резервный поиск магазинов в интернете
            <input
              type="checkbox"
              checked={draft.retailerSearch ?? true}
              onChange={(e) => set("retailerSearch", e.target.checked)}
            />
          </label>
          <div className="admin-form-grid">
            {[
              ["timeoutMs", "Таймаут запроса, мс", 3000, 20000],
              ["requestIntervalMs", "Пауза между запросами, мс", 500, 5000],
              ["successTtlDays", "Кеш комплектации, дней", 30, 730],
              ["negativeTtlHours", "Кеш отсутствующих моделей, часов", 1, 48],
            ].map(([key, label, min, max]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  required
                  type="number"
                  min={min}
                  max={max}
                  value={draft[key]}
                  onChange={(e) => set(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <label className="admin-toggle">
            Поиск фотографий
            <input
              type="checkbox"
              checked={draft.photoSearch}
              onChange={(e) => set("photoSearch", e.target.checked)}
            />
          </label>
          <label className="field">
            <span>Запрещённые домены для ручного парсинга</span>
            <textarea
              value={(draft.blockedDomains || []).join("\n")}
              onChange={(e) =>
                set(
                  "blockedDomains",
                  e.target.value.split(/\n/).map((s) => s.trim().toLowerCase()),
                )
              }
              onBlur={() =>
                set("blockedDomains", draft.blockedDomains.filter(Boolean))
              }
            />
          </label>
          <p className="help">
            Все публичные сайты разрешены. Один запрещённый домен в строке, без
            https и пути; его поддомены тоже блокируются. Локальные сети всегда
            недоступны.
          </p>
          <h3>Адаптеры производителей</h3>
          <p className="help">
            Непроверенные источники отключены. Их можно включить для
            диагностики; отсутствие подтверждённого года не даст автоматического
            совпадения.
          </p>
          {data.brands.map((b) => (
            <div className="resolver-adapter" key={b.id}>
              <label className="admin-toggle">
                <span>
                  {b.name} <small>v{b.adapterVersion}</small>
                </span>
                <input
                  type="checkbox"
                  checked={!!draft.adapters[b.id]}
                  onChange={(e) =>
                    set("adapters", {
                      ...draft.adapters,
                      [b.id]: e.target.checked,
                    })
                  }
                />
              </label>
              {b.limitation && <p className="help">{b.limitation}</p>}
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await request("DELETE", null, "/cache?adapter=" + b.id);
                    setNotice("Кеш " + b.name + " очищен");
                  })
                }
              >
                Очистить кеш {b.name}
              </button>
            </div>
          ))}
          <div className="form-actions">
            <button className="button" disabled={busy || !dirty}>
              Сохранить настройки
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await request("DELETE", null, "/cache");
                  setNotice("Кеш комплектаций очищен");
                })
              }
            >
              Очистить весь кеш
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
