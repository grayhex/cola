"use client";
import type {
  PlanInterestDto,
  InterestInvitationsDto,
  CreatedPlan,
} from "./ride-types.ts";
import { useEffect, useRef, useState } from "react";
import Modal from "./garage/modal.tsx";
import { Avatar, socialApi } from "./social-primitives.tsx";
import { errorMessage } from "../../lib/errors.ts";
import styles from "./plan-interest.module.css";

type InterestState = {
  status: "loading" | "reloading" | "ready" | "error";
  items?: PlanInterestDto["people"]["items"];
  pages?: number;
  total?: number;
  error?: string;
};
type InvitationResults = Omit<InterestInvitationsDto, "results"> & {
  results: (InterestInvitationsDto["results"][number] & { name: string })[];
};

// One request invites at most this many (matchLimits.inviteBatch on the
// server); the choice survives paging, so it is capped here too.
const inviteBatch = 20;
const fieldLabels: Record<string, string> = {
  time: "время",
  area: "район",
  duration: "длительность",
  distance: "дистанция",
  pace: "темп",
  purpose: "цель",
  surface: "покрытие",
  difficulty: "сложность",
  speed: "скорость",
  groupSize: "размер компании",
  regroupPolicy: "ожидание",
  beginnerFriendly: "новички",
};
const outcome: Record<string, string> = {
  invited: "Приглашение отправлено",
  already_invited: "Уже приглашён",
  declined: "Отказался от этой поездки — не приглашён",
  unavailable: "Интерес изменился — не приглашён",
  limit: "Достигнут лимит приглашений — не приглашён",
};

/** After the plan is published: people whose intent fits this occurrence,
 * chosen one by one; the server checks each again before inviting. */
export default function InviteFromInterest({
  plan,
  onClose,
}: {
  plan: CreatedPlan;
  onClose: () => void;
}) {
  const [state, setState] = useState<InterestState>({ status: "loading" }),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState(() => new Set<string>()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [results, setResults] = useState<InvitationResults | null>(null),
    [revision, setRevision] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, status: s.items ? "reloading" : "loading" }));
    socialApi<PlanInterestDto>(
      `ride-matches/plans/${plan.id}/interest?` +
        new URLSearchParams({
          occurrenceAt: plan.occurrenceAt,
          page: String(page),
        }),
    )
      .then((data) => {
        if (active)
          setState({
            status: "ready",
            items: data.people.items,
            pages: data.people.pages,
            total: data.people.total,
          });
      })
      .catch((e) => {
        if (active) setState({ status: "error", error: errorMessage(e) });
      });
    return () => {
      active = false;
    };
  }, [plan.id, plan.occurrenceAt, page, revision]);
  async function send() {
    // One request at a time: a second click waits for the first answer.
    if (sending.current || !chosen.size) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const answer = await socialApi<InterestInvitationsDto>(
        `ride-matches/plans/${plan.id}/invitations`,
        "POST",
        { occurrenceAt: plan.occurrenceAt, userIds: [...chosen] },
      );
      // Names as they were when sent: the list reloads without people whose
      // interest changed, but the answer still says who was not invited.
      const known = new Map(
        (state.items || []).map((p) => [p.author.id, p.author.name]),
      );
      setResults({
        ...answer,
        results: answer.results.map((r) => ({
          ...r,
          name: known.get(r.userId) || "Участник",
        })),
      });
      setChosen(new Set());
      setRevision((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal wide title="Пригласить заинтересованных" onClose={onClose}>
      <div className="planning-body">
        <section className="planning-section" aria-labelledby="invite-people">
          <h3 id="invite-people">Кого пригласить</h3>
          <p className="help">
            Покатушка сохранена. Здесь люди, чьё намерение подходит к её времени
            и формату и кто разрешил предложения. Приглашение — не участие:
            каждый ответит сам.
          </p>
          {state.status === "loading" && <p role="status">Подбираем людей…</p>}
          {state.status === "error" && (
            <div className="empty-state">
              <p role="alert" className="error">
                {state.error}
              </p>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setRevision((v) => v + 1)}
              >
                Повторить
              </button>
            </div>
          )}
          {state.items && !state.items.length && (
            <p className="empty-state">
              Сейчас нет людей, чьё намерение подходит к этой поездке. Её увидят
              в ленте покатушек.
            </p>
          )}
          {state.items && state.items.length > 0 && (
            <ul className={styles.people} aria-busy={state.status !== "ready"}>
              {state.items.map((p) => {
                const locked = p.invited || p.declined;
                const full =
                  chosen.size >= inviteBatch && !chosen.has(p.author.id);
                return (
                  <li key={p.author.id}>
                    <label className={styles.person}>
                      <input
                        type="checkbox"
                        disabled={locked || busy || full}
                        checked={locked ? p.invited : chosen.has(p.author.id)}
                        onChange={(e) =>
                          setChosen((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p.author.id);
                            else next.delete(p.author.id);
                            return next;
                          })
                        }
                      />
                      <Avatar person={p.author} size="small" />
                      <span className={styles.personText}>
                        <strong>{p.author.name}</strong>
                        <span className="meta">
                          <span>@{p.author.username}</span>
                          <span>
                            {p.readiness === "ready"
                              ? "Готов ехать"
                              : "Пока прикидывает"}
                          </span>
                          {p.invited && <span>Уже приглашён</span>}
                          {p.declined && <span>Отказался от этой поездки</span>}
                        </span>
                        {p.match.matched.length > 0 && (
                          <small>
                            Совпадает:{" "}
                            {p.match.matched
                              .map((f) => fieldLabels[f] || f)
                              .join(", ")}
                          </small>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {chosen.size >= inviteBatch && (
            <p className="help" role="status">
              За один раз можно пригласить {inviteBatch} человек. Отправьте
              этих, затем выберите остальных.
            </p>
          )}
          {(state.pages || 0) > 1 && (
            <div className={styles.pager}>
              <button
                type="button"
                className="button secondary small"
                disabled={page <= 1 || busy}
                onClick={() => setPage((v) => v - 1)}
              >
                Назад
              </button>
              <span className="mono">
                {page} / {state.pages}
              </span>
              <button
                type="button"
                className="button secondary small"
                disabled={page >= (state.pages || 0) || busy}
                onClick={() => setPage((v) => v + 1)}
              >
                Дальше
              </button>
            </div>
          )}
          {results && (
            <div role="status" className={styles.results}>
              <p>
                <strong>Отправлено приглашений: {results.invited}</strong>
              </p>
              <ul>
                {results.results
                  .filter((r) => r.status !== "invited")
                  .map((r) => (
                    <li key={r.userId}>
                      {r.name}: {outcome[r.status]}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <div className="planning-actions">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          Готово
        </button>
        <button
          type="button"
          className="button"
          disabled={!chosen.size || busy}
          onClick={send}
        >
          {busy
            ? "Отправляем…"
            : `Пригласить выбранных${chosen.size ? ` (${chosen.size})` : ""}`}
        </button>
      </div>
    </Modal>
  );
}
