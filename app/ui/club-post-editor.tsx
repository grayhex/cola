"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { ClubPostView } from "./club-post-feed.tsx";
import { useSite } from "./site-provider.tsx";
import { useContentDraft } from "./content-drafts.tsx";
import { useDraftExit } from "./use-draft-exit.tsx";
import { socialApi } from "./social-primitives.tsx";
import EmailPolicyAction from "./email-policy-action.tsx";
import styles from "./clubs.module.css";
const PromptComposer = dynamic(() => import("./prompt-composer.tsx"), {
  ssr: false,
});
export default function ClubPostEditor({
  club,
  initial = null,
}: {
  club: ClubDto;
  initial?: ClubPostView | null;
}) {
  const { viewer } = useSite();
  if (!viewer) return <p>Войдите, чтобы написать в клуб.</p>;
  if (
    club.membership?.userId !== viewer.id ||
    club.membership.state !== "active" ||
    club.archived ||
    (initial && initial.author?.id !== viewer.id)
  )
    return <p>Публикации доступны действующим участникам клуба.</p>;
  return (
    <Editor
      key={viewer.id + ":" + (initial?.id || club.id)}
      club={club}
      initial={initial}
    />
  );
}
function Editor({
  club,
  initial,
}: {
  club: ClubDto;
  initial: ClubPostView | null;
}) {
  const router = useRouter(),
    draft = useContentDraft("clubPost", initial?.id || "new:" + club.id),
    [form, setForm] = useState(
      draft.restored?.form || {
        title: initial?.title || "",
        body: initial?.body || "",
      },
    ),
    [record, setRecord] = useState(draft.restored?.record || initial),
    [requestId] = useState(draft.restored?.requestId || crypto.randomUUID()),
    [files, setFiles] = useState(draft.restored?.files || []),
    [dirty, setDirty] = useState(draft.restored?.dirty || false),
    [busy, setBusy] = useState(!!draft.pending),
    [error, setError] = useState(draft.restored?.error || "");
  const { mayDiscard, confirmation } = useDraftExit(dirty, draft.shouldWarn),
    { remember, read } = draft;
  useEffect(() => {
    remember({ form, record, requestId, files, dirty, error });
  }, [form, record, requestId, files, dirty, error, remember]);
  useEffect(() => {
    if (!draft.pending) return;
    let active = true;
    void draft.pending.then(() => {
      if (!active) return;
      const state = read();
      if (state) {
        setRecord(state.record);
        setFiles(state.files);
        setDirty(state.dirty);
        setError(state.error || "");
      }
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [draft.pending, read]);
  async function save(publish: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    const done = draft.begin();
    let saved = record,
      remaining = files;
    try {
      // A lost create response is recovered before a changed form is retried.
      if (!saved)
        saved = (
          await socialApi<{ post: ClubPostView | null }>(
            "club-posts?clubId=" + club.id + "&requestId=" + requestId,
          )
        ).post;
      if (!saved)
        saved = (
          await socialApi<{ post: ClubPostView }>(
            "club-posts?clubId=" + club.id,
            "POST",
            { ...form, requestId, status: "draft" },
          )
        ).post;
      if (!publish && saved.status === "published")
        saved = (
          await socialApi<{ post: ClubPostView }>(
            "club-posts/" + saved.id,
            "PATCH",
            { ...form, version: saved.version, status: "draft" },
          )
        ).post;
      for (const selected of files) {
        const response = await fetch(
            "/api/club-posts/" + saved.id + "/photos?requestId=" + selected.id,
            {
              method: "POST",
              body: selected.bytes || selected.file,
              headers: {
                "Content-Type":
                  selected.file.type || "application/octet-stream",
              },
            },
          ),
          result: { id: string; url: string; error?: string } =
            await response.json();
        if (!response.ok)
          throw new Error(result.error || "Не удалось загрузить фотографию");
        remaining = remaining.filter((f) => f.id !== selected.id);
      }
      saved = (
        await socialApi<{ post: ClubPostView }>(
          "club-posts/" + saved.id,
          "PATCH",
          {
            ...form,
            version: saved.version,
            status: publish ? "published" : "draft",
          },
        )
      ).post;
      remember({
        form,
        record: saved,
        requestId,
        files: remaining,
        dirty: false,
      });
      if (draft.isMounted()) {
        draft.forget();
        setDirty(false);
        router.push(saved.href);
        router.refresh();
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Не удалось сохранить публикацию";
      // Recover registered photos after partial success, preserving the selected
      // file requests for idempotent retry when an upload acknowledgement is lost.
      if (saved) {
        try {
          saved = (
            await socialApi<{ post: ClubPostView }>("club-posts/" + saved.id)
          ).post;
        } catch {
          /* Keep the last confirmed draft for retry. */
        }
      }
      remember({
        form,
        record: saved,
        requestId,
        files: remaining,
        dirty: true,
        error: message,
      });
      if (draft.isMounted()) {
        setRecord(saved);
        setFiles(remaining);
        setDirty(true);
        setError(message);
      }
    } finally {
      done();
      if (draft.isMounted()) setBusy(false);
    }
  }
  return (
    <section className={styles.page}>
      <h1>{initial ? "Редактировать публикацию" : "Написать в клуб"}</h1>
      <p>
        <Link href={"/clubs/" + club.id}>{club.name}</Link>
      </p>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <label>
          Заголовок <span className="help">Необязательно</span>
          <input
            maxLength={160}
            value={form.title}
            disabled={busy}
            onChange={(e) => {
              setForm({ ...form, title: e.target.value });
              setDirty(true);
            }}
          />
        </label>
        <PromptComposer
          label="Текст публикации"
          value={form.body}
          onChange={(body) => {
            setForm({ ...form, body });
            setDirty(true);
          }}
          maxLength={20000}
          disabled={busy}
          rows={8}
        />
        <label>
          Фотографии
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const next = Array.from(e.target.files || []);
              if (
                next.length + files.length + (record?.photos.length || 0) >
                8
              ) {
                setError("Максимум 8 фотографий");
                return;
              }
              setFiles([
                ...files,
                ...next.map((file) => ({
                  id: crypto.randomUUID(),
                  file,
                  bytes: null,
                })),
              ]);
              setDirty(true);
              e.target.value = "";
            }}
          />
          <span className="help">
            JPEG, PNG или WebP, до 2 МБ каждое. Не больше 8 фото.
          </span>
        </label>
        {record?.photos.map((photo) => (
          <div key={photo.id} className={styles.actions}>
            <Image
              unoptimized
              width={96}
              height={72}
              className={styles.thumb}
              src={photo.url + "?width=160"}
              alt="Фото публикации"
            />
            <button
              className="quiet"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await socialApi(
                    "club-posts/" + record.id + "/photos/" + photo.id,
                    "DELETE",
                  );
                  setRecord({
                    ...record,
                    photos: record.photos.filter((p) => p.id !== photo.id),
                  });
                  setDirty(true);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Не удалось удалить фото",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Удалить фото
            </button>
          </div>
        ))}
        {files.map((file) => (
          <div className={styles.actions} key={file.id}>
            <span>{file.file.name}</span>
            <button
              className="quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setFiles(files.filter((f) => f.id !== file.id));
                setDirty(true);
              }}
            >
              Убрать
            </button>
          </div>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
            <EmailPolicyAction message={error} />
          </p>
        )}
        <div className={styles.actions}>
          <button className="button" disabled={busy}>
            {busy ? "Сохраняем…" : "Опубликовать"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Сохранить черновик
          </button>
          <button
            className="quiet"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await mayDiscard()) {
                draft.forget();
                router.push("/clubs/" + club.id);
              }
            }}
          >
            Отмена
          </button>
        </div>
      </form>
      {confirmation}
    </section>
  );
}
