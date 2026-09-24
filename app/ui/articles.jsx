"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  SocialHeader,
  SocialFooter,
  AuthorLink,
  Pagination,
  socialApi,
} from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import SiteIcon from "./site-icon.jsx";
import ChoiceMenu from "./choice-menu.jsx";
import ArticleBody from "./article-body.jsx";
import Discussion from "./discussion.jsx";
import LocalDate from "./local-date.jsx";
// Only authors need the editor; readers get the parsed article (#117).
const PromptComposer = dynamic(() => import("./prompt-composer.jsx"), {
  ssr: false,
});
// The server layout already knows the reader (#74).
function useReader() {
  return useSite().viewer;
}
export function ArticleCard({ article: a, topics }) {
  const topic = topics.find((t) => t.id === a.topicId);
  return (
    <article className="article-card">
      {a.cover && (
        <a href={"/articles/" + a.shareId} tabIndex={-1} aria-hidden="true">
          <img
            className="article-cover"
            src={a.cover + "?width=640"}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </a>
      )}
      <div className="article-card-content">
        <div className="article-meta">
          <span>
            {topic?.emoji} {topic?.label || "Без рубрики"}
          </span>
          {a.status === "draft" && <span className="bike-label">Черновик</span>}
        </div>
        <h2>
          <a href={"/articles/" + a.shareId}>{a.title || "Без заголовка"}</a>
        </h2>
        <p>{a.excerpt ?? a.body}</p>
        <div className="article-meta">
          <AuthorLink author={a.author} />
          <span>{a.comments} комментариев</span>
        </div>
      </div>
    </article>
  );
}
export function Articles() {
  const user = useReader(),
    { settings } = useSite(),
    topics = settings.articleTopics || [];
  const [own, setOwn] = useState(false),
    [topic, setTopic] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(
    () => setOwn(new URLSearchParams(location.search).get("own") === "1"),
    [],
  );
  useEffect(() => {
    let alive = true;
    setError("");
    setData(null);
    const qs = new URLSearchParams({
      page: String(page),
      q: query,
      ...(own ? { own: "1" } : {}),
      ...(topic ? { topic } : {}),
    });
    socialApi("articles?" + qs)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [own, topic, query, page, user?.id]);
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page articles-page">
        <div className="section-heading">
          <div>
            <h1>Статьи</h1>
            <p className="help">
              База знаний: обслуживание, компоненты и опыт велосипедистов.
            </p>
          </div>
          <a href="/articles/new" className="hf-button">
            <SiteIcon name="write" />
            Написать статью
          </a>
        </div>
        <div className="entity-tabs" role="group" aria-label="Статьи">
          <button
            aria-pressed={!own}
            onClick={() => {
              setOwn(false);
              setPage(1);
            }}
          >
            <SiteIcon name="articles" />
            База знаний
          </button>
          {user && (
            <button
              aria-pressed={own}
              onClick={() => {
                setOwn(true);
                setPage(1);
              }}
            >
              <SiteIcon name="profile" />
              Мои статьи
            </button>
          )}
        </div>
        <div className="article-filters">
          <ChoiceMenu
            label="Рубрика статей"
            value={topic}
            onChange={(v) => {
              setTopic(v);
              setPage(1);
            }}
            choices={[
              { value: "", label: "Все рубрики", emoji: "articles" },
              ...topics.map((t) => ({
                value: t.id,
                label: t.label,
                symbol: t.emoji,
              })),
            ]}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setPage(1);
            }}
            role="search"
          >
            <input
              aria-label="Поиск по статьям"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
              placeholder="Например, размеры покрышек"
            />
            <button className="hf-button">
              <SiteIcon name="search" />
              Найти
            </button>
          </form>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {data ? (
          <>
            <div className="articles-grid">
              {data.articles.map((a) => (
                <ArticleCard key={a.id} article={a} topics={topics} />
              ))}
            </div>
            {!data.articles.length && (
              <div className="empty-state">
                <h2>
                  {own ? "Ваши знания пригодятся другим" : "Пока нет статей"}
                </h2>
                <p>Поделитесь инструкцией, опытом или полезным разбором.</p>
              </div>
            )}
            <Pagination {...data} onPage={setPage} />
          </>
        ) : (
          !error && <p role="status">Загружаем статьи…</p>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
export function ArticlePage({ share, initial = null }) {
  const user = useReader(),
    { settings } = useSite();
  const [article, setArticle] = useState(initial?.article || null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  // The server rendered the article for this viewer (#74).
  const seed = useRef(initial);
  useEffect(() => {
    let alive = true;
    const request = seed.current || socialApi("articles/public/" + share);
    seed.current = null;
    Promise.resolve(request)
      .then((d) => {
        if (alive) setArticle(d.article);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [share, user?.id]);
  const topic = settings.articleTopics?.find((t) => t.id === article?.topicId);
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page article-page">
        <a className="article-back" href="/articles">
          ← Все статьи
        </a>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {article ? (
          editing ? (
            <ArticleEditor
              initial={article}
              onSaved={(a) => {
                setArticle(a);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <header className="article-heading">
                <p className="article-meta">
                  {topic?.emoji} {topic?.label || "Без рубрики"}
                  {article.status === "draft" && " · Черновик"}
                </p>
                <h1>{article.title || "Без заголовка"}</h1>
                <div className="article-meta">
                  <AuthorLink author={article.author} />
                  <LocalDate value={article.updatedAt} />
                  {article.isOwner && (
                    <button
                      className="hf-button"
                      onClick={() => setEditing(true)}
                    >
                      <SiteIcon name="write" />
                      Редактировать
                    </button>
                  )}
                </div>
              </header>
              <ArticleBody doc={article.bodyDoc} photos={article.photos} />
              {article.isPublic && article.status === "published" && (
                <Discussion bike={article} user={user} entityType="article" />
              )}
            </>
          )
        ) : (
          !error && <p role="status">Загружаем статью…</p>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
export function NewArticle() {
  const user = useReader();
  const router = useRouter();
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page article-page">
        <h1>Новая статья</h1>
        {user ? (
          <ArticleEditor
            onSaved={(a) => router.push("/articles/" + a.shareId)}
          />
        ) : (
          <p>
            <a href="/account">Войдите</a>, чтобы написать статью.
          </p>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
function ArticleEditor({ initial, onSaved, onCancel }) {
  const { settings } = useSite(),
    topics = settings.articleTopics || [];
  const [record, setRecord] = useState(initial || null),
    [form, setForm] = useState({
      title: initial?.title || "",
      body: initial?.body || "",
      topicId: initial?.topicId || topics[0]?.id || "",
    }),
    [photos, setPhotos] = useState(initial?.photos || []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const set = (key, value) => {
    setForm((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function save(status) {
    const result = await socialApi(
      "articles" + (record ? "/" + record.id : ""),
      record ? "PATCH" : "POST",
      { ...form, status },
    );
    setRecord(result);
    setDirty(false);
    return result;
  }
  function insert(text) { set("body", form.body + text); }
  return (
    <form
      className="article-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const status = e.nativeEvent.submitter?.value || "draft";
          const result = await save(status);
          const d = await socialApi("articles/public/" + result.shareId);
          onSaved(d.article);
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Заголовок статьи</span>
        <input
          value={form.title}
          maxLength={160}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label className="field">
        <span>Рубрика</span>
        <select
          aria-label="Рубрика"
          required
          value={form.topicId}
          onChange={(e) => set("topicId", e.target.value)}
        >
          {!topics.some((t) => t.id === form.topicId) && (
            <option value="">Выберите рубрику</option>
          )}
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.emoji} {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="article-composer">
        <PromptComposer label="Текст статьи" value={form.body} onChange={(body) => set("body", body)}
          maxLength={20000} rows={16} disabled={busy} photos={photos} />
        <div className="article-toolbar">
          <label className="hf-button">
            <SiteIcon name="add" />
            Иллюстрация
            <input
              aria-label="Иллюстрация"
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || photos.length >= 8}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const target = record || (await save("draft"));
                  const r = await fetch(
                    "/api/journal/" + target.id + "/photos",
                    {
                      method: "POST",
                      headers: { "Content-Type": file.type },
                      body: file,
                    },
                  );
                  const photo = await r.json();
                  if (!r.ok) throw Error(photo.error);
                  setPhotos((v) => [...v, photo]);
                  set(
                    "body",
                    form.body +
                      "\n\n![Описание иллюстрации](photo:" +
                      photo.id +
                      ")\n",
                  );
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <small className="help">
            {form.body.length}/20000 · {photos.length}/8 фото
          </small>
        </div>
      </div>
      {photos.length > 0 && (
        <div className="article-attachments">
          {photos.map((p) => (
            <div key={p.id}>
              <img src={p.url} alt="Иллюстрация статьи" />
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() =>
                  insert("\n\n![Описание иллюстрации](photo:" + p.id + ")\n")
                }
              >
                Вставить
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                aria-label="Удалить иллюстрацию"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await socialApi(
                      "journal/" + record.id + "/photos/" + p.id,
                      "DELETE",
                    );
                    setPhotos((v) => v.filter((photo) => photo.id !== p.id));
                    set(
                      "body",
                      form.body.replaceAll(
                        new RegExp(
                          "!\\[[^\\]]*\\]\\(photo:" + p.id + "\\)",
                          "g",
                        ),
                        "",
                      ),
                    );
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="article-toolbar">
        <button className="hf-button" disabled={busy} value="draft">
          <SiteIcon name="saved" />
          Сохранить черновик
        </button>
        <button
          className="hf-button"
          disabled={busy || !form.title.trim() || !form.body.trim()}
          value="published"
        >
          <SiteIcon name="write" />
          {initial?.status === "published" ? "Обновить статью" : "Опубликовать"}
        </button>
        {onCancel && (
          <button
            className="quiet"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!dirty || confirm("Не сохранять изменения?")) onCancel();
            }}
          >
            Отмена
          </button>
        )}
        {record && (
          <button
            className="quiet danger"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Удалить статью, иллюстрации и обсуждение?")) return;
              setBusy(true);
              try {
                await socialApi("articles/" + record.id, "DELETE");
                setDirty(false);
                location.assign("/articles?own=1");
              } catch (e) {
                setError(e.message);
                setBusy(false);
              }
            }}
          >
            Удалить статью
          </button>
        )}
      </div>
    </form>
  );
}
