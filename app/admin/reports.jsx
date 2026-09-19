"use client";
import { useEffect, useState } from "react";
import { socialApi } from "../ui/social-primitives.jsx";
import { PageControls } from "../ui/community-controls.jsx";
export default function Reports({ onManageUser }) {
  const [status, setStatus] = useState("open"),
    [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(
      await socialApi(
        "community/admin/reports?status=" + status + "&page=" + page,
      ),
    );
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [status, page]);
  async function act(id, action) {
    setBusy(true);
    setError("");
    try {
      await socialApi("community/admin/reports/" + id, "PATCH", { action });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel">
      <div className="section-heading">
        <h2>Жалобы</h2>
        <select
          aria-label="Статус жалоб"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="open">Открытые</option>
          <option value="closed">Закрытые</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data?.reports.map((r) => (
        <article className="report-card" key={r.id}>
          <div>
            <strong>
              {
                {
                  comment: "Комментарий",
                  ride: "Покатушка",
                  ride_comment: "Комментарий к покатушке",
                  profile: "Профиль",
                  bike: "Велосипед",
                }[r.entityType]
              }{" "}
              · {r.target.name}
            </strong>
            <span>{new Date(r.createdAt).toLocaleString("ru-RU")}</span>
          </div>
          <p>
            От <a href={"/u/" + r.reporter.username}>@{r.reporter.username}</a>{" "}
            ·{" "}
            {
              {
                spam: "Спам",
                abuse: "Оскорбления",
                inappropriate: "Недопустимый контент",
                copyright: "Авторские права",
                other: "Другое",
              }[r.reason]
            }{" "}
            · {r.status === "open" ? "Открыта" : "Закрыта"}
          </p>
          {r.target.body && (
            <blockquote className="comment-body">{r.target.body}</blockquote>
          )}
          <div className="comment-actions">
            {r.target.href && (
              <a className="quiet" href={r.target.href}>
                Открыть объект
              </a>
            )}
            {r.target.username && (
              <button
                className="quiet"
                onClick={() => onManageUser(r.target.username)}
              >
                Управление пользователем
              </button>
            )}
            {r.status === "open" && (
              <>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => act(r.id, "close")}
                >
                  Закрыть жалобу
                </button>
                {r.entityType === "ride" && (
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => act(r.id, "hide_ride")}
                  >
                    Скрыть покатушку
                  </button>
                )}
                {["comment", "ride_comment"].includes(r.entityType) &&
                  !r.target.commentDeleted && (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => act(r.id, "delete_comment")}
                    >
                      Удалить комментарий
                    </button>
                  )}
              </>
            )}
          </div>
        </article>
      ))}
      {data && !data.reports.length && (
        <p className="help">Жалоб с этим статусом нет.</p>
      )}
      {data && <PageControls {...data} onPage={setPage} />}
    </section>
  );
}
