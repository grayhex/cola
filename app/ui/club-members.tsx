"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClubDto, ClubRole, ClubState } from "../../lib/club-contracts.ts";
import type { PublicAuthor } from "../../lib/contracts.ts";
import { socialApi } from "./social-primitives.tsx";
import { useConfirmation } from "./confirmation.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./clubs.module.css";
interface Member {
  user: PublicAuthor;
  role: ClubRole;
  state?: ClubState;
  inviteExpiresAt?: string | null;
}
interface Members {
  members: Member[];
  hasMore: boolean;
  page: number;
}
const roles = {
  owner: "Владелец",
  admin: "Администратор",
  organizer: "Организатор",
  member: "Участник",
};
const states = {
  pending: "Заявка",
  invited: "Приглашён",
  active: "Участник",
  left: "Вышел / заявка отменена",
  excluded: "Исключён",
  blocked: "Клубная блокировка",
};
export default function ClubMembers({
  club,
  management = false,
}: {
  club: ClubDto;
  management?: boolean;
}) {
  const { viewer } = useSite(),
    [page, setPage] = useState(1),
    [data, setData] = useState<Members | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [username, setUsername] = useState(""),
    [ask, confirmation] = useConfirmation();
  const allowed =
    (!management && club.membersVisibility === "public") ||
    (!!viewer &&
      club.membership?.userId === viewer.id &&
      club.membership.state === "active" &&
      (!management || club.canManage));
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (!allowed) return;
    socialApi<Members>(
      "clubs/" +
        club.id +
        "/members?page=" +
        page +
        (management ? "&manage=1" : ""),
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить состав",
          );
      });
    return () => {
      active = false;
    };
  }, [club.id, page, management, revision, allowed, viewer?.id]);
  async function manage(
    target: string,
    action: string,
    role?: "admin" | "organizer" | "member",
  ) {
    if (
      ["exclude", "block", "role"].includes(action) &&
      !(await ask(
        action === "role"
          ? "Права участника изменятся в этом клубе."
          : action === "block"
            ? "Человек потеряет клубные права и не сможет вступить снова, пока блокировка действует."
            : "Человек потеряет клубные права. Публичные публикации останутся.",
        {
          title:
            action === "role"
              ? "Изменить роль?"
              : action === "block"
                ? "Заблокировать в клубе?"
                : "Исключить участника?",
          confirmLabel:
            action === "role"
              ? "Изменить"
              : action === "block"
                ? "Заблокировать"
                : "Исключить",
        },
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await socialApi("clubs/" + club.id + "/members/" + target, "PATCH", {
        action,
        ...(role ? { role } : {}),
      });
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить состав");
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <section>
        <h2>Участники</h2>
        <p>
          {management
            ? "Управление доступно администрации клуба."
            : "Состав доступен участникам клуба."}
        </p>
      </section>
    );
  return (
    <section>
      <h2>{management ? "Участники и заявки" : "Участники"}</h2>
      {management && (
        <form
          className={styles.actions}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await socialApi<{ profile: PublicAuthor }>(
                "social/profiles/" +
                  encodeURIComponent(username.replace(/^@/, "")),
              );
              if (!result.profile) throw new Error("Пользователь не найден");
              await socialApi(
                "clubs/" + club.id + "/members/" + result.profile.id,
                "PATCH",
                { action: "invite" },
              );
              setUsername("");
              setRevision((v) => v + 1);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Не удалось пригласить",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Пригласить по имени пользователя
            <input
              maxLength={32}
              value={username}
              disabled={busy}
              placeholder="@username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy || !username.trim()}>
            Пригласить
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Загружаем состав…</p>}
      {data?.members.map((m) => (
        <article key={m.user.id} className={styles.notice}>
          <Link href={"/u/" + m.user.username}>
            {m.user.name} · @{m.user.username}
          </Link>
          <p>
            {m.state && management ? states[m.state] + " · " : ""}
            {roles[m.role]}
          </p>
          {management &&
            m.user.id !== viewer?.id &&
            m.role !== "owner" &&
            (club.membership?.role === "owner" || m.role !== "admin") && (
              <div className={styles.actions}>
                {m.state === "pending" && (
                  <>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => manage(m.user.id, "approve")}
                    >
                      Принять
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => manage(m.user.id, "reject")}
                    >
                      Отклонить заявку
                    </button>
                  </>
                )}
                {m.state === "invited" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => manage(m.user.id, "revoke-invite")}
                  >
                    Отозвать приглашение
                  </button>
                )}
                {m.state === "active" && (
                  <>
                    <label>
                      Роль
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) =>
                          manage(
                            m.user.id,
                            "role",
                            e.target.value === "admin"
                              ? "admin"
                              : e.target.value === "organizer"
                                ? "organizer"
                                : "member",
                          )
                        }
                      >
                        <option value="member">Участник</option>
                        <option value="organizer">Организатор</option>
                        {club.membership?.role === "owner" && (
                          <option value="admin">Администратор</option>
                        )}
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => manage(m.user.id, "exclude")}
                    >
                      Исключить
                    </button>
                  </>
                )}
                {m.state === "blocked" ? (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => manage(m.user.id, "unblock")}
                  >
                    Снять блокировку
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => manage(m.user.id, "block")}
                  >
                    Заблокировать в клубе
                  </button>
                )}
                {m.state === "active" && club.membership?.role === "owner" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !(await ask(
                          "Участник получит предложение и должен сам его принять. До этого вы остаётесь владельцем.",
                          {
                            title: "Предложить передачу владения?",
                            confirmLabel: "Предложить",
                          },
                        ))
                      )
                        return;
                      setBusy(true);
                      setError("");
                      try {
                        await socialApi(
                          "clubs/" + club.id + "/transfer",
                          "POST",
                          {
                            action: "offer",
                            targetId: m.user.id,
                            version: club.version,
                          },
                        );
                        location.reload();
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Не удалось предложить передачу",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Передать владение
                  </button>
                )}
              </div>
            )}
        </article>
      ))}
      {data && !data.members.length && <p>В этом списке пока никого нет.</p>}
      <div className={styles.actions}>
        {page > 1 && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setPage((v) => v - 1)}
          >
            Назад
          </button>
        )}
        {data?.hasMore && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setPage((v) => v + 1)}
          >
            Дальше
          </button>
        )}
      </div>
      {confirmation}
    </section>
  );
}
