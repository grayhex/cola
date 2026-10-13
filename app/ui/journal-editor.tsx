"use client";
import type { BikeDto, BikeChoiceDto, ApiError } from "../../lib/contracts.ts";
import type {
  JournalDto,
  JournalSaved,
  JournalDraft,
  RideListDto,
} from "./content-types.ts";
import { errorMessage } from "../../lib/errors.ts";
import EmailPolicyAction from "./email-policy-action.tsx";
import { useState, useEffect } from "react";
import { socialApi } from "./social-primitives.tsx";
import PromptComposer from "./prompt-composer.tsx";
import { journalKinds } from "../../lib/journal-kinds.ts";
import { publicPath } from "../../lib/public-urls.ts";
import { useContentDraft } from "./content-drafts.tsx";
import { useDraftExit } from "./use-draft-exit.tsx";
export default function JournalEditor({
  entry = null,
  bikeId,
  bikes = null,
  onSaved,
  onCancel,
}: {
  entry?: JournalDto | null;
  bikeId?: string;
  bikes?: BikeChoiceDto[] | null;
  onSaved: (record: JournalSaved) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { restored, remember, forget, pending, read, begin, isMounted } =
    useContentDraft("journal", entry?.id || "new:" + (bikeId || ""));
  const [baseline] = useState<JournalDraft>({
    bikeId: entry?.bike.id || bikeId || "",
    kind: entry?.kind || "story",
    installationResult: entry?.installationResult || null,
    title: entry?.title || "",
    body: entry?.body || "",
    status: entry?.status || "draft",
    isPublic: entry?.isPublic || false,
    eventDate: entry?.eventDate || null,
    mileage: entry?.mileage ?? null,
    rideId: entry?.ride?.id || null,
    componentIds: entry?.components.map((c) => c.id) || [],
  });
  const [form, setForm] = useState(restored?.form || baseline);
  const [bike, setBike] = useState<BikeDto | null>(null),
    [rides, setRides] = useState<RideListDto["rides"]>([]),
    [ridePage, setRidePage] = useState(1),
    [rideTotal, setRideTotal] = useState(0),
    [error, setError] = useState(restored?.error || ""),
    [busy, setBusy] = useState(!!pending),
    [files, setFiles] = useState<File[]>(restored?.files || []),
    [saved, setSaved] = useState<(JournalSaved & Partial<JournalDto>) | null>(
      restored?.saved || entry,
    );
  const dirty =
    JSON.stringify(form) !== JSON.stringify(baseline) || files.length > 0;
  const { mayDiscard, confirmation } = useDraftExit(dirty);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    pending.then(() => {
      if (!active) return;
      const latest = read();
      setError(latest?.error || "");
      if (latest) {
        setForm(latest.form);
        setFiles(latest.files);
        setSaved(latest.saved);
      }
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [pending, read]);
  useEffect(() => {
    if (!busy) remember(dirty ? { form, files, saved, error } : undefined);
  }, [dirty, form, files, saved, error, busy, remember]);
  const set = <K extends keyof JournalDraft>(k: K, v: JournalDraft[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    let active = true;
    setBike(null);
    setRides([]);
    setRidePage(1);
    setRideTotal(0);
    if (!form.bikeId) return;
    Promise.all([
      socialApi<{ bike: BikeDto }>("bikes/" + form.bikeId),
      socialApi<RideListDto>("rides?own=1&bikeId=" + form.bikeId),
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
      (c) => !saved?.components?.some((p) => p.id === c.id),
    ),
  ];
  async function submit(status: "draft" | "published") {
    const done = begin();
    setBusy(true);
    setError("");
    let record = saved;
    let remaining = files;
    try {
      const input = { ...form, status };
      if (!input.bikeId) throw Error("Выберите велосипед для записи");
      if (status === "published" && (!input.title.trim() || !input.body.trim()))
        throw Error("Для публикации нужны заголовок и текст");
      // Save text first as a draft when new uploads are pending. Publication is last,
      // so a failed image never silently publishes a partial new entry.
      const r = await socialApi<JournalSaved>(
        "journal" + (record ? "/" + record.id : ""),
        record ? "PATCH" : "POST",
        { ...input, status: files.length ? "draft" : status },
      );
      record = { ...record, ...r };
      setSaved(record);
      remember({ form, saved: record, files: remaining });
      for (const f of files) {
        const res = await fetch("/api/journal/" + r.id + "/photos", {
          method: "POST",
          headers: { "Content-Type": f.type },
          body: f,
        });
        const d: Partial<ApiError> = await res.json();
        if (!res.ok) throw Error(d.error);
        setFiles((a) => a.filter((x) => x !== f));
        remaining = remaining.filter((x) => x !== f);
        remember({ form, saved: record, files: remaining });
      }
      if (files.length && status === "published")
        await socialApi("journal/" + r.id, "PATCH", input);
      if (isMounted()) {
        await onSaved(r);
        forget();
      }
    } catch (e) {
      const message =
        errorMessage(e) +
        (record ? " Черновик/сохранённые данные доступны по ссылке ниже." : "");
      setError(message);
      remember({ form, saved: record, files: remaining, error: message });
      if (record?.shareId) {
        const d = await socialApi<{ entry: JournalDto }>(
          "journal/public/" + record.shareId,
        ).catch(() => null);
        if (d) {
          setSaved(d.entry);
          remember({ form, saved: d.entry, files: remaining, error: message });
        }
      }
    } finally {
      setBusy(false);
      done();
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
      {restored && (
        <p role="status" className="help">
          Черновик восстановлен. Сохраните изменения, когда закончите.
        </p>
      )}
      {confirmation}
      {bikes && !entry && (
        <label className="field">
          <span>Велосипед для записи</span>
          <select
            required
            aria-label="Велосипед для записи"
            disabled={busy || !!saved}
            value={form.bikeId}
            onChange={(e) => {
              setError("");
              setForm((f) => ({
                ...f,
                bikeId: e.target.value,
                rideId: null,
                componentIds: [],
              }));
            }}
          >
            <option value="">Выберите свой велосипед</option>
            {bikes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {!b.is_public ? " · приватный" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="help">
        Велосипед:{" "}
        {bike?.name ||
          entry?.bike.name ||
          (form.bikeId ? "Загружаем…" : "не выбран")}
        . Публичность записи не может превышать публичность велосипеда.
      </p>
      <label className="field">
        <span>Тип записи</span>
        <select
          aria-label="Тип записи"
          disabled={busy}
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
          disabled={busy}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      {form.kind === "build" && (
        <label className="field">
          <span>Результат установки — необязательно</span>
          <select
            aria-label="Результат установки"
            disabled={busy}
            value={form.installationResult || ""}
            onChange={(e) => set("installationResult", e.target.value || null)}
          >
            <option value="">Не указан</option>
            <option value="direct">Без доработок</option>
            <option value="modified">С доработками</option>
            <option value="failed">Не подошло</option>
          </select>
          <small>
            Ваш опыт в этой сборке, не гарантия совместимости или безопасности.
          </small>
        </label>
      )}
      <PromptComposer
        label="Текст записи"
        value={form.body}
        onChange={(value) => set("body", value)}
        rows={9}
        maxLength={20000}
        disabled={busy}
      />
      <div className="journal-fields">
        <label className="field">
          <span>Дата события (необязательно)</span>
          <input
            type="date"
            disabled={busy}
            value={form.eventDate || ""}
            onChange={(e) => set("eventDate", e.target.value || null)}
          />
        </label>
        <label className="field">
          <span>Пробег, км (необязательно)</span>
          <input
            type="number"
            disabled={busy}
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
          <label key={p.id} className="setting-row">
            <span>
              {p.name}
              {saved?.components?.some((c) => c.id === p.id)
                ? " · сохранённый снимок"
                : ""}
            </span>
            <input
              type="checkbox"
              disabled={busy}
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
            disabled={busy}
            value={form.rideId || ""}
            onChange={(e) => set("rideId", e.target.value || null)}
          >
            <option value="">Без покатушки</option>
            {rides.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
            {entry?.ride && !rides.some((r) => r.id === entry.ride!.id) && (
              <option value={entry.ride.id}>{entry.ride!.title}</option>
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
                const r = await socialApi<RideListDto>(
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
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Загрузить ещё покатушки
          </button>
        )}
        <p className="help">
          Покатушки остаются отдельными маршрутами, без фотогалереи.
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
            const next = [...(e.target.files || [])];
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
                  setSaved((s) =>
                    s
                      ? {
                          ...s,
                          photos: (s.photos || []).filter((x) => x.id !== p.id),
                        }
                      : s,
                  );
                } catch (e) {
                  setError(errorMessage(e));
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
      <label className="setting-row">
        <span>Публичная запись</span>
        <input
          type="checkbox"
          disabled={busy}
          checked={form.isPublic}
          onChange={(e) => set("isPublic", e.target.checked)}
        />
      </label>
      <p className="help">
        Без галочки запись доступна только вам, даже после публикации. На
        приватном велосипеде любая запись видна только владельцу.
      </p>
      {error && (
        <p role="alert">
          {error}
          <EmailPolicyAction message={error} />
        </p>
      )}
      {saved?.shareId && (
        <a href={publicPath("journal", saved)}>Открыть сохранённую запись</a>
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
            onClick={async () => {
              if (await mayDiscard()) {
                forget();
                onCancel();
              }
            }}
          >
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}
