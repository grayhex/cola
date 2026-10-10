"use client";
import { errorMessage } from "../../lib/errors.ts";
import PlanningGraphic from "./planning-graphic.tsx";
import InfoTip from "./info-tip.tsx";
import type { ReactNode, FormEvent } from "react";
import type { AccountBikeDto, ApiError } from "../../lib/contracts.ts";
import type { RideDto } from "./content-types.ts";
import type {
  RideConfig,
  PlanDraft,
  PassportDraft,
  RidePreview,
  RideSaved,
  RideSaveHandler,
} from "./ride-types.ts";
type PlanFormDraft = {
  bikeId: string;
  title: string;
  description: string;
  isPublic: boolean;
  date: string;
  time: string;
  endTime: string;
  startFold?: string;
  endFold?: string;
  meetingPoint: string;
  meetingVisibility: string;
  passport: PassportDraft;
  invitations: string;
  recurrence: string;
  features: string;
};
import { useEffect, useMemo, useRef, useState } from "react";
import EmailPolicyAction from "./email-policy-action.tsx";
import SiteIcon from "./site-icon.tsx";
import PassportTiles from "./passport-tiles.tsx";
import {
  AreaField,
  ExtraConditions,
  pendingAreaMessage,
  type AreaPending,
} from "./ride-plan-fields.tsx";
import { RideRoutePreview, RideMetrics } from "./ride-card.tsx";
import { useMotionFeedback } from "./motion.tsx";
import { useSite } from "./site-provider.tsx";
import { socialApi } from "./social-primitives.tsx";
import {
  selectableRideBikes,
  rideBikeStateError,
} from "../../lib/bike-status.ts";
import { userTimeZone } from "../../lib/user-time-zone.ts";
import { areaChanged, placeChanged } from "../../lib/ride-agreement.ts";
import { areaProblems } from "../../lib/ride-area.ts";
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
const splitLocal = (
  instant: string | null | undefined,
  zone: string,
): [string, string] => {
  if (!instant) return ["", ""];
  const [date, time] = localDateTime(instant, zone).split("T");
  return [date, time];
};
function initialPlan(
  ride: RideDto | null,
  currentBikes: AccountBikeDto[],
  zone: string,
): PlanFormDraft {
  if (!ride) {
    return {
      bikeId: currentBikes.length === 1 ? currentBikes[0].id : "",
      title: "",
      description: "",
      isPublic: true,
      date: "",
      time: "",
      endTime: "",
      startFold: undefined,
      endFold: undefined,
      meetingPoint: "",
      meetingVisibility: "participants",
      passport: {},
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
function RevisionHint({
  ride,
  initial,
  form,
}: {
  ride: RideDto;
  initial: PlanFormDraft;
  form: PlanFormDraft;
}) {
  const answered = Object.entries(ride.rsvpCounts || {}).some(
    ([state, n]) => state !== "declined" && n > 0,
  );
  const changes: (keyof typeof aspectLabels)[] = [];
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
function FoldChoice({
  local,
  zone,
  label,
  value,
  onChange,
}: {
  local: string;
  zone: string;
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
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

export default function PlanForm({
  ride = null,
  suggestion = null,
  bikes,
  config,
  onSaved,
  onCancel,
  onDirty,
  prelude,
}: {
  ride?: RideDto | null;
  // A group chosen in «Подобрать время по интересам» (#370): its start and
  // format replace the form's, the rest of what was typed stays. `id` tells a
  // second choice of the same group from the first.
  suggestion?: { id: number; draft: PlanDraft } | null;
  bikes: AccountBikeDto[];
  config: RideConfig;
  onSaved: RideSaveHandler;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
  prelude?: ReactNode;
}) {
  const { personalSettings } = useSite();
  // A series keeps the zone it was created in; new plans use the profile's.
  const zone =
    ride && validTimeZone(ride.recurrenceTimezone)
      ? ride.recurrenceTimezone
      : userTimeZone(personalSettings);
  const currentBikes = useMemo(() => selectableRideBikes(bikes), [bikes]);
  const rideBikes = selectableRideBikes(bikes, ride?.bike?.id);
  const [form, setForm] = useState(() => initialPlan(ride, currentBikes, zone)),
    [initial] = useState(form),
    [preview, setPreview] = useState<RidePreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // The area field is told to say what is missing at its place (#378).
    [areaCheck, setAreaCheck] = useState(0),
    [whenError, setWhenError] = useState(""),
    [bikeError, setBikeError] = useState(""),
    // Rare fields stay folded (#264); a missing bike opens them on submit.
    [advanced, setAdvanced] = useState(false),
    [suggested, setSuggested] = useState(false);
  const bikeSelect = useRef<HTMLSelectElement | null>(null),
    // An area around the position that is on its way or not confirmed is not
    // the form's.
    areaPending = useRef<AreaPending>(null);
  const reveal = useMotionFeedback(advanced, { reveal: true });
  const dirty = !!preview || JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const taken = useRef(0);
  useEffect(() => {
    if (ride || !suggestion || taken.current === suggestion.id) return;
    taken.current = suggestion.id;
    const startAt = suggestion.draft.startAt;
    const [date, time] = splitLocal(startAt, zone);
    // The group's area replaces the whole object: a centre left from an
    // earlier choice would describe another place under the new label.
    setForm((f) => ({
      ...f,
      date,
      time,
      endTime: "",
      startFold: foldOf(startAt, zone),
      endFold: undefined,
      passport: { ...f.passport, ...suggestion.draft.passport },
    }));
    setSuggested(true);
  }, [suggestion, ride, zone]);
  const fromInterest = !ride && suggested;
  const set = <K extends keyof PlanFormDraft>(
    key: K,
    value: PlanFormDraft[K],
  ) => setForm((f) => ({ ...f, [key]: value }));
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
  async function upload(file: File | undefined) {
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
      const d: RidePreview & Partial<ApiError> = await r.json();
      if (!r.ok) throw Error(d.error);
      setPreview(d);
      if (!form.title) set("title", d.title);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function requireBike(message: string) {
    setAdvanced(true);
    setBikeError(message);
    requestAnimationFrame(() => bikeSelect.current?.focus());
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setWhenError("");
    setBikeError("");
    // The area is optional, but one that is begun is whole: a name, and a
    // centre with a radius or neither (#370).
    if (areaPending.current) {
      setAreaCheck((n) => n + 1);
      return setError(pendingAreaMessage[areaPending.current]);
    }
    const half = areaProblems(form.passport.area);
    if (half.length) {
      setAreaCheck((n) => n + 1);
      return setError(half[0]);
    }
    if (!selectedBike) return requireBike("Выберите велосипед организатора.");
    if (bikeStateError) return requireBike(bikeStateError);
    if (cannotPublish) return;
    let times;
    try {
      times = planInstants(form, zone);
    } catch (err) {
      setWhenError(errorMessage(err));
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
        ...(fromInterest ? { fromInterest: true } : {}),
      };
      const saved = await socialApi<RideSaved>(
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
          ...(fromInterest ? { fromInterest: true } : {}),
        });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove(kind: "cancel" | "delete") {
    if (
      !confirm(
        kind === "cancel"
          ? "Отменить запланированную покатушку? Превью ссылки, уже отправленные в мессенджеры, могут остаться у получателей."
          : "Удалить покатушку и её обсуждение?",
      )
    )
      return;
    if (!ride) return;
    setBusy(true);
    try {
      await (kind === "cancel"
        ? socialApi("rides/" + ride.id + "/cancel", "POST", {})
        : socialApi("rides/" + ride.id, "DELETE"));
      onSaved("removed");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="plan-form" onSubmit={submit}>
      <div className="planning-body planning-side-layout">
        <PlanningGraphic slot="planDialogGraphic" size="side" />
        <div className="planning-side-column">
          {prelude}
          <fieldset className="planning-section half wide-4" disabled={busy}>
            <legend>
              <span className="step" aria-hidden="true">
                1
              </span>
              Когда и где
              <InfoTip id="plan-end-help" label="Подробнее: Дата и время">
                Время — {zone}
                {ride ? " (пояс серии)" : " · из профиля"}. Окончание
                необязательно; раньше старта — значит на следующий день.
              </InfoTip>
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
              check={areaCheck}
              onPending={(pending) => {
                areaPending.current = pending;
              }}
            />
            {ride && ride.status === "planned" && (
              <RevisionHint ride={ride} initial={initial} form={form} />
            )}
          </fieldset>
        </div>
        <div className="planning-side-column">
          <fieldset className="planning-section half wide-4" disabled={busy}>
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
          <fieldset className="planning-section wide-4" disabled={busy}>
            <legend>
              <span className="step" aria-hidden="true">
                3
              </span>
              Участники и доступ
              <InfoTip label="Подробнее: Участники и доступ">
                {form.isPublic
                  ? "Видна в ленте, откликнуться может любой."
                  : "Видят только вы и приглашённые."}{" "}
                Скрытое место встречи защищает и края прикреплённого маршрута.
                До 30 приглашений; приглашённые получат уведомление.
              </InfoTip>
            </legend>
            <label className="field">
              <span className="sr-only">Кто видит покатушку</span>
              <select
                aria-label="Кто видит покатушку"
                value={String(form.isPublic)}
                onChange={(e) => set("isPublic", e.target.value === "true")}
              >
                <option value="true">Публичная покатушка</option>
                <option value="false">По приглашению</option>
              </select>
            </label>

            {cannotPublish && (
              <p role="alert" className="error">
                Велосипед «{selectedBike.name}» приватный: опубликуйте его или
                выберите «По приглашению».
              </p>
            )}
            {ride?.isPublic && !form.isPublic && (
              <p className="notice" data-tone="warning">
                Анонс и превью ссылки станут закрытыми сразу после сохранения.
                Но превью, уже отправленные в мессенджеры, могут остаться у
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
                      onChange={(e) => upload(e.target.files?.[0])}
                    />
                    <small>
                      До{" "}
                      {Math.round((config?.maxGpxBytes || 10485760) / 1048576)}{" "}
                      МБ
                    </small>
                  </label>
                )}
                {!!(preview || ride)?.geometry?.length && (
                  <RideRoutePreview geometry={(preview || ride)?.geometry} />
                )}
                {(preview || ride?.hasTrack) && (
                  <RideMetrics
                    metrics={(preview || ride)?.metrics || {}}
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
          <SiteIcon name="no" />
          Отмена
        </button>
        <button className="button" disabled={busy} aria-busy={busy}>
          <SiteIcon name={ride ? "save" : "plan"} />
          {ride ? "Сохранить изменения" : "Создать покатушку"}
        </button>
      </div>
    </form>
  );
}
