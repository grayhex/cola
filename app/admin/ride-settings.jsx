"use client";
import { useEffect, useState } from "react";
import { socialApi } from "../ui/social-primitives.jsx";
export default function RideSettings() {
  const [v, setV] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    socialApi("rides/settings")
      .then(setV)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section>
      <h2>Покатушки</h2>
      {error && <p role="alert">{error}</p>}
      {v && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setSaved(false);
            setError("");
            try {
              setV(await socialApi("rides/settings", "PATCH", v));
              setSaved(true);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="ride-toggle">
            <input
              type="checkbox"
              checked={v.enabled}
              onChange={(e) => setV({ ...v, enabled: e.target.checked })}
            />
            Разрешить загрузку покатушек
          </label>
          {[
            ["maxGpxBytes", "Размер GPX, байт"],
            ["maxPoints", "Точек в GPX"],
            ["maxRides", "Покатушек на пользователя"],
            ["uploadRate", "Загрузок за 15 минут"],
            ["defaultRadius", "Радиус приватности по умолчанию, м"],
          ].map(([k, label]) => (
            <label className="field" key={k}>
              <span>{label}</span>
              <input
                type="number"
                min="1"
                required
                value={v[k]}
                onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="field">
            <span>Радиусы приватности, м — через запятую</span>
            <input
              value={v.privacyRadii.join(",")}
              onChange={(e) =>
                setV({
                  ...v,
                  privacyRadii: e.target.value.split(",").map(Number),
                })
              }
            />
          </label>
          <button className="button" disabled={busy}>
            Сохранить
          </button>
          {saved && <p role="status">Сохранено</p>}
        </form>
      )}
    </section>
  );
}
