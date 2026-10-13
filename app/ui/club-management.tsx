"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClubDto } from "../../lib/club-contracts.ts";
import type { PublicAuthor } from "../../lib/contracts.ts";
import ClubEditor from "./club-editor.tsx";
import ClubMembers from "./club-members.tsx";
import ClubChat from "./club-chat.tsx";
import LocalDate from "./local-date.tsx";
import { useSite } from "./site-provider.tsx";
import { socialApi } from "./social-primitives.tsx";
import styles from "./clubs.module.css";
interface Administration {
  transfer: { targetId: string; expiresAt: string | null } | null;
  audit: {
    action: string;
    createdAt: string;
    actor: PublicAuthor | null;
    target: PublicAuthor | null;
  }[];
}
const actions: Record<string, string> = {
  created: "Клуб создан",
  edited: "Оформление изменено",
  rules_edited: "Правила изменены",
  logo_changed: "Логотип изменён",
  cover_changed: "Обложка изменена",
  chat_link_changed: "Дополнительная ссылка чата изменена",
  chat_message_removed: "Сообщение чата удалено администрацией",
  archived: "Клуб архивирован",
  restored: "Клуб восстановлен",
  membership_join: "Вступление или заявка",
  membership_cancel: "Заявка отменена",
  membership_leave: "Выход из клуба",
  membership_accept_invite: "Приглашение принято",
  membership_decline_invite: "Приглашение отклонено",
  member_approve: "Заявка принята",
  member_reject: "Заявка отклонена",
  member_invite: "Приглашение отправлено",
  member_revoke_invite: "Приглашение отозвано",
  member_exclude: "Участник исключён",
  member_block: "Клубная блокировка",
  member_unblock: "Блокировка снята",
  member_role: "Роль изменена",
  member_role_admin: "Назначен администратор",
  member_role_organizer: "Назначен организатор",
  member_role_member: "Назначен участник",
  ownership_offer: "Предложена передача владения",
  ownership_cancel: "Передача отменена",
  ownership_accept: "Передача принята",
  ownership_decline: "Передача отклонена",
};
export default function ClubManagement({
  club,
  section = "about",
}: {
  club: ClubDto;
  section?: string;
}) {
  const { viewer } = useSite();
  const allowed =
    !!viewer && club.membership?.userId === viewer.id && club.canManage;
  const [data, setData] = useState<Administration | null>(null),
    [error, setError] = useState(""),
    router = useRouter();
  useEffect(() => {
    let active = true;
    if (!allowed) {
      setData(null);
      return;
    }
    socialApi<Administration>("clubs/" + club.id + "/administration")
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить управление",
          );
      });
    return () => {
      active = false;
    };
  }, [club.id, club.version, allowed, viewer?.id]);
  if (!allowed)
    return (
      <section className={styles.page}>
        <h1>Управление недоступно</h1>
        <p>Обновите страницу или войдите в аккаунт администрации клуба.</p>
      </section>
    );
  return (
    <>
      <nav className={styles.page} aria-label="Управление клубом">
        <Link href={"/clubs/" + club.id}>{club.name}</Link>
        <div className={styles.actions}>
          {[
            ["about", "О клубе"],
            ["members", "Участники и заявки"],
            ["rules", "Правила"],
            ["chat", "Чат"],
          ].map(([key, label]) => (
            <Link
              key={key}
              className="button secondary"
              aria-current={section === key ? "page" : undefined}
              href={"/clubs/" + club.id + "/manage?section=" + key}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {section === "chat" ? (
        <section className={styles.page}>
          <ClubChat club={club} settings />
        </section>
      ) : section === "members" ? (
        <section className={styles.page}>
          <ClubMembers club={club} management />
          {data?.transfer && (
            <div className={styles.notice}>
              <p>
                Предложение передачи действует до{" "}
                <LocalDate value={data.transfer.expiresAt} />.
              </p>
              <button
                className="button secondary"
                onClick={async () => {
                  setError("");
                  try {
                    await socialApi("clubs/" + club.id + "/transfer", "POST", {
                      action: "cancel",
                      version: club.version,
                    });
                    router.refresh();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Не удалось отменить передачу",
                    );
                  }
                }}
              >
                Отменить передачу
              </button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <details>
            <summary>Журнал управления</summary>
            {data?.audit.map((a, i) => (
              <p key={i}>
                {actions[a.action] || "Членство изменено"}
                {a.target ? " · " + a.target.name : ""} ·{" "}
                {a.actor?.name || "Удалённый аккаунт"} ·{" "}
                <LocalDate value={a.createdAt} time />
              </p>
            ))}
          </details>
        </section>
      ) : (
        <ClubEditor initial={club} rulesOnly={section === "rules"} />
      )}
    </>
  );
}
