"use client";
import EmailPolicyAction from "./email-policy-action.jsx";
import SiteIcon from "./site-icon.jsx";
import RideCreationActions from "./ride-creation-actions.jsx";
import { selectableRideBikes, rideBikeStateError } from "../../lib/bike-status.js";
import { useCallback, useMemo, useEffect, useState, useRef } from "react";
import { socialApi, Pagination } from "./social-primitives.jsx";
import RideCard, { RideRoutePreview, RideMetrics } from "./ride-card.jsx";
import GarminImport from "./garmin-import.jsx";
import { garminFields, defaultRideFields } from "../../lib/garmin-fields.js";
const blank = {
  bikeId: "",
  title: "",
  description: "",
  isPublic: false,
  privacyEnabled: false,
  privacyRadiusM: 500,
  scheduledAt: "",
  features: "",
  meetingPoint: "",
  invitations: "",
  recurrence: "none",
  recurrenceTimezone: "Europe/Moscow",
};
const localDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const trackFiles =
  ".gpx,.fit,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml";
// Every track has these; only sensors or Garmin CSV add something to choose.
const trackMetrics = [
  "distanceM",
  "elapsedTimeS",
  "movingTimeS",
  "avgSpeedMps",
  "elevationGainM",
];
// Where to find the FIT file; menu names differ between app versions.
function FitHelp() {
  return (
    <details className="fit-help">
      <summary>Как выгрузить FIT с велокомпьютера</summary>
      <ul>
        <li>
          Garmin Connect: откройте занятие, в меню-шестерёнке выберите «Экспорт
          оригинала» и распакуйте ZIP.
        </li>
        <li>Strava на сайте: занятие → «…» → «Экспорт оригинала».</li>
        <li>
          Magene, Bryton, Wahoo, iGPSport, Coros: в приложении откройте
          тренировку и найдите экспорт или «Поделиться» файлом FIT.
        </li>
        <li>
          По USB многие велокомпьютеры показывают файлы тренировок, у Garmin —
          в папке Garmin/Activity.
        </li>
      </ul>
      <p>Названия пунктов меню зависят от версии приложения.</p>
    </details>
  );
}
export default function RideAccount({ bikes }) {
  const [data, setData] = useState(null),
    [config, setConfig] = useState(null),
    [page, setPage] = useState(1),
    [preview, setPreview] = useState(null),
    [editing, setEditing] = useState(null),
    [mode, setMode] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState(blank),
    [visibleMetrics, setVisibleMetrics] = useState(null);
  const currentBikes = useMemo(() => selectableRideBikes(bikes), [bikes]);
  const rideBikes = selectableRideBikes(bikes, editing?.bike?.id);
  const autoOpened = useRef(false);
  // Garmin CSV and FIT/TCX sensors bring extra metrics; the owner picks which
  // of them the ride shows. Heart rate and power stay hidden until chosen.
  const metricSource = mode === "plan" ? null : preview || editing,
    shownMetrics = visibleMetrics || defaultRideFields,
    pickable = garminFields.filter(
      (f) => metricSource?.metrics[f.key] != null,
    );
  const offersPicker =
    editing?.sourceKind === "garmin" ||
    pickable.some((f) => !trackMetrics.includes(f.key));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const requests = useRef({ revision: 0 });
  const refresh = useCallback(async () => {
    const revision = ++requests.current.revision;
    try {
      const result = await socialApi("rides?own=1&page=" + page);
      if (revision === requests.current.revision) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (revision === requests.current.revision) setError(e.message);
    }
  }, [page]);
  const start = useCallback(
    (next) => {
      if (!currentBikes.length) return;
      setEditing(null);
      setPreview(null);
      setMode(next);
      setError("");
      setNotice("");
      setVisibleMetrics(null);
      setForm({
        ...blank,
        recurrenceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        bikeId: currentBikes[0]?.id || "",
        privacyRadiusM: config?.defaultRadius || 500,
      });
    },
    [currentBikes, config?.defaultRadius],
  );
  useEffect(() => {
    const pending = requests.current;
    void refresh();
    return () => {
      pending.revision++;
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    socialApi("rides/settings")
      .then((result) => {
        if (active) setConfig(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (autoOpened.current || !config?.enabled || !currentBikes.length) return;
    autoOpened.current = true;
    const action = new URLSearchParams(location.search).get("action");
    if (["add", "plan", "import"].includes(action)) start(action);
  }, [config?.enabled, currentBikes.length, start]);
  async function upload(file, attach = false) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (!attach && !currentBikes.length)
        throw Error("Для новой покатушки выберите текущий велосипед.");
      if (file.size > config.maxGpxBytes)
        throw Error("Файл слишком большой");
      const r = await fetch(
        "/api/rides/" +
          (attach
            ? editing.id + "/track"
            : "preview" + (mode === "plan" ? "?purpose=plan" : "")),
        {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (attach) {
        const detail = await socialApi("rides/owner/" + editing.shareId);
        setEditing(detail.ride);
        setNotice("Трек проверен и добавлен.");
        await refresh();
      } else {
        setPreview(d);
        if (!form.title) set("title", d.title);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function edit(r) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { ride } = await socialApi("rides/owner/" + r.shareId);
      setEditing(ride);
      setPreview(null);
      setVisibleMetrics(ride.visibleMetrics);
      setMode(ride.status === "completed" ? "add" : "plan");
      setForm({
        bikeId: ride.bike.id,
        title: ride.title,
        description: ride.description,
        isPublic: ride.isPublic,
        privacyEnabled: ride.privacyEnabled,
        privacyRadiusM: ride.privacyRadiusM,
        scheduledAt: localDate(ride.startedAt || ride.scheduledAt),
        recurrence: ride.recurrence,
        recurrenceTimezone: ride.recurrenceTimezone,
        features: ride.features.join(", "),
        meetingPoint: ride.meetingPoint,
        invitations: ride.invitations.map((i) => i.username).join(", "),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const selectedBike = rideBikes.find((b) => b.id === form.bikeId);
  const cannotPublish = form.isPublic && !selectedBike?.is_public;
  const ownershipError = selectedBike
    ? rideBikeStateError(selectedBike, editing
        ? { bike_id: editing.bike.id, is_public: editing.isPublic }
        : null, form.isPublic)
    : "Выберите текущий велосипед для новой покатушки.";
  return (
    <section>
      <div className="section-heading">
        <h2>Покатушки</h2>
      </div>
      <RideCreationActions mode={mode} onSelect={start}
        disabled={busy || !config?.enabled || !currentBikes.length} />
      {!bikes.length && <p className="help">Сначала добавьте велосипед.</p>}
      {!!bikes.length && !currentBikes.length && (
        <p className="help">В гараже только бывшие велосипеды. Добавьте текущий велосипед для новых покатушек. Существующие поездки можно просматривать и редактировать.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}<EmailPolicyAction message={error} />
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {mode === "import" && (
        <GarminImport
          bikes={currentBikes}
          onCancel={() => setMode(null)}
          onDone={async (result) => {
            setMode(null);
            setNotice(
              `Импортировано: ${result.imported.length}. Уже загружены: ${result.skipped}.`,
            );
            await refresh();
          }}
        />
      )}
      {mode && mode !== "import" && (
        <form
          className="ride-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (ownershipError) throw Error(ownershipError);
              const {
                scheduledAt,
                features,
                meetingPoint,
                invitations,
                ...base
              } = form;
              const input = {
                ...base,
                ...(visibleMetrics ? { visibleMetrics } : {}),
                ...(mode === "plan"
                  ? {
                      scheduledAt: new Date(scheduledAt).toISOString(),
                      features: features
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      meetingPoint,
                      invitations: invitations
                        .split(/[\s,;]+/)
                        .map((s) => s.replace(/^@/, ""))
                        .filter(Boolean),
                    }
                  : {}),
                ...(!editing && preview
                  ? { previewId: preview.previewId }
                  : {}),
              };
              await socialApi(
                "rides" +
                  (editing ? "/" + editing.id : mode === "plan" ? "/plan" : ""),
                editing ? "PATCH" : "POST",
                input,
              );
              setMode(null);
              setPreview(null);
              await refresh();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>
            {editing
              ? "Изменить покатушку"
              : mode === "plan"
                ? "Планируемая покатушка"
                : "Прошлая покатушка"}
          </h2>
          {!editing && (
            <label
              className="ride-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) upload(e.dataTransfer.files[0]);
              }}
            >
              Файл трека: GPX, FIT или TCX
              {mode === "plan" ? " · необязательно" : ""}
              <input
                type="file"
                accept={trackFiles}
                disabled={busy || !currentBikes.length}
                onChange={(e) => upload(e.target.files[0])}
              />
              <small>
                Выберите файл или перетащите его сюда · до{" "}
                {Math.round((config?.maxGpxBytes || 10485760) / 1048576)} МБ
              </small>
            </label>
          )}
          {!editing && mode === "add" && !preview && <FitHelp />}
          {editing && !editing.hasTrack && (
            <label className="ride-drop">
              Добавить трек к поездке: GPX, FIT или TCX
              <input
                type="file"
                accept={trackFiles}
                disabled={busy}
                onChange={(e) => upload(e.target.files[0], true)}
              />
              <small>
                {editing.sourceKind === "garmin"
                  ? "Проверим дату, дистанцию и длительность по данным Garmin."
                  : "Трек будущего маршрута может не содержать время."}
              </small>
            </label>
          )}
          {busy && <p role="status">Обрабатываем…</p>}
          {(preview || editing || mode === "plan") && (
            <>
              {(preview || editing)?.geometry?.length > 0 && (
                <RideRoutePreview geometry={(preview || editing).geometry} />
              )}
              {(preview || editing) && (
                <RideMetrics
                  metrics={(preview || editing).metrics}
                  visibleMetrics={
                    mode === "plan"
                      ? ["distanceM", "elevationGainM"]
                      : visibleMetrics
                  }
                />
              )}
              {offersPicker && (
                <fieldset className="metric-picker">
                  <legend>Показывать показатели</legend>
                  <div>
                    {pickable.map((f) => (
                      <label key={f.key}>
                        <input
                          type="checkbox"
                          checked={shownMetrics.includes(f.key)}
                          onChange={() =>
                            setVisibleMetrics(
                              shownMetrics.includes(f.key)
                                ? shownMetrics.filter((k) => k !== f.key)
                                : [...shownMetrics, f.key],
                            )
                          }
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="field">
                <span>Велосипед</span>
                <select
                  required
                  value={form.bikeId}
                  onChange={(e) => set("bikeId", e.target.value)}
                >
                  <option value="" disabled>Выберите велосипед</option>
                  {rideBikes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.is_former ? " · бывший" : ""}
                      {b.is_public ? "" : " · приватный"}
                    </option>
                  ))}
                </select>
              </label>
              {selectedBike?.is_former && (
                <p className="help">История бывшего велосипеда сохранена. Можно изменить описание и приватность или перенести поездку на текущий велосипед; новая публикация недоступна.</p>
              )}
              {ownershipError && <p role="alert">{ownershipError}</p>}
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
              {mode === "plan" && (
                <>
                  <div className="ride-form-grid">
                    <label className="field">
                      <span>Дата и время старта</span>
                      <input
                        type="datetime-local"
                        required
                        value={form.scheduledAt}
                        onChange={(e) => set("scheduledAt", e.target.value)}
                      />
                      <small>
                        Ваш часовой пояс:{" "}
                        {Intl.DateTimeFormat().resolvedOptions().timeZone}
                      </small>
                    </label>
                    <label className="field">
                      <span>Место встречи</span>
                      <input
                        maxLength={200}
                        value={form.meetingPoint}
                        onChange={(e) => set("meetingPoint", e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Особенности маршрута</span>
                    <input
                      maxLength={640}
                      placeholder="Гравий, спокойный темп, кофе по пути"
                      value={form.features}
                      onChange={(e) => set("features", e.target.value)}
                    />
                    <small>До 8 особенностей через запятую</small>
                  </label>
                  <label className="field">
                    <span>Пригласить пользователей</span>
                    <input
                      maxLength={930}
                      placeholder="@username, @friend"
                      value={form.invitations}
                      onChange={(e) => set("invitations", e.target.value)}
                    />
                    <small>
                      До 30 имён через запятую. Приглашённые увидят поездку и
                      получат уведомление.
                    </small>
                  </label>
                </>
              )}
              {mode === "plan" && (
                <label className="ride-toggle">
                  <input
                    type="checkbox"
                    checked={form.recurrence === "weekly"}
                    onChange={(e) =>
                      set("recurrence", e.target.checked ? "weekly" : "none")
                    }
                  />
                  <SiteIcon name="repeat" /> Повторять каждую неделю
                  {form.scheduledAt && (
                    <small>
                      {" "}
                      ·{" "}
                      {new Date(form.scheduledAt).toLocaleDateString("ru-RU", {
                        weekday: "long",
                      })}
                    </small>
                  )}
                </label>
              )}
              {mode === "plan" && (
                <label className="field">
                  <span>Часовой пояс</span>
                  <input
                    required
                    maxLength={80}
                    value={form.recurrenceTimezone}
                    onChange={(e) => set("recurrenceTimezone", e.target.value)}
                    list="ride-timezones"
                  />
                  <datalist id="ride-timezones">
                    {[
                      "Europe/Moscow",
                      "Europe/Kaliningrad",
                      "Asia/Yekaterinburg",
                      "Asia/Novosibirsk",
                      "Asia/Vladivostok",
                      "Europe/Berlin",
                      "UTC",
                    ].map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                  <small>
                    Время выше указано в{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone};
                    повторение сохраняет местное время выбранного часового
                    пояса.
                  </small>
                </label>
              )}
              <label className="ride-toggle">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  disabled={!!selectedBike?.is_former && !editing?.isPublic}
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
                    Скрываются все участки внутри зон начала и конца. Метрики
                    остаются полными.
                  </small>
                </label>
              )}
              <button
                className="button"
                disabled={
                  busy ||
                  cannotPublish ||
                  !!ownershipError ||
                  (!editing && mode === "add" && !preview)
                }
              >
                Сохранить покатушку
              </button>
              {editing?.status === "planned" && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm("Отменить запланированную покатушку?")) return;
                    setBusy(true);
                    try {
                      await socialApi(
                        "rides/" + editing.id + "/cancel",
                        "POST",
                        {},
                      );
                      setMode(null);
                      await refresh();
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Отменить поездку
                </button>
              )}
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
                      setMode(null);
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
            onClick={() => setMode(null)}
          >
            Отмена
          </button>
        </form>
      )}
      {data && !mode && (
        <>
          <div className="ride-grid">
            {data.rides.map((r) => (
              <RideCard key={r.id} ride={r} owner onEdit={edit} />
            ))}
          </div>
          {!data.rides.length && !mode && (
            <p className="help">
              Загрузите GPX, FIT или TCX, импортируйте Garmin CSV или
              запланируйте маршрут.
            </p>
          )}
          <Pagination {...data} onPage={setPage} />
        </>
      )}
    </section>
  );
}
