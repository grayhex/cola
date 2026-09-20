"use client";
import { useState } from "react";
import { LoaderCircle } from "./icons.jsx";
export default function PhotoSearch({ bike, onDone }) {
  const [sourceUrl, setSourceUrl] = useState(
      bike.factory_spec?.source?.url || "",
    ),
    [photos, setPhotos] = useState(null),
    [selected, setSelected] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function request(path, body) {
    const r = await fetch("/api/bikes/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Поиск недоступен");
    return d;
  }
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="photo-search">
      <h2>Фотографии велосипеда</h2>
      <p className="help">
        Поиск на сайте производителя или по ссылке на товар. Выберите 1–3 фото и
        проверьте, что на них ваша модель.
      </p>
      <label className="field">
        <span>Страница товара (необязательно)</span>
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://…"
          disabled={busy}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            setSelected([]);
            const d = await request("photo-search", {
              brand: bike.brand,
              model: bike.model,
              trim: bike.trim || null,
              year: Number(bike.year),
              ...(sourceUrl ? { sourceUrl } : {}),
            });
            setPhotos(d.photos.slice(0, 3));
          })
        }
      >
        Найти фотографии
      </button>
      {busy && (
        <div className="resolver-progress" role="status">
          <span>
            <LoaderCircle className="resolver-spinner" size={18} /> Загрузка…
          </span>
          <div
            className="resolver-track"
            role="progressbar"
            aria-label="Поиск и загрузка фотографий"
          >
            <i />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {photos?.length === 0 && (
        <p>
          Фото не найдены. Укажите ссылку на товар или загрузите свои
          фотографии.
        </p>
      )}
      <div className="photo-candidates">
        {photos?.map((p) => (
          <div key={p.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                disabled={
                  busy || (!selected.includes(p.id) && selected.length >= 3)
                }
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked
                      ? [...s, p.id]
                      : s.filter((id) => id !== p.id),
                  )
                }
              />
              <img
                src={"/api/bikes/photo-candidates/" + p.id}
                onError={() => {
                  setPhotos((a) => a.filter((x) => x.id !== p.id));
                  setSelected((a) => a.filter((id) => id !== p.id));
                }}
                alt="Фотография из каталога"
                onError={(e) => {
                  e.currentTarget.alt = "Фото недоступно";
                }}
              />
            </label>
            <a href={p.sourceUrl} target="_blank" rel="noreferrer">
              Источник
            </a>
          </div>
        ))}
      </div>
      {!!photos?.length && (
        <button
          className="button"
          type="button"
          disabled={busy || !selected.length}
          onClick={() =>
            run(async () => {
              await request(bike.id + "/photos/import", { ids: selected });
              await onDone();
            })
          }
        >
          Добавить выбранные · {selected.length}/3
        </button>
      )}
    </section>
  );
}
