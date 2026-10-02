"use client";
import type { ViewerDto } from "../../lib/contracts.ts";
import type {
  CommentDto,
  CommentPageDto,
  ReplyPageDto,
} from "./content-types.ts";
type DiscussionEntity = "bike" | "component" | "article" | "journal" | "ride";
interface Question {
  solutionId?: string | null;
  canSelect?: boolean;
  refresh?: () => void | Promise<void>;
}
import { errorMessage } from "../../lib/errors.ts";
import EmailPolicyAction from "./email-policy-action.tsx";
import Link from "next/link";
import {
  useCallback,
  useRef,
  useEffect,
  useState,
  createContext,
  useContext,
} from "react";
import { Avatar, socialApi } from "./social-primitives.tsx";
import { ReportButton, PageControls } from "./community-controls.tsx";
import dynamic from "next/dynamic";
import RichTextBody from "./rich-text-body.tsx";
import { ArrowRight, MessagesSquare, Reply } from "./icons.tsx";
import { profilePath } from "../../lib/public-urls.ts";
import { personName, usernameLabel } from "../../lib/usernames.ts";
// The composer brings the editor; guests read comments without it (#117).
const PromptComposer = dynamic(() => import("./prompt-composer.tsx"), {
  ssr: false,
});
// How many threads the short panel of a bike shows before «all comments».
const shownThreads = 3;
const DiscussionKind = createContext<DiscussionEntity>("bike");
const QuestionContext = createContext<Question | null>(null);
const paths = (kind: DiscussionEntity) =>
  kind === "component"
    ? {
        items: "components/",
        comments: "components/comments/",
        report: "component_comment" as const,
      }
    : kind === "article"
      ? {
          items: "articles/",
          comments: "articles/comments/",
          report: "journal_comment" as const,
        }
      : kind === "journal"
        ? {
            items: "journal/",
            comments: "journal/comments/",
            report: "journal_comment" as const,
          }
        : kind === "ride"
          ? {
              items: "rides/",
              comments: "rides/comments/",
              report: "ride_comment" as const,
            }
          : {
              items: "community/bikes/",
              comments: "community/comments/",
              report: "comment" as const,
            };
