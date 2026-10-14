import Image from "next/image";
import Link from "next/link";
import type { ClubSummaryDto } from "../../lib/club-contracts.ts";
import styles from "./clubs.module.css";
export default function ClubCard({ club }: { club: ClubSummaryDto }) {
  const state = club.archived
    ? "В архиве"
    : club.membership?.state === "pending"
      ? "Заявка отправлена"
      : club.membership?.state === "invited"
        ? "Приглашение"
        : club.membership?.state === "active"
          ? {
              owner: "Владелец",
              admin: "Администратор",
              organizer: "Организатор",
              member: "Участник",
            }[club.membership.role]
          : null;
  return (
    <article className={styles.card}>
      {club.logo ? (
        <Image
          unoptimized
          width={80}
          height={80}
          className={styles.logo}
          src={club.logo}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className={styles.logo} aria-hidden="true">
          {Array.from(club.name).slice(0, 2).join("").toUpperCase()}
        </span>
      )}
      <div>
        <h2>
          <Link href={"/clubs/" + club.id}>{club.name}</Link>
        </h2>
        {club.slogan && <p>{club.slogan}</p>}
        <p className={styles.meta}>
          {[club.city, ...club.formats].filter(Boolean).join(" · ")}
          {(club.city || club.formats.length > 0) && " · "}Участников:{" "}
          {club.memberCount}
        </p>
        {state && <p className={styles.memberState}>{state}</p>}
      </div>
    </article>
  );
}
