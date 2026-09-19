"use client";
import { useEffect, useRef, useState } from "react";
import { resolveWithTrace } from "../../lib/resolver-stream.js";
import ResolverTimeline from "../ui/resolver-timeline.jsx";
export default function ResolverInspector() {
  const [query, setQuery] = useState({
      brand: "",
      model: "",
      trim: "",
      year: "",
      sourceUrl: "",
    }),
    [events, setEvents] = useState([]),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [health, setHealth] = useState(null);
  const active = useRef();
  async function diagnostics() {
    try {
      const r = await fetch("/api/admin/resolver/diagnostics");
      if (r.ok) setHealth(await r.json());
    } catch {}
  }
  useEffect(() => {
    diagnostics();
    return () => active.current?.abort();
  }, []);
  async function inspect(e) {
    e.preventDefault();
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setEvents([]);
    setResult(null);
    setError("");
    setBusy(true);
    try {
      const data = await resolveWithTrace(
        {
          ...query,
          year: Number(query.year),
          trim: query.trim || null,
          ...(!query.sourceUrl ? { sourceUrl: undefined } : {}),
        },
        controller.signal,
        (event) => setEvents((v) => [...v, event]),
        "/api/admin/resolver/inspect",
      );
      if (!controller.signal.aborted) setResult(data);
    } catch {
      if (!controller.signal.aborted)
        setError("Диагностика недоступна. Повторите запрос.");
    } finally {
      if (active.current === controller) {
        setBusy(false);
        diagnostics();
      }
    }
  }
  return (
    <details className="resolver-inspector">
      <summary>Диагностика парсера</summary>
      <form onSubmit={inspect}>
        <div className="admin-form-grid">
          {[
            ["brand", "Производитель"],
            ["model", "Модель"],
            ["trim", "Комплектация"],
            ["year", "Год"],
            ["sourceUrl", "Ссылка на страницу"],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                value={query[key]}
                type={
                  key === "year"
                    ? "number"
                    : key === "sourceUrl"
                      ? "url"
                      : "text"
                }
                min={key === "year" ? 1900 : undefined}
                max={key === "year" ? 2100 : undefined}
                required={["brand", "model", "year"].includes(key)}
                maxLength={key === "sourceUrl" ? 2048 : 100}
                onChange={(e) => setQuery({ ...query, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <button className="button secondary" disabled={busy}>
          Проверить комплектацию
        </button>
        {busy && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              active.current?.abort();
              setBusy(false);
            }}
          >
            Остановить
          </button>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
      <ResolverTimeline events={events} running={busy} />
      {result && (
        <div>
          <p role="status">
            {result.status} · {result.reason || result.quality?.level || ""}
          </p>
          {result.source && (
            <p>
              <a href={result.source.url} target="_blank" rel="noreferrer">
                {result.source.manufacturer} · {result.bike.canonicalName}
              </a>
            </p>
          )}
          <p>
            {result.quality?.recognizedComponents || 0} компонентов /{" "}
            {result.quality?.totalFields || 0} полей ·{" "}
            {result.quality?.strategies?.join(", ")}
          </p>
          {!!result.warnings?.length && (
            <p>Проверить: {result.warnings.join(", ")}</p>
          )}
          <details>
            <summary>Оригинальные характеристики</summary>
            <dl>
              {Object.entries(result.rawSpecification || {}).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
          <details>
            <summary>Нормализованные компоненты</summary>
            <dl>
              {(result.components || []).map((c, i) => (
                <div key={i}>
                  <dt>{c.type}</dt>
                  <dd>
                    {c.description || c.raw.value} · {c.provenance?.strategy}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          <details>
            <summary>Неизвестные поля и расхождения</summary>
            <dl>
              {(result.unknownFields || []).map((f, i) => (
                <div key={i}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      )}
      {health && (
        <details>
          <summary>
            Последние проверки · extractor v{health.extractorVersion}
          </summary>
          <p className="help">
            История с запуска сервиса. Перезапуск очищает эти показатели.
          </p>
          <dl>
            {Object.entries(health.sources).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  Успех: {value.lastSuccess || "—"} · Ошибка:{" "}
                  {value.lastFailure || "—"} · {value.reason || "—"} ·{" "}
                  {value.durationMs} мс
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </details>
  );
}