function Editor({
  initial = "",
  label,
  onSave,
  onCancel,
  replyTo,
}: {
  initial?: string;
  label: string;
  onSave: (body: string) => void | Promise<void>;
  onCancel?: () => void;
  replyTo?: string;
}) {
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
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {replyTo && <p className="help">Ответ для {replyTo}</p>}
      <PromptComposer
        label={label}
        value={body}
        onChange={setBody}
        rows={3}
        required
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
          <EmailPolicyAction message={error} />
        </p>
      )}
    </form>
  );
}
function Comment({
  comment: c,
  user,
  bikeId,
  refresh,
  reply = false,
  parent,
}: {
  comment: CommentDto;
  user: ViewerDto | null;
  bikeId: string;
  refresh: (focusId?: string | null) => Promise<void>;
  reply?: boolean;
  parent?: CommentDto;
}) {
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
      tabIndex={-1}
      data-parent-id={c.parentId || undefined}
    >
      <div className="comment-heading">
        {c.author ? (
          <a className="person-identity" href={profilePath(c.author.username)}>
            <Avatar person={c.author} size="small" />
            <span>
              <strong>{personName(c.author)}</strong>
              {usernameLabel(c.author) && (
                <small>{usernameLabel(c.author)}</small>
              )}
            </span>
          </a>
        ) : (
          <span className="help">Комментарий недоступен</span>
        )}
        <time dateTime={c.createdAt}>
          {new Date(c.createdAt).toLocaleDateString("ru-RU")}
        </time>
      </div>
      {parent && (
        <a className="comment-parent help" href={"#comment-" + parent.id}>
          Ответ для{" "}
          {parent.author
            ? usernameLabel(parent.author) || personName(parent.author)
            : "недоступного комментария"}
        </a>
      )}
      {editing ? (
        <Editor
          initial={c.body || ""}
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
          {!c.unavailable && (
            <RichTextBody className="comment-body" doc={c.bodyDoc} />
          )}
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
                    setError(errorMessage(e));
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
            {user && !c.unavailable && (
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
                await refresh(null);
              } catch (e) {
                setError(errorMessage(e));
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
          replyTo={
            c.author
              ? usernameLabel(c.author) || personName(c.author)
              : "участника"
          }
          onCancel={() => setAnswer(false)}
          onSave={async (body) => {
            const created = await socialApi<{ id: string }>(
              api.items + bikeId + "/comments",
              "POST",
              {
                body,
                parentId: c.id,
              },
            );
            setAnswer(false);
            await refresh(created.id);
          }}
        />
      )}
      {error && (
        <p role="alert" className="error">
          {error}
          <EmailPolicyAction message={error} />
        </p>
      )}
    </article>
  );
}
function Thread({
  root,
  user,
  bikeId,
  refresh,
  initialReplies = [],
  focusPath,
  depth = 0,
  parent,
}: {
  root: CommentDto;
  user: ViewerDto | null;
  bikeId: string;
  refresh: (focusId?: string | null) => Promise<void>;
  initialReplies?: CommentDto[];
  focusPath: CommentDto[];
  depth?: number;
  parent?: CommentDto;
}) {
  const api = paths(useContext(DiscussionKind));
  const [page, setPage] = useState(1),
    [expanded, setExpanded] = useState(false),
    [data, setData] = useState<ReplyPageDto | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    setData(null);
    setError("");
    socialApi<ReplyPageDto>(
      api.items + bikeId + "/comments/" + root.id + "/replies?page=" + page,
    )
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [expanded, page, root, api.items, bikeId]);
  const replies = [...(expanded && data ? data.comments : initialReplies)];
  // A deep link may land beyond the first page. Include only its immediate
  // path child; every other branch still needs an explicit bounded request.
  const child = focusPath.find((c) => c.parentId === root.id);
  if (child && !replies.some((c) => c.id === child.id)) replies.push(child);
  return (
    <div className="comment-thread" data-depth={depth}>
      <Comment
        comment={root}
        user={user}
        bikeId={bikeId}
        refresh={refresh}
        reply={depth > 0}
        parent={parent}
      />
      {!!replies.length && (
        <div
          className={
            "comment-replies" + (depth >= 3 ? " comment-replies-flat" : "")
          }
        >
          {replies.map((c) => (
            <Thread
              key={c.id}
              root={c}
              user={user}
              bikeId={bikeId}
              refresh={refresh}
              focusPath={focusPath}
              depth={depth + 1}
              parent={root}
            />
          ))}
        </div>
      )}
      {root.replyCount > replies.length && !expanded && (
        <button
          className="quiet more-replies"
          onClick={() => setExpanded(true)}
        >
          Показать ещё ответы · {root.replyCount}
        </button>
      )}
      {expanded && !data && !error && <p role="status">Загружаем ответы…</p>}
      {expanded && data && <PageControls {...data} onPage={setPage} />}
      {error && (
        <p role="alert">
          {error}
          <EmailPolicyAction message={error} />
          <button
            className="quiet"
            onClick={() => {
              setExpanded(false);
              setError("");
            }}
          >
            Закрыть ответы
          </button>
        </p>
      )}
    </div>
  );
}
export default function Discussion({
  bike,
  user,
  entityType = "bike",
  onSolution,
  variant,
  count,
}: {
  bike: {
    id: string;
    author?: { id: string } | null;
    kind?: string;
    solutionId?: string | null;
    isOwner?: boolean;
  };
  user: ViewerDto | null;
  entityType?: DiscussionEntity;
  onSolution?: () => void | Promise<void>;
  // The bike page shows a short panel: «Комментарии (N)», the first three
  // threads and a button for the rest (#291). Other pages keep the full block.
  variant?: "panel";
  count?: number;
}) {
  const api = paths(entityType);
  const panel = variant === "panel";
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<CommentPageDto | null>(null),
    [page, setPage] = useState(1),
    [focus, setFocus] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setFocus(new URLSearchParams(window.location.search).get("comment"));
    setLoaded(true);
  }, []);
  const requests = useRef({ revision: 0 });
  const refresh = useCallback(
    async (focusId?: string | null) => {
      if (focusId !== undefined && focusId !== focus) {
        setFocus(focusId);
        return;
      }
      const revision = ++requests.current.revision;
      try {
        const d = await socialApi<CommentPageDto>(
          api.items +
            bike.id +
            "/comments?page=" +
            page +
            (focus ? "&focus=" + encodeURIComponent(focus) : ""),
        );
        if (revision !== requests.current.revision) return;
        setData(d);
        setError("");
      } catch (e) {
        if (revision === requests.current.revision) {
          setData(null);
          setError(errorMessage(e));
        }
      }
    },
    [api.items, bike.id, page, focus],
  );
  useEffect(() => {
    const pending = requests.current;
    if (loaded) void refresh();
    return () => {
      pending.revision++;
    };
  }, [refresh, loaded]);
  // A link to one comment must show it, not hide it behind «all comments».
  useEffect(() => {
    if (focus) setExpanded(true);
  }, [focus]);
  useEffect(() => {
    if (!focus || !data) return;
    const target = document.getElementById("comment-" + focus);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [focus, data]);
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
        <section
          className={
            "discussion" + (panel ? " bike-panel discussion-panel" : "")
          }
          id="discussion"
          aria-labelledby={panel ? "discussion-title" : undefined}
        >
          {panel ? (
            <div className="panel-heading">
              <h2 id="discussion-title">
                Комментарии{count != null && ` (${count})`}
              </h2>
              <div className="panel-heading-actions">
                {entityType !== "component" && bike.author?.id !== user?.id && (
                  <ReportButton
                    entityType={
                      entityType === "article" ? "journal" : entityType
                    }
                    targetId={bike.id}
                    user={user}
                  />
                )}
                {data &&
                  !expanded &&
                  (data.comments.length > shownThreads || data.hasMore) && (
                    <button
                      className="text-link"
                      onClick={() => setExpanded(true)}
                    >
                      Все комментарии
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  )}
              </div>
            </div>
          ) : (
            <div className="section-heading">
              <div>
                <h2>
                  <MessagesSquare size={20} aria-hidden="true" />
                  {entityType === "component"
                    ? "Обсуждение компонента"
                    : entityType === "article"
                      ? "Обсуждение статьи"
                      : entityType === "journal"
                        ? "Обсуждение записи"
                        : entityType === "ride"
                          ? "Обсуждение покатушки"
                          : "Обсуждение сборки"}
                </h2>
                <p className="help">
                  {entityType === "article"
                    ? "Вопросы, дополнения и личный опыт."
                    : "Детали, идеи и опыт владельцев."}
                </p>
              </div>
              {entityType !== "component" && bike.author?.id !== user?.id && (
                <ReportButton
                  entityType={entityType === "article" ? "journal" : entityType}
                  targetId={bike.id}
                  user={user}
                />
              )}
            </div>
          )}
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
              <EmailPolicyAction message={error} />
            </p>
          )}
          {data &&
            (panel && !expanded
              ? data.comments.slice(0, shownThreads)
              : data.comments
            ).map((c) => (
              <Thread
                key={c.id}
                root={c}
                initialReplies={panel && !expanded ? [] : c.replies}
                focusPath={data.focusPath}
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
                : entityType === "journal" ||
                    entityType === "article" ||
                    entityType === "component"
                  ? "Задайте вопрос или поделитесь своим опытом."
                  : "Первый вопрос о сборке может стать началом знакомства."}
            </p>
          )}
          {data && !(panel && !expanded) && (
            <PageControls {...data} onPage={setPage} />
          )}
          {user ? (
            <Editor
              label="Ваш комментарий"
              onSave={async (body) => {
                await socialApi(api.items + bike.id + "/comments", "POST", {
                  body,
                });
                // The short panel opens, so the new comment is not hidden.
                setExpanded(true);
                setPage(1);
                await refresh(null);
              }}
            />
          ) : (
            <Link className="button secondary small" href="/account">
              Войти, чтобы участвовать в обсуждении
            </Link>
          )}
        </section>
      </QuestionContext.Provider>
    </DiscussionKind.Provider>
  );
}
