"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, LockKeyhole } from "lucide-react";
import EmailPolicyAction from "./email-policy-action.jsx";
import SiteIcon from "./site-icon.jsx";
import PassportTiles from "./passport-tiles.jsx";
import { AreaField, ExtraConditions } from "./ride-plan-fields.jsx";
import { RideRoutePreview, RideMetrics } from "./ride-card.jsx";
import { useMotionFeedback } from "./motion.jsx";
import { useSite } from "./site-provider.jsx";
import { socialApi } from "./social-primitives.jsx";
import {
  selectableRideBikes,
  rideBikeStateError,
} from "../../lib/bike-status.ts";
import { userTimeZone } from "../../lib/user-time-zone.ts";
import { areaChanged, placeChanged } from "../../lib/ride-agreement.ts";
import { localDateTime, validTimeZone } from "../../lib/ride-intent-time.ts";
import {
  foldChoices,
  foldOf,
  planInstants,
  planLocalTimes,
  planPrivacy,
} from "../../lib/ride-plan-input.ts";

// «Организовать покатушку» (#253): when and where → the ride → who takes part
// → the rest. The zone comes from the profile (a series keeps its own), the
// bike is chosen by itself when there is one, and track privacy belongs to
// recorded activities: a plan with a hidden meeting point is protected by
// the server with the default radius.
const trackFiles =
  ".gpx,.fit,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml";
const splitLocal = (instant, zone) => {
  if (!instant) return ["", ""];
  const [date, time] = localDateTime(instant, zone).split("T");
  return [date, time];
};
function initialPlan(ride, currentBikes, zone, draft) {
  if (!ride) {
    // A proposal from a group of interest (#234) brings a start and the
    // group's format; the organizer still fixes everything before saving.
    const [date, time] = splitLocal(draft?.startAt, zone);
    return {
      bikeId: currentBikes.length === 1 ? currentBikes[0].id : "",
      title: "",
      description: "",
      isPublic: true,
      date,
      time,
      endTime: "",
      startFold: foldOf(draft?.startAt, zone),
      endFold: undefined,
      meetingPoint: "",
      meetingVisibility: "participants",
      passport: draft?.passport || {},
      invitations: "",
      recurrence: "none",
      features: "",
    };
  }
  const startsAt = ride.startedAt || ride.scheduledAt,
    endsAt = ride.planEndsAt || ride.expectedEndAt;
  const [date, time] = splitLocal(startsAt, zone);
  const [, endTime] = splitLocal(endsAt, zone);
  return {
    bikeId: ride.bike.id,
    title: ride.title,
    description: ride.description,
    isPublic: ride.isPublic,
    date,
    time,
    endTime,
    startFold: foldOf(startsAt, zone),
    endFold: foldOf(endsAt, zone),
    meetingPoint: ride.meetingPoint,
    meetingVisibility: ride.meetingVisibility || "public",
    passport: ride.passport || {},
    invitations: ride.invitations.map((i) => i.username).join(", "),
    recurrence: ride.recurrence,
    features: ride.features.join(", "),
  };
}
const aspectLabels = {
  start: "время старта",
  place: "место встречи",
};
/** While an existing plan is edited (#235): will saving ask the people who
 * answered to confirm again? The same rule as the server's, so a typo fix in
 * the meeting place is shown as harmless before it is saved. */
