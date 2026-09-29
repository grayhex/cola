"use client";
import { useEffect, useMemo, useState } from "react";
import RidePlanFields from "./ride-plan-fields.jsx";
import EmailPolicyAction from "./email-policy-action.jsx";
import SiteIcon from "./site-icon.jsx";
import {
  selectableRideBikes,
  rideBikeStateError,
} from "../../lib/bike-status.js";
import { socialApi } from "./social-primitives.jsx";
import { RideRoutePreview, RideMetrics } from "./ride-card.jsx";
import { garminFields, defaultRideFields } from "../../lib/garmin-fields.js";

// The one ride form (#245): planning from the home page, the account overview
// and «Мои покатушки», uploading a track under «Интеграции и импорт» and
// editing an existing ride all share this state, validation and API.
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
  meetingVisibility: "participants",
  passport: {},
  expectedEndAt: "",
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
export const trackFiles =
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
export function FitHelp() {
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
          По USB многие велокомпьютеры показывают файлы тренировок, у Garmin — в
          папке Garmin/Activity.
        </li>
      </ul>
      <p>Названия пунктов меню зависят от версии приложения.</p>
    </details>
  );
}
function initialForm(ride, currentBikes, config) {
  if (!ride)
    return {
      ...blank,
      recurrenceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      bikeId: currentBikes[0]?.id || "",
      privacyRadiusM: config?.defaultRadius || 500,
    };
  return {
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
    meetingVisibility: ride.meetingVisibility || "public",
    passport: ride.passport || {},
    expectedEndAt: localDate(ride.planEndsAt || ride.expectedEndAt),
    invitations: ride.invitations.map((i) => i.username).join(", "),
  };
}
/**
 * @param {{
 *   mode: "add" | "plan",
 *   ride?: any,
 *   bikes: any[],
 *   config: any,
 *   heading?: boolean,
 *   onSaved: (result: "planned" | "saved" | "removed") => void,
 *   onCancel: () => void,
 *   onChanged?: () => void,
 *   onDirty?: (dirty: boolean) => void,
 * }} props
 */
export default function RideForm({
  mode,
  ride = null,
  bikes,
  config,
  heading = true,
  onSaved,
  onCancel,
  onChanged,
  onDirty,
}) {
  const currentBikes = useMemo(() => selectableRideBikes(bikes), [bikes]);
  const [editing, setEditing] = useState(ride),
    [form, setForm] = useState(() => initialForm(ride, currentBikes, config)),
    [initial] = useState(form),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [visibleMetrics, setVisibleMetrics] = useState(
      ride ? ride.visibleMetrics : null,
    );
  const rideBikes = selectableRideBikes(bikes, editing?.bike?.id);
  const dirty = !!preview || JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  // Garmin CSV and FIT/TCX sensors bring extra metrics; the owner picks which
  // of them the ride shows. Heart rate and power stay hidden until chosen.
  const metricSource = mode === "plan" ? null : preview || editing,
    shownMetrics = visibleMetrics || defaultRideFields,
    pickable = garminFields.filter((f) => metricSource?.metrics[f.key] != null);
  const offersPicker =
    editing?.sourceKind === "garmin" ||
    pickable.some((f) => !trackMetrics.includes(f.key));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function upload(file, attach = false) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (!attach && !currentBikes.length)
        throw Error("Для новой покатушки выберите текущий велосипед.");
      if (file.size > config.maxGpxBytes) throw Error("Файл слишком большой");
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
        onChanged?.();
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
  const selectedBike = rideBikes.find((b) => b.id === form.bikeId);
  const cannotPublish = form.isPublic && !selectedBike?.is_public;
  const ownershipError = selectedBike
    ? rideBikeStateError(
        selectedBike,
        editing
          ? { bike_id: editing.bike.id, is_public: editing.isPublic }
          : null,
        form.isPublic,
      )
    : "Выберите текущий велосипед для новой покатушки.";
  return (
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
            meetingVisibility,
            passport,
            expectedEndAt,
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
                  meetingVisibility,
                  passport,
                  expectedEndAt: expectedEndAt
                    ? new Date(expectedEndAt).toISOString()
                    : null,
                  invitations: invitations
                    .split(/[\s,;]+/)
                    .map((s) => s.replace(/^@/, ""))
                    .filter(Boolean),
                }
              : {}),
            ...(!editing && preview ? { previewId: preview.previewId } : {}),
          };
          await socialApi(
            "rides" +
              (editing ? "/" + editing.id : mode === "plan" ? "/plan" : ""),
            editing ? "PATCH" : "POST",
            input,
          );
          onSaved(mode === "plan" && !editing ? "planned" : "saved");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {heading && (
        <h2>
          {editing
            ? "Изменить покатушку"
            : mode === "plan"
              ? "Планируемая покатушка"
              : "Прошлая покатушка"}
        </h2>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
          <EmailPolicyAction message={error} />
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
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
              <p className="help">
                Средний или максимальный пульс, каденс и мощность также
                открывают соответствующий график на публичной части трека.
              </p>
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
              <option value="" disabled>
                Выберите велосипед
              </option>
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
            <p className="help">
              История бывшего велосипеда сохранена. Можно изменить описание и
              приватность или перенести поездку на текущий велосипед; новая
              публикация недоступна.
            </p>
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
                <span>Кто видит точное место встречи</span>
                <select
                  value={form.meetingVisibility}
                  onChange={(e) => set("meetingVisibility", e.target.value)}
                >
                  <option value="participants">
                    Организатор и участники с ответом «Иду»
                  </option>
                  <option value="public">Все, кому доступна поездка</option>
                </select>
              </label>
              <p className="help">
                Не указывайте точный адрес в названии, описании и особенностях.
                Эти поля публикуются вместе с поездкой. Маршрут тоже может
                раскрыть место; при закрытом месте встречи края трека скрываются
                автоматически.
              </p>
              <RidePlanFields
                value={form.passport}
                onChange={(v) => set("passport", v)}
                disabled={busy}
              />
              <label className="field">
                <span>Ожидаемое окончание — необязательно</span>
                <input
                  type="datetime-local"
                  value={form.expectedEndAt}
                  onChange={(e) => set("expectedEndAt", e.target.value)}
                />
                <small>
                  В вашем часовом поясе. Для серии переносится вместе с датой
                  выезда.
                </small>
              </label>
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
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}; повторение
                  сохраняет местное время выбранного часового пояса.
                </small>
              </label>
            </>
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
              Сначала опубликуйте велосипед или сохраните покатушку приватной.
            </p>
          )}
          <label className="ride-toggle">
            <input
              type="checkbox"
              checked={
                form.privacyEnabled ||
                (mode === "plan" && form.meetingVisibility === "participants")
              }
              disabled={
                mode === "plan" && form.meetingVisibility === "participants"
              }
              onChange={(e) => set("privacyEnabled", e.target.checked)}
            />
            Скрыть начало и конец маршрута
          </label>
          {(form.privacyEnabled ||
            (mode === "plan" && form.meetingVisibility === "participants")) && (
            <label className="field">
              <span>Радиус приватности</span>
              <select
                value={form.privacyRadiusM}
                onChange={(e) => set("privacyRadiusM", Number(e.target.value))}
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
                  onSaved("removed");
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
                  onSaved("removed");
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
        onClick={onCancel}
      >
        Отмена
      </button>
    </form>
  );
}
