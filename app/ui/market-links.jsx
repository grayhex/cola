"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { socialApi } from "./social-primitives.jsx";
import styles from "./market.module.css";

export default function MarketLinks({ form, initial, disabled, onChange }) {
  const [query, setQuery] = useState("");
  const [models, setModels] = useState(null),
    [bikes, setBikes] = useState(null);
  const [error, setError] = useState(""),
    [bikeError, setBikeError] = useState("");
  const [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const request = useRef(0);
  const component = form.category === "components";
  const field = component ? "componentModelId" : "bikeModelId";
  const initialModel = component ? initial?.componentModel : initial?.bikeModel;
  const [selected, setSelected] = useState(initialModel);
  useEffect(() => {
    let active = true;
    setBikeError("");
    socialApi("market/owned-bikes")
      .then((r) => {
        if (active) setBikes(r.items);
      })
      .catch((e) => {
        if (active) setBikeError(e.message);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  // The parent remounts this fieldset on category changes. Late search responses
  // must not select a model from an earlier category or a closed editor.
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function search() {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const r = await socialApi(
        "market/models?" +
          new URLSearchParams({ category: form.category, q: query }),
      );
      if (request.current === id) setModels(r);
    } catch (e) {
      if (request.current === id) setError(e.message);
    } finally {
      if (request.current === id) setBusy(false);
    }
  }
  const ownBike =
    bikes?.find((b) => b.id === form.linkedBikeId) || initial?.ownedBike;
  return (
    <fieldset className={styles.photoField} disabled={disabled}>
      <legend>Связи с каталогом и гаражом</legend>
      {form.category !== "accessories" && (
        <>
          <p className="help">
            Модель необязательна. Если её нет в каталоге, заполните объявление
            вручную. Новая модель при этом не создаётся.
          </p>
          {form[field] && (
            <p>
              Выбрана модель:{" "}
              {selected ? (
                <Link href={selected.path} target="_blank">
                  {!component && selected.brand ? selected.brand + " " : ""}
                  {selected.name}
                </Link>
              ) : (
                "Сохранённая модель"
              )}
              {selected?.archived ? " · В архиве" : ""}{" "}
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  onChange(field, null);
                  setSelected(null);
                }}
              >
                Убрать модель
              </button>
            </p>
          )}
          <div className={styles.catalogSearch}>
            <label className="field">
              <span>
                Найти модель {component ? "компонента" : "велосипеда"}
              </span>
              <input
                maxLength={150}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!busy) search();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={search}
            >
              Найти модель
            </button>
          </div>
          {busy && <p role="status">Ищем модели…</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {models && (
            <label className="field">
              <span>Модель каталога</span>
              <select
                value=""
                onChange={(e) => {
                  const m = models.items.find((v) => v.id === e.target.value);
                  if (m) {
                    onChange(field, m.id);
                    setSelected(m);
                  }
                }}
              >
                <option value="">
                  {models.items.length
                    ? "Выберите модель"
                    : "Модели не найдены"}
                </option>
                {models.items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {component ? m.category + " · " : m.brand + " "}
                    {m.name}
                  </option>
                ))}
              </select>
              {models.total > models.items.length && (
                <small>
                  Показаны первые {models.items.length} моделей. Уточните поиск.
                </small>
              )}
            </label>
          )}
        </>
      )}
      <label className="field">
        <span>Мой велосипед</span>
        <select
          value={form.linkedBikeId || ""}
          onChange={(e) => onChange("linkedBikeId", e.target.value || null)}
        >
          <option value="">Без связи с велосипедом</option>
          {form.linkedBikeId &&
            !bikes?.some((b) => b.id === form.linkedBikeId) && (
              <option value={form.linkedBikeId}>
                {ownBike?.name || "Сохранённый велосипед"}
              </option>
            )}
          {bikes?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.isPublic ? "" : " · Приватный"}
            </option>
          ))}
        </select>
      </label>
      {bikeError && (
        <p role="alert">
          {bikeError}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить загрузку велосипедов
          </button>
        </p>
      )}
      <p className="help">
        Связь необязательна и не меняет видимость велосипеда. Читатели увидят
        ссылку только на ваш публичный велосипед. Название, описание, фотографии
        и цена объявления задаются отдельно.
      </p>
    </fieldset>
  );
}
