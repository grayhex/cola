"use client";
import { useState } from "react";
import { socialApi } from "./social-primitives.jsx";
import {
  garminFields,
  defaultRideFields,
  formatRideMetric,
} from "../../lib/garmin-fields.js";
import { RideMetrics } from "./ride-card.jsx";
export default function GarminImport({ bikes, onDone, onCancel }) {
  const [csv, setCsv] = useState(""),
    [data, setData] = useState(null),
    [selected, setSelected] = useState([]),
    [fields, setFields] = useState(defaultRideFields),
    [bikeId, setBikeId] = useState(bikes[0]?.id || ""),
    [isPublic, setPublic] = useState(false),
    [utcOffsetMinutes, setOffset] = useState(-new Date().getTimezoneOffset()),
    [units, setUnits] = useState("metric"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function preview(text = csv) {
    setBusy(true);
    setError("");
    setData(null);
    try {
      const result = await socialApi("rides/csv-preview", "POST", {
        csv: text,
        utcOffsetMinutes,
        units,
      });
      setData(result);
      setSelected(result.rides.map((r) => r.index));
      setFields(
        defaultRideFields.filter((k) => result.availableFields.includes(k)),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (value, list, setter) =>
    setter(
      list.includes(value) ? list.filter((k) => k !== value) : [...list, value],
    );
  return (
    <section className="ride-form" aria-label="Импорт Garmin CSV">
      <h2>Импорт из Garmin</h2>
      <p className="help">
        Выберите CSV из Garmin Connect. Поездки сохранятся без треков — трек
        (GPX, FIT или TCX) можно добавить позже. Повторные строки будут
        пропущены.
      </p>
      <div className="ride-form-grid">
        <label className="field">
          <span>Единицы в выгрузке</span>
          <select
            disabled={busy}
            value={units}
            onChange={(e) => {
              setUnits(e.target.value);
              setData(null);
            }}
          >
            <option value="metric">Километры, метры, °C</option>
            <option value="imperial">Мили, футы, °F</option>
          </select>
        </label>
        <label className="field">
          <span>Часовой пояс дат в CSV</span>
          <select
            disabled={busy}
            value={utcOffsetMinutes}
            onChange={(e) => {
              setOffset(Number(e.target.value));
              setData(null);
            }}
          >
            {Array.from({ length: 105 }, (_, i) => -720 + i * 15).map((v) => (
              <option key={v} value={v}>
                UTC{v >= 0 ? "+" : "−"}
                {String(Math.floor(Math.abs(v) / 60)).padStart(2, "0")}:
                {String(Math.abs(v) % 60).padStart(2, "0")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="ride-drop">
        CSV Garmin
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > 2 * 1024 * 1024) {
              setError("CSV: максимум 2 МБ");
              return;
            }
            const text = await f.text();
            setCsv(text);
            await preview(text);
          }}
        />
        <small>До 500 активностей · 2 МБ</small>
      </label>
      {csv && !data && (
        <button className="quiet" disabled={busy} onClick={() => preview()}>
          Обновить предпросмотр
        </button>
      )}
      {busy && <p role="status">Обрабатываем CSV…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <label className="field">
            <span>Велосипед для поездок</span>
            <select value={bikeId} onChange={(e) => setBikeId(e.target.value)}>
              {bikes.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                  {b.is_public ? "" : " · приватный"}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="metric-picker">
            <legend>Какие показатели показывать</legend>
            <div>
              {garminFields
                .filter((f) => data.availableFields.includes(f.key))
                .map((f) => (
                  <label key={f.key}>
                    <input
                      type="checkbox"
                      checked={fields.includes(f.key)}
                      onChange={() => toggle(f.key, fields, setFields)}
                    />
                    {f.label}
                  </label>
                ))}
            </div>
          </fieldset>
          <details className="ride-import-preview">
            <summary>Пример карточки с выбранными полями</summary>
            <RideMetrics
              metrics={data.rides[0].metrics}
              visibleMetrics={fields}
            />
          </details>
          <div className="section-heading">
            <strong>
              Поездки · {selected.length} из {data.rides.length}
            </strong>
            <button
              className="quiet"
              onClick={() =>
                setSelected(
                  selected.length === data.rides.length
                    ? []
                    : data.rides.map((r) => r.index),
                )
              }
            >
              {selected.length === data.rides.length
                ? "Снять выбор"
                : "Выбрать все"}
            </button>
          </div>
          <div className="csv-ride-list">
            {data.rides.map((r) => (
              <label key={r.index}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.index)}
                  onChange={() => toggle(r.index, selected, setSelected)}
                />
                <span>
                  <strong>{r.title}</strong>
                  <small>
                    {new Date(r.startedAt).toLocaleString("ru-RU")} ·{" "}
                    {formatRideMetric(r.metrics.distanceM, "distance")} ·{" "}
                    {formatRideMetric(r.metrics.timerTimeS, "duration")}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {data.warnings.map((w) => (
            <p className="help" key={w}>
              {w}
            </p>
          ))}
          <label className="ride-toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setPublic(e.target.checked)}
            />
            Опубликовать поездки
          </label>
          {isPublic && !bikes.find((b) => b.id === bikeId)?.is_public && (
            <p role="alert">
              Сначала опубликуйте велосипед или импортируйте приватно.
            </p>
          )}
          <button
            className="button"
            disabled={
              busy ||
              !selected.length ||
              !bikeId ||
              (isPublic && !bikes.find((b) => b.id === bikeId)?.is_public)
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await socialApi("rides/import", "POST", {
                  csv,
                  utcOffsetMinutes,
                  units,
                  bikeId,
                  isPublic,
                  selected,
                  visibleMetrics: fields,
                });
                await onDone(result);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Импортировать · {selected.length}
          </button>
        </>
      )}
      <button
        type="button"
        className="quiet"
        disabled={busy}
        onClick={onCancel}
      >
        Отмена
      </button>
    </section>
  );
}
