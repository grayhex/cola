"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Check, RefreshCw } from "./icons.jsx";
import { factoryComponent } from "../../lib/factory-components.js";
const messages = {
  not_found: "Комплектация не найдена. Продолжите вручную.",
  unsupported_brand: "Автозаполнение для этого производителя пока недоступно.",
  upstream_unavailable:
    "Сервис или сайт производителя недоступен. Можно заполнить вручную.",
  parse_error: "Не удалось прочитать комплектацию. Можно заполнить вручную.",
};
export default function FactorySpecification({
  bike,
  onImport,
  imported,
  automatic = false,
  onBusy,
  onReset,
}) {
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [config, setConfig] = useState(null),
    [sourceUrl, setSourceUrl] = useState("");
  const controller = useRef(),
    mounted = useRef(true),
    callbacks = useRef({ onImport, onBusy, onReset });
  callbacks.current = { onImport, onBusy, onReset };
  const valid =
    !!bike.brand?.trim() &&
    !!bike.model?.trim() &&
    Number.isInteger(Number(bike.year)) &&
    Number(bike.year) >= 1900 &&
    Number(bike.year) <= 2100;
  useEffect(() => {
    mounted.current = true;
    fetch("/api/bikes/resolver-brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (mounted.current) setConfig(c);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      controller.current?.abort();
      callbacks.current.onBusy?.(false);
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  async function find(candidateId) {
    callbacks.current.onReset?.();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setElapsed(0);
    setResult(null);
    callbacks.current.onBusy?.(true);
    try {
      const response = await fetch("/api/bikes/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: bike.brand,
          model: bike.model,
          trim: bike.trim || null,
          year: Number(bike.year),
          ...(sourceUrl ? { sourceUrl } : candidateId ? { candidateId } : {}),
        }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(95000)]),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (abort.signal.aborted || !mounted.current) return;
      if (
        data.status === "resolved" &&
        data.warnings?.includes("identity_mismatch") &&
        !window.confirm(
          `Источник: «${data.bike.canonicalName}»${data.sourceYear ? ` (${data.sourceYear})` : ""}. Вы указали «${bike.brand} ${bike.model} ${bike.trim || ""} ${bike.year}». Модель или год отличаются. Использовать эту комплектацию?`,
        )
      )
        return;
      setResult({ ...data, candidateId });
      if (data.status === "resolved" && automatic && !sourceUrl)
        callbacks.current.onImport(candidateId, true);
    } catch {
      if (!abort.signal.aborted && mounted.current)
        setResult({ status: "upstream_unavailable" });
    } finally {
      if (controller.current === abort && mounted.current) {
        setBusy(false);
        callbacks.current.onBusy?.(false);
      }
    }
  }
  useEffect(() => {
    if (!automatic || !valid || !config?.autoResolve || sourceUrl) return;
    if (
      !config.brands.some(
        (a) =>
          a.enabled && a.name.toLowerCase() === bike.brand.trim().toLowerCase(),
      )
    )
      return;
    const timer = setTimeout(() => find(), 1400);
    return () => clearTimeout(timer);
  }, [config, automatic, valid, sourceUrl]);
  const current = result?.status === "resolved" ? result : bike.factory_spec;
  return (
    <section
      className="factory-resolver"
      aria-label="Заводская комплектация"
      aria-busy={busy}
    >
      <div className="resolver-title">
        <strong>Заводская комплектация</strong>
        {!busy && (
          <button
            type="button"
            className="quiet"
            disabled={!valid}
            onClick={() => find()}
          >
            <RefreshCw size={15} />
            {current ? "Повторить" : "Найти"}
          </button>
        )}
      </div>
      <label className="field">
        <span>Ссылка на комплектацию (необязательно)</span>
        <input
          type="url"
          placeholder="https://…"
          value={sourceUrl}
          disabled={busy}
          onChange={(e) => {
            setSourceUrl(e.target.value);
            setResult(null);
            callbacks.current.onReset?.();
          }}
        />
      </label>
      {busy ? (
        <div role="status" className="resolver-progress">
          <span>
            <LoaderCircle className="resolver-spinner" size={18} />
            Парсинг комплектации… <small>{elapsed} с</small>
          </span>
          <div
            role="progressbar"
            aria-label="Загрузка комплектации"
            className="resolver-track"
          >
            <i />
          </div>
          <p className="help">
            Ищем модель на сайте производителя и читаем компоненты.
          </p>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
              callbacks.current.onBusy?.(false);
            }}
          >
            Продолжить вручную
          </button>
        </div>
      ) : (
        <div aria-live="polite">
          {!current && !result && (
            <p className="help">
              Введите марку, модель и год. Для поддерживаемых марок поиск
              начнётся автоматически.
            </p>
          )}
          {result && messages[result.status] && (
            <p className="help">{messages[result.status]}</p>
          )}
          {result?.status === "ambiguous" && (
            <>
              <p className="help">
                Уточните модель или выберите вариант с подтверждённым годом:
              </p>
              <ul className="resolver-candidates">
                {result.candidates.map((c) => (
                  <li key={c.url}>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.canonicalName}
                    </a>
                    <small>{c.year || "Год не подтверждён"}</small>
                    {c.year === Number(bike.year) && (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => find(c.candidateId)}
                      >
                        Выбрать
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result?.manualSelection && (
            <p className="help">
              Сверьте модель, год и компоненты перед импортом. Совпадение по
              ссылке не проверено автоматически.
            </p>
          )}
          {current && (
            <>
              <p className="resolver-found">
                <Check size={16} />
                {current.components.length} компонентов ·{" "}
                {current.bike.canonicalName}
              </p>
              <details>
                <summary>Посмотреть комплектацию</summary>
                <dl className="resolver-preview">
                  {current.components.map((c, i) => (
                    <div key={i}>
                      <dt>{factoryComponent(c).category}</dt>
                      <dd>{c.raw.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <p className="help">
                Источник:{" "}
                <a href={current.source.url} target="_blank" rel="noreferrer">
                  {current.source.manufacturer}
                </a>
              </p>
            </>
          )}
          {result?.status === "resolved" &&
            (imported ? (
              <p className="help">
                {automatic
                  ? "Компоненты добавятся при сохранении велосипеда."
                  : "Заводская комплектация добавится при сохранении. Ваши компоненты сохранятся."}
              </p>
            ) : (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  callbacks.current.onImport(
                    result.candidateId,
                    true,
                    sourceUrl,
                  )
                }
              >
                Импортировать при сохранении
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
