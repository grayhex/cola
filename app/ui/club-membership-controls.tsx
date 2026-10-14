"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClubDto } from "../../lib/club-contracts.ts";
import { useSite } from "./site-provider.tsx";
import { socialApi } from "./social-primitives.tsx";
import { useConfirmation } from "./confirmation.tsx";
import EmailPolicyAction from "./email-policy-action.tsx";
import styles from "./clubs.module.css";
const roles = {
  owner: "Владелец",
  admin: "Администратор",
  organizer: "Организатор",
  member: "Участник",
};
export default function ClubMembershipControls({
  initial,
}: {
  initial: ClubDto;
}) {
  const [club, setClub] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    { viewer } = useSite(),
    router = useRouter(),
    [ask, confirmation] = useConfirmation();
  if (club.archived) return null;
  if (!viewer)
    return (
      <Link
        className="button"
        href={"/login?next=" + encodeURIComponent("/clubs/" + club.id)}
      >
        Войти, чтобы вступить
      </Link>
    );
  const m = club.membership?.userId === viewer.id ? club.membership : null;
  async function action(
    value: "join" | "cancel" | "accept-invite" | "decline-invite" | "leave",
  ) {
    const copy =
      value === "leave"
        ? "Бейджи исчезнут, доступ к внутренним выездам и чату будет закрыт."
        : value === "join" || value === "accept-invite"
          ? "После вступления клубный бейдж автоматически появится в вашем профиле и на ваших велосипедах. Его можно скрыть в «Мои клубы»."
          : null;
    if (
      copy &&
      !(await ask(copy, {
        title:
          value === "leave"
            ? "Выйти из клуба?"
            : value === "join" && club.joinMode === "application"
              ? "Подать заявку?"
              : "Вступить в клуб?",
        confirmLabel:
          value === "leave"
            ? "Выйти"
            : value === "join" && club.joinMode === "application"
              ? "Подать заявку"
              : "Вступить",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await socialApi<{ club: ClubDto }>(
        "clubs/" + club.id + "/membership",
        "POST",
        { action: value },
      );
      setClub(result.club);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить членство");
    } finally {
      setBusy(false);
    }
  }
  const liveInvite =
    m?.state === "invited" &&
    m.inviteExpiresAt &&
    new Date(m.inviteExpiresAt) > new Date();
  return (
    <div>
      {!viewer.email_verified_at && <EmailPolicyAction />}
      <div className={styles.actions}>
        {m?.state === "blocked" ? (
          <p>Вступление в этот клуб недоступно.</p>
        ) : m?.state === "active" ? (
          <>
            <span>{roles[m.role]}</span>
            {m.role !== "owner" && (
              <details>
                <summary>Членство</summary>
                <button
                  className="button secondary danger"
                  disabled={busy}
                  onClick={() => action("leave")}
                >
                  Выйти из клуба
                </button>
              </details>
            )}
          </>
        ) : m?.state === "pending" ? (
          <>
            <span>Заявка отправлена</span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action("cancel")}
            >
              Отменить заявку
            </button>
          </>
        ) : liveInvite ? (
          <>
            <span>Вас пригласили в клуб</span>
            <button
              className="button"
              disabled={busy || !viewer.email_verified_at}
              onClick={() => action("accept-invite")}
            >
              Принять приглашение
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action("decline-invite")}
            >
              Отклонить
            </button>
          </>
        ) : (
          <>
            <button
              className="button"
              disabled={busy || !viewer.email_verified_at}
              onClick={() => action("join")}
            >
              {club.joinMode === "application" ? "Подать заявку" : "Вступить"}
            </button>
            {m?.state === "invited" && <span>Приглашение истекло</span>}
          </>
        )}
      </div>
      {club.ownershipOffer && m?.state === "active" && (
        <div className={styles.notice}>
          <p>
            Вам предлагают принять владение клубом. Нужны подтверждённая почта,
            собственный велосипед и место в лимите трёх клубов.
          </p>
          <div className={styles.actions}>
            {(["accept", "decline"] as const).map((value) => (
              <button
                key={value}
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    value === "accept" &&
                    !(await ask(
                      "Вы станете владельцем клуба, прежний владелец останется администратором.",
                      { title: "Принять владение?", confirmLabel: "Принять" },
                    ))
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    const result = await socialApi<{ club: ClubDto }>(
                      "clubs/" + club.id + "/transfer",
                      "POST",
                      { action: value, version: club.version },
                    );
                    setClub(result.club);
                    router.refresh();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Не удалось изменить владение",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {value === "accept" ? "Принять владение" : "Отклонить передачу"}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {confirmation}
    </div>
  );
}
