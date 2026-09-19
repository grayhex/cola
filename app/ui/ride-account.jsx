"use client";
import { useEffect, useState } from "react";
import { socialApi, Pagination } from "./social-primitives.jsx";
import RideCard, { RideRoutePreview, RideMetrics } from "./ride-card.jsx";
export default function RideAccount({ bikes }) {
  const [data, setData] = useState(null),
    [config, setConfig] = useState(null),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState(null),
    [editing, setEditing] = useState(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [form, setForm] = useState({
      bikeId: "",
      title: "",
      description: "",
      isPublic: false,
      privacyEnabled: false,
      privacyRadiusM: 500,
    });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const refresh = () => socialApi("rides?own=1&page=" + page).then(setData);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    socialApi("rides/settings")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, [page]);
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      if (file.size > (config?.maxGpxBytes || 10485760))
        throw Error("GPX-файл слишком большой");
      const r = await fetch("/api/rides/preview", {
        method: "POST",
        headers: { "Content-Type": "application/gpx+xml" },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setPreview(d);
      set("title", d.title);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(r) {
    setEditing(r);
    setPreview(null);
    setForm({
      bikeId: r.bike.id,
      title: r.title,
      description: r.description,
      isPublic: r.isPublic,
      privacyEnabled: r.privacyEnabled,
      privacyRadiusM: r.privacyRadiusM,
    });
    setOpen(true);
    setError("");
  }
  const selected = bikes.find((b) => b.id === form.bikeId),
    cannotPublish = form.isPublic && !selected?.is_public;
  return (
    <section>
      <div className="section-heading">
        <h2>Покатушки</h2>
        <button
          className="button small"
          disabled={busy || !config?.enabled || !bikes.length}
          onClick={() => {
            setEditing(null);
            setPreview(null);
            setForm({
              bikeId: bikes[0]?.id || "",
              title: "",
              description: "",
              isPublic: false,
              privacyEnabled: false,
              privacyRadiusM: config.defaultRadius,
            });
            setOpen(true);
            setError("");
          }}
        >
          Добавить покатушку
        </button>
      </div>
      {!bikes.length && <p className="help">Сначала добавьте велосипед.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {open && (
        <form
          className="ride-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await socialApi(
                "rides" + (editing ? "/" + editing.id : ""),
                editing ? "PATCH" : "POST",
                {
                  ...form,
                  ...(!editing ? { previewId: preview.previewId } : {}),
                },
              );
              setOpen(false);
              setPreview(null);
              await refresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!editing && (
            <label
              className="ride-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) upload(e.dataTransfer.files[0]);
              }}
            >
              GPX-файл
              <input
                type="file"
                accept=".gpx,application/gpx+xml"
                disabled={busy}
                onChange={(e) => upload(e.target.files[0])}
              />
              <small>
                Выберите файл или перетащите его сюда · до{" "}
                {Math.round((config?.maxGpxBytes || 10485760) / 1048576)} МБ
              </small>
            </label>
          )}
          {busy && <p role="status">Обрабатываем…</p>}
          {(preview || editing) && (
            <>
              <RideRoutePreview geometry={(preview || editing).geometry} />
              <RideMetrics metrics={(preview || editing).metrics} />
              {preview && (
                <p className="help">
                  {preview.metrics.startedAt
                    ? new Date(preview.metrics.startedAt).toLocaleString(
                        "ru-RU",
                      )
                    : "В файле нет времени"}{" "}
                  · {preview.metrics.pointCount} точек
                </p>
              )}
              <label className="field">
                <span>Велосипед</span>
                <select
                  required
                  value={form.bikeId}
                  onChange={(e) => set("bikeId", e.target.value)}
                >
                  {bikes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {!b.is_public ? " · приватный" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Название</span>
                <input
                  required
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Описание — необязательно</span>
                <textarea
                  maxLength={3000}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </label>
              <label className="ride-toggle">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(e) => set("isPublic", e.target.checked)}
                />
                Опубликовать
              </label>
              {cannotPublish && (
                <p role="alert">
                  Сначала опубликуйте велосипед или сохраните покатушку
                  приватной.
                </p>
              )}
              <label className="ride-toggle">
                <input
                  type="checkbox"
                  checked={form.privacyEnabled}
                  onChange={(e) => set("privacyEnabled", e.target.checked)}
                />
                Скрыть начало и конец маршрута
              </label>
              {form.privacyEnabled && (
                <label className="field">
                  <span>Радиус приватности</span>
                  <select
                    value={form.privacyRadiusM}
                    onChange={(e) =>
                      set("privacyRadiusM", Number(e.target.value))
                    }
                  >
                    {(config?.privacyRadii || [300, 500, 1000]).map((r) => (
                      <option key={r} value={r}>
                        {r} м
                      </option>
                    ))}
                  </select>
                  <small>
                    На публичной карте будут скрыты все участки внутри зон
                    начала и конца. Метрики остаются полными.
                  </small>
                </label>
              )}
              <button className="button" disabled={busy || cannotPublish}>
                Сохранить покатушку
              </button>
              {editing && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm("Удалить покатушку и её обсуждение?")) return;
                    setBusy(true);
                    try {
                      await socialApi("rides/" + editing.id, "DELETE");
                      setOpen(false);
                      await refresh();
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Удалить покатушку
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Отмена
          </button>
        </form>
      )}
      {data && (
        <>
          <div className="ride-grid">
            {data.rides.map((r) => (
              <RideCard key={r.id} ride={r} owner onEdit={edit} />
            ))}
          </div>
          {!data.rides.length && !open && (
            <p className="help">
              Загрузите GPX и расскажите, где побывал ваш велосипед.
            </p>
          )}
          <Pagination {...data} onPage={setPage} />
        </>
      )}
    </section>
  );
}
