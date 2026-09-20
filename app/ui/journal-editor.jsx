"use client";
import { useState, useEffect } from "react";
import { socialApi } from "./social-primitives.jsx";
import { journalKinds } from "../../lib/journal-kinds.js";
export default function JournalEditor({
  entry = null,
  bikeId,
  onSaved,
  onCancel,
}) {
  const [form, setForm] = useState({
    bikeId: entry?.bike.id || bikeId,
    kind: entry?.kind || "story",
    title: entry?.title || "",
    body: entry?.body || "",
    status: entry?.status || "draft",
    isPublic: entry?.isPublic || false,
    eventDate: entry?.eventDate || null,
    mileage: entry?.mileage ?? null,
    rideId: entry?.ride?.id || null,
    componentIds: entry?.components.map((c) => c.id) || [],
  });
  const [bike, setBike] = useState(null),
    [rides, setRides] = useState([]),
    [ridePage, setRidePage] = useState(1),
    [rideTotal, setRideTotal] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [files, setFiles] = useState([]),
    [saved, setSaved] = useState(entry);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    let active = true;
    Promise.all([
      socialApi("bikes/" + form.bikeId),
      socialApi("rides?own=1&bikeId=" + form.bikeId),
    ])
      .then(([b, r]) => {
        if (active) {
          setBike(b.bike || b);
          setRides(r.rides);
          setRidePage(1);
          setRideTotal(r.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [form.bikeId]);
  const parts = [
    ...(saved?.components || []),
    ...(bike?.components || []).filter(
      (c) => !saved?.components.some((p) => p.id === c.id),
    ),
  ];
  async function submit(status) {
    setBusy(true);
    setError("");
    let record = saved;
    try {
      const input = { ...form, status };
      if (status === "published" && (!input.title.trim() || !input.body.trim()))
        throw Error("Для публикации нужны заголовок и текст");
      // Save text first as a draft when new uploads are pending. Publication is last,
      // so a failed image never silently publishes a partial new entry.
      const r = await socialApi(
        "journal" + (record ? "/" + record.id : ""),
        record ? "PATCH" : "POST",
        { ...input, status: files.length ? "draft" : status },
      );
      record = { ...record, ...r };
      setSaved(record);
      for (const f of files) {
        const res = await fetch("/api/journal/" + r.id + "/photos", {
          method: "POST",
          headers: { "Content-Type": f.type },
          body: f,
        });
        const d = await res.json();
        if (!res.ok) throw Error(d.error);
        setFiles((a) => a.filter((x) => x !== f));
      }
      if (files.length && status === "published")
        await socialApi("journal/" + r.id, "PATCH", input);
      await onSaved(r);
    } catch (e) {
      setError(
        e.message +
          (record
            ? " Черновик/сохранённые данные доступны по ссылке ниже."
            : ""),
      );
      if (record?.shareId) {
        const d = await socialApi("journal/public/" + record.shareId).catch(
          () => null,
        );
        if (d) setSaved(d.entry);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="journal-editor"
      onSubmit={(e) => {
        e.preventDefault();
        submit("published");
      }}
    >
      <p className="help">
        Велосипед: {bike?.name || entry?.bike.name || "Загружаем…"}. Публичность
        записи не может превышать публичность велосипеда.
      </p>
      <label className="field">
        <span>Тип записи</span>
        <select
          aria-label="Тип записи"
          value={form.kind}
          onChange={(e) => set("kind", e.target.value)}
        >
          {Object.entries(journalKinds).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Заголовок записи</span>
        <input
          maxLength={160}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label className="field">
        <span>Текст записи</span>
        <textarea
          rows={9}
          maxLength={20000}
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
        />
      </label>
      <div className="journal-fields">
        <label className="field">
          <span>Дата события (необязательно)</span>
          <input
            type="date"
            value={form.eventDate || ""}
            onChange={(e) => set("eventDate", e.target.value || null)}
          />
        </label>
        <label className="field">
          <span>Пробег, км (необязательно)</span>
          <input
            type="number"
            min="0"
            max="10000000"
            step="1"
            value={form.mileage ?? ""}
            onChange={(e) =>
              set(
                "mileage",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
      </div>
      <details>
        <summary>Компоненты и покатушка (необязательно)</summary>
        <p className="help">
          Компоненты сохраняются снимком. Последующие изменения велосипеда не
          перепишут историю.
        </p>
        {parts.map((p) => (
          <label key={p.id} className="admin-toggle">
            <span>
              {p.name}
              {saved?.components.some((c) => c.id === p.id)
                ? " · сохранённый снимок"
                : ""}
            </span>
            <input
              type="checkbox"
              checked={form.componentIds.includes(p.id)}
              onChange={(e) =>
                set(
                  "componentIds",
                  e.target.checked
                    ? [...form.componentIds, p.id]
                    : form.componentIds.filter((id) => id !== p.id),
                )
              }
            />
          </label>
        ))}
        <label className="field">
          <span>Покатушка этого велосипеда</span>
          <select
            aria-label="Покатушка этого велосипеда"
            value={form.rideId || ""}
            onChange={(e) => set("rideId", e.target.value || null)}
          >
            <option value="">Без покатушки</option>
            {rides.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
            {entry?.ride && !rides.some((r) => r.id === entry.ride.id) && (
              <option value={entry.ride.id}>{entry.ride.title}</option>
            )}
          </select>
        </label>
        {rides.length < rideTotal && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await socialApi(
                  "rides?own=1&bikeId=" +
                    form.bikeId +
                    "&page=" +
                    (ridePage + 1),
                );
                setRides((a) => [
                  ...a,
                  ...r.rides.filter((x) => !a.some((y) => y.id === x.id)),
                ]);
                setRidePage(r.page);
                setRideTotal(r.total);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Загрузить ещё покатушки
          </button>
        )}
        <p className="help">
          Покатушки остаются отдельными GPX-маршрутами, без фотогалереи.
        </p>
      </details>
      <label className="field">
        <span>Фотографии записи (до 8, JPEG / PNG / WebP, до 10 МБ)</span>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            const next = [...e.target.files];
            if (
              next.some((f) => f.size > 10 * 1024 * 1024) ||
              next.length + (saved?.photos?.length || 0) > 8
            ) {
              setError("До 8 фотографий, не больше 10 МБ каждая");
              return;
            }
            setFiles(next);
            setError("");
          }}
        />
      </label>
      {!!files.length && (
        <p className="help">
          К загрузке: {files.map((f) => f.name).join(", ")}
        </p>
      )}
      <div className="journal-photos">
        {saved?.photos?.map((p) => (
          <figure key={p.id}>
            <img src={p.url} alt="Фотография записи" />
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await socialApi(
                    "journal/" + saved.id + "/photos/" + p.id,
                    "DELETE",
                  );
                  setSaved((s) => ({
                    ...s,
                    photos: s.photos.filter((x) => x.id !== p.id),
                  }));
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Удалить фото
            </button>
          </figure>
        ))}
      </div>
      <label className="admin-toggle">
        <span>Публичная запись</span>
        <input
          type="checkbox"
          checked={form.isPublic}
          onChange={(e) => set("isPublic", e.target.checked)}
        />
      </label>
      <p className="help">
        Без галочки запись доступна только вам, даже после публикации. На
        приватном велосипеде любая запись видна только владельцу.
      </p>
      {error && <p role="alert">{error}</p>}
      {saved?.shareId && (
        <a href={"/j/" + saved.shareId}>Открыть сохранённую запись</a>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => submit("draft")}
        >
          Сохранить черновик
        </button>
        <button className="button" disabled={busy}>
          {entry?.status === "published"
            ? "Сохранить запись"
            : "Опубликовать запись"}
        </button>
        {onCancel && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onCancel}
          >
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}
