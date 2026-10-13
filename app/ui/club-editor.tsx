"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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
    if (busy) return;
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
          throw new Error(result.error || "Не удалось загрузить картинку");
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
  return (
    <section className={styles.page}>
      <h1>
        {rulesOnly ? "Правила клуба" : record ? "О клубе" : "Создать клуб"}
      </h1>
      {!record && (
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
            disabled={busy}
          />
        ) : (
          <>
            <label>
              Название
              <input
                required
                maxLength={80}
                value={form.name}
                disabled={busy}
                onChange={(e) => field("name", e.target.value)}
              />
            </label>
            <label>
              Слоган
              <input
                maxLength={180}
                value={form.slogan}
                disabled={busy}
                onChange={(e) => field("slogan", e.target.value)}
              />
            </label>
            <div className={styles.fields}>
              <label>
                Город или регион · необязательно
                <input
                  maxLength={80}
                  value={form.city}
                  disabled={busy}
                  onChange={(e) => field("city", e.target.value)}
                />
              </label>
              <label>
                Форматы катания · через запятую
                <input
                  maxLength={328}
                  value={form.formatsText}
                  disabled={busy}
                  placeholder="Гравий, шоссе, город"
                  onChange={(e) => field("formatsText", e.target.value)}
                />
              </label>
            </div>
            <PromptComposer
              label="О клубе и его миссии"
              value={form.mission}
              onChange={(s) => field("mission", s)}
              disabled={busy}
            />
            <div className={styles.fields}>
              <label>
                Вступление
                <select
                  value={form.joinMode}
                  disabled={busy}
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
                  disabled={busy}
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
            <div className={styles.fields}>
              {(["logo", "cover"] as const).map((p) => (
                <label key={p}>
                  {p === "logo" ? "Логотип" : "Обложка"} · необязательно
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (p === "logo") setLogo(f);
                      else setCover(f);
                      setDirty(true);
                      draft.resume();
                    }}
                  />
                  {(p === "logo" ? logo : cover)?.name}
                </label>
              ))}
            </div>
            <p className={styles.meta}>
              JPEG, PNG или WebP, до 2 МБ. Без логотипа будет монограмма.
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button className="button primary" disabled={busy || !allowed}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
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
        <ClubLifecycle club={record} />
      )}
      {confirmation}
    </section>
  );
}