function RevisionHint({ ride, initial, form }) {
  const answered = Object.entries(ride.rsvpCounts || {}).some(
    ([state, n]) => state !== "declined" && n > 0,
  );
  const changes = [];
  if (form.date !== initial.date || form.time !== initial.time)
    changes.push("start");
  if (
    placeChanged(initial.meetingPoint, form.meetingPoint) ||
    areaChanged(initial.passport?.area, form.passport?.area)
  )
    changes.push("place");
  if (!changes.length)
    return (
      <small className="help">
        Исправление опечатки в месте встречи не меняет ответы участников.
      </small>
    );
  return (
    <p className="notice" data-tone="warning" role="status">
      {answered
        ? "После сохранения ответившие «Иду» и «Может быть» подтвердят участие заново"
        : "Это новая редакция договорённостей"}
      : изменились {changes.map((c) => aspectLabels[c]).join(", ")}.
    </p>
  );
}
/** Repeated local time on a fall-back day: which occurrence is meant. */
function FoldChoice({ local, zone, label, value, onChange }) {
  const choices = foldChoices(local, zone);
  if (choices.length < 2) return null;
  return (
    <label className="field">
      <span>{label}</span>
      <select
        required
        value={value || ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Выберите вхождение</option>
        {choices.map((instant, n) => (
          <option key={instant} value={n ? "later" : "earlier"}>
            {n ? "Второй" : "Первый"} раз · {instant.slice(11, 16)} UTC
          </option>
        ))}
      </select>
    </label>
  );
}
/**
 * @param {{ ride?: any, draft?: {startAt?: string, passport?: object, fromInterest?: boolean} | null,
 *   bikes: any[], config: any,
 *   onSaved: (result: "planned" | "saved" | "removed", created?: {id: string, shareId: string, occurrenceAt: string}) => void,
 *   onCancel: () => void, onDirty?: (dirty: boolean) => void }} props
 */
export default function PlanForm({
  ride = null,
  draft = null,
  bikes,
  config,
  onSaved,
  onCancel,
  onDirty,
}) {
  const { personalSettings } = useSite();
  // A series keeps the zone it was created in; new plans use the profile's.
  const zone =
    ride && validTimeZone(ride.recurrenceTimezone)
      ? ride.recurrenceTimezone
      : userTimeZone(personalSettings);
  const currentBikes = useMemo(() => selectableRideBikes(bikes), [bikes]);
  const rideBikes = selectableRideBikes(bikes, ride?.bike?.id);
  const [form, setForm] = useState(() =>
      initialPlan(ride, currentBikes, zone, draft),
    ),
    [initial] = useState(form),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [whenError, setWhenError] = useState(""),
    [bikeError, setBikeError] = useState(""),
    // Rare fields stay folded (#264); a missing bike opens them on submit.
    [advanced, setAdvanced] = useState(false);
  const bikeSelect = useRef(null);
  const reveal = useMotionFeedback(advanced, { reveal: true });
  const dirty = !!preview || JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const local = planLocalTimes(form);
  const selectedBike = rideBikes.find((b) => b.id === form.bikeId);
  const cannotPublish =
    form.isPublic && selectedBike && !selectedBike.is_public;
  const bikeStateError = selectedBike
    ? rideBikeStateError(
        selectedBike,
        ride ? { bike_id: ride.bike.id, is_public: ride.isPublic } : null,
        form.isPublic,
      )
    : "";
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > config.maxGpxBytes) throw Error("Файл слишком большой");
      const r = await fetch("/api/rides/preview?purpose=plan", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setPreview(d);
      if (!form.title) set("title", d.title);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function requireBike(message) {
    setAdvanced(true);
    setBikeError(message);
    requestAnimationFrame(() => bikeSelect.current?.focus());
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setWhenError("");
    setBikeError("");
    if (!selectedBike) return requireBike("Выберите велосипед организатора.");
    if (bikeStateError) return requireBike(bikeStateError);
    if (cannotPublish) return;
    let times;
    try {
      times = planInstants(form, zone);
    } catch (err) {
      setWhenError(err.message);
      return;
    }
    if (!ride && Date.parse(times.scheduledAt) <= Date.now()) {
      setWhenError("Выберите будущую дату и время.");
      return;
    }
    setBusy(true);
    try {
      const input = {
        bikeId: form.bikeId,
        title: form.title,
        description: form.description,
        isPublic: form.isPublic,
        // Track privacy follows the meeting point; no separate control.
        privacyEnabled: planPrivacy(ride, form.meetingVisibility),
        privacyRadiusM: ride
          ? ride.privacyRadiusM
          : config?.defaultRadius || 500,
        recurrence: form.recurrence,
        recurrenceTimezone: zone,
        scheduledAt: times.scheduledAt,
        expectedEndAt: times.expectedEndAt,
        features: form.features
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        meetingPoint: form.meetingPoint,
        meetingVisibility: form.meetingVisibility,
        passport: form.passport,
        invitations: form.invitations
          .split(/[\s,;]+/)
          .map((s) => s.replace(/^@/, ""))
          .filter(Boolean),
        ...(!ride && preview ? { previewId: preview.previewId } : {}),
        ...(!ride && draft?.fromInterest ? { fromInterest: true } : {}),
      };
      const saved = await socialApi(
        ride ? "rides/" + ride.id : "rides/plan",
        ride ? "PATCH" : "POST",
        input,
      );
      if (ride) onSaved("saved");
      else
        onSaved("planned", {
          id: saved.id,
          shareId: saved.shareId,
          occurrenceAt: times.scheduledAt,
        });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(kind) {
    if (
      !confirm(
        kind === "cancel"
          ? "Отменить запланированную покатушку? Превью ссылки, уже отправленные в мессенджеры, могут остаться у получателей."
          : "Удалить покатушку и её обсуждение?",
      )
    )
      return;
    setBusy(true);
    try {
      await (kind === "cancel"
        ? socialApi("rides/" + ride.id + "/cancel", "POST", {})
        : socialApi("rides/" + ride.id, "DELETE"));
      onSaved("removed");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="plan-form" onSubmit={submit}>
      <div className="planning-body">
        <fieldset className="planning-section half" disabled={busy}>
          <legend>
            <span className="step" aria-hidden="true">
              1
            </span>
            Когда и где
          </legend>
          <div className="planning-row">
            <label className="field">
              <span>Дата</span>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    date: e.target.value,
                    startFold: undefined,
                    endFold: undefined,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Старт</span>
              <input
                type="time"
                required
                value={form.time}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    time: e.target.value,
                    startFold: undefined,
                    endFold: undefined,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Окончание</span>
              <input
                type="time"
                aria-describedby="plan-end-help"
                value={form.endTime}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    endTime: e.target.value,
                    endFold: undefined,
                  }))
                }
              />
            </label>
          </div>
          <FoldChoice
            local={local.start}
            zone={zone}
            label="Время старта повторяется при переводе часов"
            value={form.startFold}
            onChange={(v) => set("startFold", v)}
          />
          <FoldChoice
            local={local.end}
            zone={zone}
            label="Время окончания повторяется при переводе часов"
            value={form.endFold}
            onChange={(v) => set("endFold", v)}
          />
          <small className="help" id="plan-end-help">
            Время — {zone}
            {ride ? " (пояс серии)" : " · из профиля"}. Окончание необязательно;
            раньше старта — значит на следующий день.
          </small>
          {whenError && (
            <p role="alert" className="error">
              {whenError}
            </p>
          )}
          <label className="field">
            <span>Место встречи</span>
            <input
              maxLength={200}
              placeholder="Например, у входа в парк"
              value={form.meetingPoint}
              onChange={(e) => set("meetingPoint", e.target.value)}
            />
          </label>
          <AreaField
            value={form.passport}
            onChange={(v) => set("passport", v)}
            disabled={busy}
            label="Район или парк"
          />
          {ride && ride.status === "planned" && (
            <RevisionHint ride={ride} initial={initial} form={form} />
          )}
        </fieldset>
        <fieldset className="planning-section half" disabled={busy}>
          <legend>
            <span className="step" aria-hidden="true">
              2
            </span>
            Как поедем
          </legend>
          <label className="field">
            <span>Название</span>
            <input
              required
              maxLength={120}
              placeholder="Например, утренний круг по набережной"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <PassportTiles
            value={form.passport}
            onChange={(v) => set("passport", v)}
            disabled={busy}
            label="Условия поездки"
          />
          <ExtraConditions
            value={form.passport}
            onChange={(v) => set("passport", v)}
            disabled={busy}
            pick={["beginnerFriendly", "regroupPolicy"]}
            help={false}
          />
        </fieldset>
        <fieldset className="planning-section" disabled={busy}>
          <legend>
            <span className="step" aria-hidden="true">
              3
            </span>
            Участники и доступ
          </legend>
          <div
            className="option-tiles"
            role="radiogroup"
            aria-label="Кто видит покатушку"
          >
            {[
              [
                true,
                "Публичная покатушка",
                "Видна в ленте, откликнуться может любой.",
                Globe,
              ],
              [
                false,
                "По приглашению",
                "Видят только вы и приглашённые.",
                LockKeyhole,
              ],
            ].map(([value, label, hint, Icon]) => (
              <label className="option-tile" key={label}>
                <input
                  type="radio"
                  name="plan-visibility"
                  aria-label={label}
                  aria-describedby={"plan-visibility-" + value}
                  checked={form.isPublic === value}
                  onChange={() => set("isPublic", value)}
                />
                <Icon size={16} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small id={"plan-visibility-" + value}>{hint}</small>
                </span>
              </label>
            ))}
          </div>
          {cannotPublish && (
            <p role="alert" className="error">
              Велосипед «{selectedBike.name}» приватный: опубликуйте его или
              выберите «По приглашению».
            </p>
          )}
          {ride?.isPublic && !form.isPublic && (
            <p className="notice" data-tone="warning">
              Анонс и превью ссылки станут закрытыми сразу после сохранения. Но
              превью, уже отправленные в мессенджеры, могут остаться у
              получателей — отозвать их нельзя.
            </p>
          )}
          <div className="planning-row wide">
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
            <label className="field">
              <span>Пригласить пользователей</span>
              <input
                maxLength={930}
                placeholder="@username, @friend"
                value={form.invitations}
                onChange={(e) => set("invitations", e.target.value)}
              />
            </label>
          </div>
          <small className="help">
            Скрытое место встречи защищает и края прикреплённого маршрута. До 30
            приглашений; приглашённые получат уведомление.
          </small>
        </fieldset>
        <details
          className="planning-advanced"
          open={advanced}
          onToggle={(e) => setAdvanced(e.currentTarget.open)}
        >
          <summary>
            Дополнительно
            {selectedBike
              ? ` · ${selectedBike.name}`
              : rideBikes.length
                ? " · выберите велосипед"
                : ""}
          </summary>
          <div className="planning-body" ref={reveal}>
            <fieldset className="planning-section half" disabled={busy}>
              <legend className="sr-only">Велосипед и маршрут</legend>
              <label className="field">
                <span>Велосипед</span>
                <select
                  ref={bikeSelect}
                  aria-label="Велосипед"
                  aria-invalid={!!bikeError || undefined}
                  aria-describedby={bikeError ? "plan-bike-error" : undefined}
                  value={form.bikeId}
                  onChange={(e) => {
                    set("bikeId", e.target.value);
                    setBikeError("");
                  }}
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
              {bikeError && (
                <p role="alert" className="error" id="plan-bike-error">
                  {bikeError}
                </p>
              )}
              {!ride && (
                <label className="ride-drop">
                  Маршрут: GPX, FIT или TCX · необязательно
                  <input
                    type="file"
                    accept={trackFiles}
                    disabled={busy}
                    onChange={(e) => upload(e.target.files[0])}
                  />
                  <small>
                    До {Math.round((config?.maxGpxBytes || 10485760) / 1048576)}{" "}
                    МБ
                  </small>
                </label>
              )}
              {(preview || ride)?.geometry?.length > 0 && (
                <RideRoutePreview geometry={(preview || ride).geometry} />
              )}
              {(preview || ride?.hasTrack) && (
                <RideMetrics
                  metrics={(preview || ride).metrics}
                  visibleMetrics={["distanceM", "elevationGainM"]}
                />
              )}
              <label className="ride-toggle">
                <input
                  type="checkbox"
                  checked={form.recurrence === "weekly"}
                  onChange={(e) =>
                    set("recurrence", e.target.checked ? "weekly" : "none")
                  }
                />
                <SiteIcon name="repeat" /> Повторять каждую неделю
              </label>
            </fieldset>
            <fieldset className="planning-section half" disabled={busy}>
              <legend className="sr-only">Описание и условия</legend>
              <label className="field">
                <span>Описание</span>
                <textarea
                  rows={3}
                  maxLength={3000}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
                <small>Без точного адреса: описание публикуется.</small>
              </label>
              <label className="field">
                <span>Особенности маршрута</span>
                <input
                  maxLength={640}
                  placeholder="Гравий, кофе по пути"
                  value={form.features}
                  onChange={(e) => set("features", e.target.value)}
                />
              </label>
              <ExtraConditions
                value={form.passport}
                onChange={(v) => set("passport", v)}
                disabled={busy}
                pick={["speedKmh", "difficulty"]}
              />
            </fieldset>
          </div>
        </details>
      </div>
      <div className="planning-actions">
        {error && (
          <p role="alert" className="error">
            {error}
            <EmailPolicyAction message={error} />
          </p>
        )}
        {busy && <p role="status">Сохраняем…</p>}
        {ride && (
          <div className="start">
            {ride.status === "planned" && (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => remove("cancel")}
              >
                Отменить поездку
              </button>
            )}
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => remove("delete")}
            >
              Удалить покатушку
            </button>
          </div>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button className="button" disabled={busy} aria-busy={busy}>
          {ride ? "Сохранить изменения" : "Создать покатушку"}
        </button>
      </div>
    </form>
  );
}
