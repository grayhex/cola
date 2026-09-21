"use client";
import { useEffect, useState, createContext, useContext } from "react";
import { Avatar, socialApi } from "./social-primitives.jsx";
import { ReportButton, PageControls } from "./community-controls.jsx";
import PromptComposer from "./prompt-composer.jsx";
import { MessagesSquare, Reply } from "./icons.jsx";
const DiscussionKind = createContext("bike");
const QuestionContext = createContext(null);
const paths = (kind) =>
  kind === "journal"
    ? {
        items: "journal/",
        comments: "journal/comments/",
        report: "journal_comment",
      }
    : kind === "ride"
      ? { items: "rides/", comments: "rides/comments/", report: "ride_comment" }
      : {
          items: "community/bikes/",
          comments: "community/comments/",
          report: "comment",
        };
function Editor({ initial = "", label, onSave, onCancel }) {
  const [body, setBody] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="comment-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave(body);
          setBody("");
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <PromptComposer
        label={label}
        value={body}
        onChange={setBody}
        rows={3}
        maxLength={1000}
        disabled={busy}
      >
        {onCancel && (
          <button type="button" className="quiet" onClick={onCancel}>
            Отмена
          </button>
        )}
        <button className="button small" disabled={busy || !body.trim()}>
          {busy
            ? "Отправляем…"
            : initial
              ? "Сохранить комментарий"
              : label === "Ваш ответ"
                ? "Отправить ответ"
                : "Отправить комментарий"}
        </button>
      </PromptComposer>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
function Comment({ comment: c, user, bikeId, refresh, reply = false }) {
  const question = useContext(QuestionContext);
  const api = paths(useContext(DiscussionKind));
  const [editing, setEditing] = useState(false),
    [answer, setAnswer] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <article
      className={"comment" + (reply ? " comment-reply" : "")}
      id={"comment-" + c.id}
    >
      <div className="comment-heading">
        {c.author ? (
          <a className="person-identity" href={"/u/" + c.author.username}>
            <Avatar person={c.author} size="small" />
            <span>
              <strong>{c.author.name}</strong>
              <small>@{c.author.username}</small>
            </span>
          </a>
        ) : (
          <span className="help">Комментарий недоступен</span>
        )}
        <time dateTime={c.createdAt}>
          {new Date(c.createdAt).toLocaleDateString("ru-RU")}
        </time>
      </div>
      {editing ? (
        <Editor
          initial={c.body}
          label="Изменить комментарий"
          onCancel={() => setEditing(false)}
          onSave={async (body) => {
            await socialApi(api.comments + c.id, "PATCH", { body });
            setEditing(false);
            await refresh();
          }}
        />
      ) : (
        <>
          {!c.unavailable && <p className="comment-body">{c.body}</p>}
          <div className="comment-actions">
            {!c.unavailable && question?.solutionId === c.id && (
              <span className="journal-solution">Выбранный ответ · Решено</span>
            )}
            {!c.unavailable && question?.canSelect && (
              <button
                className="quiet"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await socialApi("journal/" + bikeId + "/solution", "PUT", {
                      commentId: question.solutionId === c.id ? null : c.id,
                    });
                    await question.refresh?.();
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {question.solutionId === c.id
                  ? "Снять решение"
                  : "Отметить решением"}
              </button>
            )}
            {user && !reply && !c.unavailable && (
              <button className="quiet" onClick={() => setAnswer((v) => !v)}>
                <Reply size={14} aria-hidden="true" />
                Ответить
              </button>
            )}
            {c.canEdit && (
              <button className="quiet" onClick={() => setEditing(true)}>
                Изменить
              </button>
            )}
            {c.canDelete && (
              <button className="quiet" onClick={() => setConfirm((v) => !v)}>
                Удалить
              </button>
            )}
            {!c.unavailable && c.author?.id !== user?.id && (
              <ReportButton
                user={user}
                entityType={api.report}
                targetId={c.id}
              />
            )}
          </div>
        </>
      )}
      {confirm && (
        <div className="comment-confirm">
          <span>Удалить комментарий? Ответы сохранятся.</span>
          <button
            className="quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await socialApi(api.comments + c.id, "DELETE");
                setConfirm(false);
                await refresh();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Да, удалить
          </button>
          <button className="quiet" onClick={() => setConfirm(false)}>
            Отмена
          </button>
        </div>
      )}
      {answer && (
        <Editor
          label="Ваш ответ"
          onCancel={() => setAnswer(false)}
          onSave={async (body) => {
            await socialApi(api.items + bikeId + "/comments", "POST", {
              body,
              parentId: c.id,
            });
            setAnswer(false);
            await refresh();
          }}
        />
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </article>
  );
}
function Thread({ root, user, bikeId, refresh }) {
  const api = paths(useContext(DiscussionKind));
  const [page, setPage] = useState(1),
    [expanded, setExpanded] = useState(false),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    socialApi(
      api.items + bikeId + "/comments/" + root.id + "/replies?page=" + page,
    )
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [expanded, page, root]);
  return (
    <div className="comment-thread">
      <Comment comment={root} user={user} bikeId={bikeId} refresh={refresh} />
      <div className="comment-replies">
        {(expanded && data ? data.comments : root.replies).map((c) => (
          <Comment
            key={c.id}
            reply
            comment={c}
            user={user}
            bikeId={bikeId}
            refresh={refresh}
          />
        ))}
      </div>
      {root.replyCount > root.replies.length && !expanded && (
        <button
          className="quiet more-replies"
          onClick={() => setExpanded(true)}
        >
          Все ответы · {root.replyCount}
        </button>
      )}
      {expanded && data && <PageControls {...data} onPage={setPage} />}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export default function Discussion({
  bike,
  user,
  entityType = "bike",
  onSolution,
}) {
  const api = paths(entityType);
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [focus, setFocus] = useState(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setFocus(new URLSearchParams(window.location.search).get("comment"));
    setLoaded(true);
  }, []);
  async function refresh() {
    const d = await socialApi(
      api.items +
        bike.id +
        "/comments?page=" +
        page +
        (focus ? "&focus=" + encodeURIComponent(focus) : ""),
    );
    setData(d);
    setError("");
  }
  useEffect(() => {
    if (loaded) refresh().catch((e) => setError(e.message));
  }, [bike.id, page, focus, loaded]);
  useEffect(() => {
    if (focus && data)
      document.getElementById("discussion")?.scrollIntoView({ block: "start" });
  }, [focus, !!data]);
  return (
    <DiscussionKind.Provider value={entityType}>
      <QuestionContext.Provider
        value={
          entityType === "journal" && bike.kind === "question"
            ? {
                solutionId: bike.solutionId,
                canSelect: bike.isOwner,
                refresh: onSolution,
              }
            : null
        }
      >
        <section className="discussion" id="discussion">
          <div className="section-heading">
            <div>
              <h2>
                <MessagesSquare size={20} aria-hidden="true" />
                {entityType === "journal"
                  ? "Обсуждение записи"
                  : entityType === "ride"
                    ? "Обсуждение покатушки"
                    : "Обсуждение сборки"}
              </h2>
              <p className="help">Детали, идеи и опыт владельцев.</p>
            </div>
            {bike.author?.id !== user?.id && (
              <ReportButton
                entityType={entityType}
                targetId={bike.id}
                user={user}
              />
            )}
          </div>
          {focus && (
            <button
              className="quiet"
              onClick={() => {
                setFocus(null);
                setPage(1);
              }}
            >
              Все комментарии
            </button>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {data?.comments.map((c) => (
            <Thread
              key={c.id}
              root={c}
              user={user}
              bikeId={bike.id}
              refresh={refresh}
            />
          ))}
          {!data && !error && <p role="status">Загружаем обсуждение…</p>}
          {data && !data.comments.length && (
            <p className="help">
              {entityType === "ride"
                ? "Поделитесь впечатлениями о маршруте."
                : entityType === "journal"
                  ? "Задайте вопрос или поделитесь своим опытом."
                  : "Первый вопрос о сборке может стать началом знакомства."}
            </p>
          )}
          {data && <PageControls {...data} onPage={setPage} />}
          {user ? (
            <Editor
              label="Ваш комментарий"
              onSave={async (body) => {
                await socialApi(api.items + bike.id + "/comments", "POST", {
                  body,
                });
                setFocus(null);
                setPage(1);
                await refresh();
              }}
            />
          ) : (
            <a className="button secondary small" href="/account">
              Войти, чтобы участвовать в обсуждении
            </a>
          )}
        </section>
      </QuestionContext.Provider>
    </DiscussionKind.Provider>
  );
}
