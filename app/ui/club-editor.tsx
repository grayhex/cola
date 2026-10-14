"use client";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ClubDto,
  ClubEligibility,
  ClubForm,
} from "../../lib/club-contracts.ts";
import { useSite } from "./site-provider.tsx";
import { socialApi } from "./social-primitives.tsx";
import { useContentDraft } from "./content-drafts.tsx";
import { useDraftExit } from "./use-draft-exit.tsx";
import EmailPolicyAction from "./email-policy-action.tsx";
import ClubLifecycle from "./club-lifecycle.tsx";
import styles from "./clubs.module.css";
const PromptComposer = dynamic(() => import("./prompt-composer.tsx"), {
  ssr: false,
});
const empty: ClubForm = {
  name: "",
  slogan: "",
  city: "",
  formatsText: "",
  mission: "",
  joinMode: "application",
  membersVisibility: "members",
};
export default function ClubEditor({
  initial = null,
  eligibility = null,
  rulesOnly = false,
}: {
  initial?: ClubDto | null;
  eligibility?: ClubEligibility | null;
  rulesOnly?: boolean;
}) {
  const { viewer } = useSite();
  if (!viewer)
    return (
      <section className={styles.page}>
        <h1>Войдите, чтобы создать клуб</h1>
        <Link
          className="button"
          href={"/login?next=" + encodeURIComponent("/clubs/new")}
        >
          Войти
        </Link>
      </section>
    );
  return (
    <Editor
      key={viewer.id + ":" + (initial?.id || "new") + ":" + rulesOnly}
      initial={initial}
      eligibility={eligibility}
      rulesOnly={rulesOnly}
    />
  );
}
function Editor({
  initial,
  eligibility,
  rulesOnly,
}: {
  initial: ClubDto | null;
  eligibility: ClubEligibility | null;
  rulesOnly: boolean;
}) {
  const router = useRouter(),
    draft = useContentDraft(
      "club",
      (initial?.id || "new") + (rulesOnly ? ":rules" : ""),
    );
  const [form, setForm] = useState<ClubForm>(
    () =>
      draft.restored?.form ||
      (initial
        ? {
            name: initial.name,
            slogan: initial.slogan,
            city: initial.city,
            formatsText: initial.formats.join(", "),
            mission: initial.mission,
            joinMode: initial.joinMode,
            membersVisibility: initial.membersVisibility,
          }
        : empty),
  );
  const [rules, setRules] = useState(
      draft.restored?.rules ?? initial?.rules ?? "",
    ),
    [record, setRecord] = useState(draft.restored?.record || initial),
    [requestId] = useState(draft.restored?.requestId || crypto.randomUUID());
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [logo, setLogo] = useState<File | null>(draft.restored?.logo || null),
    [cover, setCover] = useState<File | null>(draft.restored?.cover || null),
    [dirty, setDirty] = useState(draft.restored?.dirty || false),
    [busy, setBusy] = useState(!!draft.pending),
    [error, setError] = useState(draft.restored?.error || "");
  const { mayDiscard, confirmation } = useDraftExit(dirty, draft.shouldWarn);
  const { remember, read } = draft;
  useEffect(() => {
    remember({ form, rules, record, requestId, logo, cover, dirty, error });
  }, [form, rules, record, requestId, logo, cover, dirty, error, remember]);
  useEffect(() => {
    if (!draft.pending) return;
    let active = true;
    void draft.pending.then(() => {
      if (!active) return;
      const saved = read();
      if (saved) {
        setRecord(saved.record);
        setLogo(saved.logo);
        setCover(saved.cover);
        setError(saved.error || "");
      }
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [draft.pending, read]);
  const field = <K extends keyof ClubForm>(key: K, value: ClubForm[K]) => {
    setForm((s) => ({ ...s, [key]: value }));
    setDirty(true);
    draft.resume();
  };
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !interactive) return;
    setBusy(true);
    setError("");
    const done = draft.begin();
    let saved = record,
      remainingLogo = logo,
      remainingCover = cover;
    try {
      const data = {
        name: form.name,
        slogan: form.slogan,
        city: form.city,
        formats: form.formatsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        mission: form.mission,
        joinMode: form.joinMode,
        membersVisibility: form.membersVisibility,
      };
      const response =
        rulesOnly && saved
          ? await socialApi<{ club: ClubDto }>(
              "clubs/" + saved.id + "/rules",
              "PATCH",
              { body: rules, version: saved.version },
            )
          : await socialApi<{ club: ClubDto }>(
              "clubs" + (saved ? "/" + saved.id : ""),
              saved ? "PATCH" : "POST",
              {
                ...data,
                ...(saved ? { version: saved.version } : { requestId }),
              },
            );
      saved = response.club;
      for (const [purpose, file] of [
        ["logo", remainingLogo],
        ["cover", remainingCover],
      ] as const) {
        if (!file) continue;
        const response = await fetch(
          "/api/clubs/" +
            saved.id +
            "/" +
            purpose +
            "?version=" +
            saved.version,
          {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          },
        );
        const result: { club: ClubDto; error?: string } = await response.json();
        if (!response.ok)
          throw new Error(
            (purpose === "logo" ? "Логотип: " : "Обложка: ") +
              (result.error || "Не удалось загрузить картинку"),
          );
        saved = result.club;
        if (purpose === "logo") remainingLogo = null;
        else remainingCover = null;
      }
      remember({
        form,
        rules,
        record: saved,
        requestId,
        logo: remainingLogo,
        cover: remainingCover,
        dirty: false,
      });
      if (draft.isMounted()) {
        draft.forget();
        setDirty(false);
        router.push("/clubs/" + saved.id + (rulesOnly ? "/rules" : ""));
        router.refresh();
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Не удалось сохранить клуб";
      remember({
        form,
        rules,
        record: saved,
        requestId,
        logo: remainingLogo,
        cover: remainingCover,
        dirty: true,
        error: message,
      });
      if (draft.isMounted()) {
        setRecord(saved);
        setLogo(remainingLogo);
        setCover(remainingCover);
        setError(message);
      }
    } finally {
      done();
      if (draft.isMounted()) setBusy(false);
    }
  }
  const allowed = record ? record.canManage : eligibility?.canCreate;
  const GroupTitle = initial ? "h3" : "h2";
  return (
    <section className={initial ? styles.editor : styles.page}>
      {initial ? (
        <h2>
          {rulesOnly ? "Правила клуба" : record ? "О клубе" : "Создать клуб"}
        </h2>
      ) : (
        <h1>{record ? "Завершить создание клуба" : "Создать клуб"}</h1>
      )}
      {!record && !allowed && (
        <div className={styles.notice}>
          <p>
            Для создания клуба нужны подтверждённая почта и собственный
            велосипед. Можно владеть тремя действующими клубами.
          </p>
          {!eligibility?.verified && <EmailPolicyAction />}
          {!eligibility?.hasBike && (
            <p>
              <Link href="/account">Добавить велосипед в гараж</Link>
            </p>
          )}
          {eligibility && eligibility.owned >= 3 && (
            <p>Вы уже владеете тремя клубами.</p>
          )}
        </div>
      )}
      {!rulesOnly && (
        <p className={styles.meta}>
          Обязательно только название. Остальное можно добавить позже.
        </p>
      )}
      <form className={styles.form} onSubmit={save}>
        {rulesOnly ? (
          <PromptComposer
            label="Правила клуба"
            value={rules}
            onChange={(s) => {
              setRules(s);
              setDirty(true);
              draft.resume();
            }}
            disabled={busy || !interactive}
          />
        ) : (
          <>
            <GroupTitle>Название и миссия</GroupTitle>
            <label>
              Название
              <input
                required
                maxLength={80}
                value={form.name}
                disabled={busy || !interactive}
                onChange={(e) => field("name", e.target.value)}
              />
            </label>
            <label>
              Слоган
              <input
                maxLength={180}
                value={form.slogan}
                disabled={busy || !interactive}
                onChange={(e) => field("slogan", e.target.value)}
              />
            </label>
            <div className={styles.fields}>
              <label>
                Город или регион · необязательно
                <input
                  maxLength={80}
                  value={form.city}
                  disabled={busy || !interactive}
                  onChange={(e) => field("city", e.target.value)}
                />
              </label>
              <label>
                Форматы катания · через запятую
                <input
                  maxLength={328}
                  value={form.formatsText}
                  disabled={busy || !interactive}
                  placeholder="Гравий, шоссе, город"
                  onChange={(e) => field("formatsText", e.target.value)}
                />
              </label>
            </div>
            <PromptComposer
              label="О клубе и его миссии"
              value={form.mission}
              onChange={(s) => field("mission", s)}
              disabled={busy || !interactive}
            />
            <GroupTitle>Вступление и видимость</GroupTitle>
            <div className={styles.fields}>
              <label>
                Вступление
                <select
                  value={form.joinMode}
                  disabled={busy || !interactive}
                  onChange={(e) =>
                    field(
                      "joinMode",
                      e.target.value === "open" ? "open" : "application",
                    )
                  }
                >
                  <option value="application">По заявке</option>
                  <option value="open">Свободное вступление</option>
                </select>
              </label>
              <label>
                Список участников
                <select
                  value={form.membersVisibility}
                  disabled={busy || !interactive}
                  onChange={(e) =>
                    field(
                      "membersVisibility",
                      e.target.value === "public" ? "public" : "members",
                    )
                  }
                >
                  <option value="members">Только для участников</option>
                  <option value="public">Виден всем</option>
                </select>
              </label>
            </div>
            <p className={styles.meta}>
              Страница и правила публичны. Закрытый состав не означает анонимное
              членство: авторы постов и личные бейджи могут быть видны всем.
            </p>
            <GroupTitle>Оформление</GroupTitle>
            <div className={styles.fields}>
              {(["logo", "cover"] as const).map((p) => (
                <MediaSlot
                  key={p}
                  purpose={p}
                  error={
                    error.startsWith(p === "logo" ? "Логотип: " : "Обложка: ")
                      ? error
                      : ""
                  }
                  current={record?.[p] || null}
                  file={p === "logo" ? logo : cover}
                  disabled={busy || !interactive}
                  onChange={(f) => {
                    if (p === "logo") setLogo(f);
                    else setCover(f);
                    setDirty(true);
                    draft.resume();
                  }}
                  onRemove={
                    record?.[p]
                      ? async () => {
                          if (!record || busy) return;
                          setBusy(true);
                          setError("");
                          try {
                            const r = await fetch(
                              "/api/clubs/" +
                                record.id +
                                "/" +
                                p +
                                "?version=" +
                                record.version,
                              { method: "DELETE" },
                            );
                            const d: { club: ClubDto; error?: string } =
                              await r.json();
                            if (!r.ok)
                              throw new Error(
                                d.error || "Не удалось удалить изображение",
                              );
                            setRecord(d.club);
                            router.refresh();
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Не удалось удалить изображение",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            <p className={styles.meta}>
              JPEG, PNG или WebP, до 2 МБ. Без логотипа будет монограмма.
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={styles.formFooter}>
          <button
            className="button primary"
            disabled={busy || !interactive || !allowed}
          >
            {busy
              ? "Сохраняем…"
              : record
                ? "Сохранить изменения"
                : "Создать клуб"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !interactive}
            onClick={async () => {
              if (await mayDiscard()) {
                draft.forget();
                router.push(record ? "/clubs/" + record.id : "/clubs");
              }
            }}
          >
            Отмена
          </button>
        </div>
      </form>
      {record && !rulesOnly && !busy && !dirty && (
        <details className={styles.dangerZone}>
          <summary>Архив клуба</summary>
          <ClubLifecycle club={record} />
        </details>
      )}
      {confirmation}
    </section>
  );
}

function MediaSlot({
  purpose,
  error,
  current,
  file,
  disabled,
  onChange,
  onRemove,
}: {
  purpose: "logo" | "cover";
  error: string;
  current: string | null;
  file: File | null;
  disabled: boolean;
  onChange: (f: File | null) => void;
  onRemove?: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className={styles.mediaSlot}>
      <label>
        {purpose === "logo" ? "Логотип" : "Обложка"} · необязательно
        <input
          type="file"
          ref={inputRef}
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
      </label>
      {(preview || current) && (
        <Image
          unoptimized
          width={800}
          height={400}
          className={styles.mediaPreview}
          src={preview || current || ""}
          alt={
            purpose === "logo"
              ? "Предпросмотр логотипа"
              : "Предпросмотр обложки"
          }
        />
      )}
      <p className={styles.meta}>
        {file?.name ||
          (current
            ? "Текущее изображение"
            : purpose === "logo"
              ? "Без логотипа будет монограмма"
              : "Фото для шапки клуба")}
      </p>
      {error && <p className="error">{error}</p>}
      {file && (
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            onChange(null);
          }}
        >
          Отменить выбор
        </button>
      )}
      {!file && current && onRemove && (
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() => void onRemove()}
        >
          Удалить {purpose === "logo" ? "логотип" : "обложку"}
        </button>
      )}
    </div>
  );
}
