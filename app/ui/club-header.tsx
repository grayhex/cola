import Image from "next/image";
import Link from "next/link";
import type { ClubDto } from "../../lib/club-contracts.ts";
import RichTextBody from "./rich-text-body.tsx";
import ClubMembershipControls from "./club-membership-controls.tsx";
import ClubReport from "./club-report.tsx";
import ClubLifecycle from "./club-lifecycle.tsx";
import ClubNoticeControls from "./club-notice-controls.tsx";
import ClubChat from "./club-chat.tsx";
import styles from "./clubs.module.css";
export default function ClubHeader({ club: c }: { club: ClubDto }) {
  return (
    <header className={styles.header}>
      {c.cover && (
        <Image
          unoptimized
          width={1600}
          height={640}
          className={styles.cover}
          src={c.cover}
          alt="Обложка клуба"
        />
      )}
      <div className={styles.identity}>
        {c.logo ? (
          <Image
            unoptimized
            width={512}
            height={512}
            className={styles.logo}
            src={c.logo}
            alt={"Логотип " + c.name}
          />
        ) : (
          <span className={styles.logo} aria-hidden="true">
            {Array.from(c.name.trim()).slice(0, 2).join("").toUpperCase()}
          </span>
        )}
        <div>
          <h1>{c.name}</h1>
          {c.slogan && <p>{c.slogan}</p>}
          <p className={styles.meta}>
            {[c.city, ...c.formats].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className={styles.body}>
        {c.archived && (
          <p className={styles.notice}>
            Клуб в архиве. История доступна для чтения.
          </p>
        )}

        <p className={styles.meta}>Участников: {c.memberCount}</p>
        <ClubMembershipControls
          key={
            c.id +
            ":" +
            c.version +
            ":" +
            c.membership?.state +
            ":" +
            c.membership?.role
          }
          initial={c}
        />
        <ClubChat club={c} />
        <ClubNoticeControls club={c} />
        <div className={styles.secondaryActions}>
          <Link className="button secondary" href={"/clubs/" + c.id + "/rules"}>
            Правила клуба
          </Link>
          {c.archived && <ClubLifecycle club={c} />}
          <ClubReport club={c} />
          {c.canManage && (
            <Link
              className="button secondary"
              href={"/clubs/" + c.id + "/manage"}
            >
              Управление
            </Link>
          )}
        </div>
        {c.mission && (
          <details className={styles.about}>
            <summary>О клубе</summary>
            <RichTextBody doc={c.missionDoc} />
          </details>
        )}
      </div>
    </header>
  );
}
