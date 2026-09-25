"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./records.module.css";
import { socialApi, SocialHeader, SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import AchievementArt from "./achievement-art.jsx";
import { Medal, Trophy } from "./icons.jsx";
import { groupByMetric } from "../../lib/gamification-presentation.js";
import { metricValue } from "../../lib/game-metrics.js";
import { profilePath, publicPath } from "../../lib/public-urls.js";
import { personName, usernameLabel } from "../../lib/usernames.js";

// Where a record holder leads: a bike, a ride (with its bike), or a person.
function holderLink(b) {
  if (b.kind === "ride") return publicPath("ride", b);
  if (b.kind === "profile") return profilePath(b.author.username);
  return publicPath("bike", b);
}
// "Получил 1 человек", "Получили 3 человека", "Получили 12 человек".
function earnedBy(n) {
  if (n % 10 === 1 && n % 100 !== 11) return `Получил ${n} человек`;
  const few = [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100);
  return `Получили ${n} ${few ? "человека" : "человек"}`;
}

function RecordCard({ record: r, index }) {
  const b = r.holder;
  return (
    <article
      id={r.key}
      className={"record-card" + (!b ? " vacant" : "")}
      data-record={r.key}
      aria-labelledby={"record-title-" + r.key}
      aria-describedby={"record-description-" + r.key}
      style={{ "--record-delay": `${Math.min(index, 4) * 35}ms` }}
    >
      <div className="record-illustration">
        <AchievementArt imageId={r.imageId} size={160} />
      </div>
      <div className="record-content">
        <div className="record-heading">
          <h3 id={"record-title-" + r.key}>{r.name}</h3>
          <p id={"record-description-" + r.key} className="record-description">
            {r.description}
          </p>
        </div>
        {b && (
          <div className="record-result">
            <Link prefetch={false} className="record-bike-name" href={holderLink(b)} title={b.name}>
              {b.kind === "profile" ? personName(b.author) : b.name}
            </Link>
            <span className="record-value">{metricValue(r.metric, b.value)}</span>
          </div>
        )}
      </div>
      {b ? (
        <div className="record-meta">
          {b.kind === "ride" && (
            <Link prefetch={false} className="record-owner" href={publicPath("bike", b.bike)}>
              {b.bike.name}
            </Link>
          )}
          {b.kind !== "profile" && (
            <Link prefetch={false} className="record-owner" href={profilePath(b.author.username)} title={usernameLabel(b.author) || undefined}>
              {personName(b.author)}
            </Link>
          )}
          <small>{r.eligible} участн.</small>
        </div>
      ) : (
        <p className="record-empty" title="Рекорд свободен · Пока никто не выполнил условия.">
          <strong>Рекорд свободен</strong>{" · Пока никто не выполнил условия."}
        </p>
      )}
    </article>
  );
}

function AwardCard({ award: a, index }) {
  return (
    <article
      id={a.key}
      className="record-card award-card"
      data-award={a.key}
      aria-labelledby={"award-title-" + a.key}
      aria-describedby={"award-description-" + a.key}
      style={{ "--record-delay": `${Math.min(index, 4) * 35}ms` }}
    >
      <div className="record-illustration">
        <AchievementArt imageId={a.imageId} kind="achievement" size={160} />
      </div>
      <div className="record-content">
        <div className="record-heading">
          <h3 id={"award-title-" + a.key}>{a.name}</h3>
          <p id={"award-description-" + a.key} className="record-description">
            {a.description}
          </p>
        </div>
      </div>
      <p className="record-meta">
        {a.earners ? earnedBy(a.earners) : "Пока никто не получил"}
      </p>
    </article>
  );
}

function Groups({ items, label, Card }) {
  return (
    <div className="record-groups" aria-label={label}>
      {groupByMetric(items).map((group) => (
        <section className="record-group" key={group.id} data-record-group={group.id}
          aria-labelledby={label + "-" + group.id}>
          <h2 id={label + "-" + group.id} className="record-group-title">
            {group.name}<span aria-hidden="true">{group.items.length}</span>
          </h2>
          <div className="record-grid">
            {group.items.map((item, index) => (
              <Card key={item.key} {...{ [Card === AwardCard ? "award" : "record"]: item }} index={index} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
export function RecordGroups({ records }) {
  return <Groups items={records} label="Все рекорды сообщества" Card={RecordCard} />;
}

const tabs = [
  ["records", "Рекорды", Trophy],
  ["awards", "Награды", Medal],
];
export default function Records() {
  const { viewer: user } = useSite();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("records");
  useEffect(() => {
    if (new URLSearchParams(location.search).get("tab") === "awards") setTab("awards");
    let active = true;
    socialApi("game/records")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return (
    <>
      <SocialHeader user={user} />
      <main className={"page records-page " + styles.page}>
        <header className="hall-heading">
          <div>
            <p className="eyebrow">ColaBike · Hall of Fame</p>
            <h1>Сборки, о которых говорят</h1>
          </div>
          <p>Награды остаются. Рекорды нужно удержать.</p>
        </header>
        <nav className="ui-tabs hall-tabs" aria-label="Рекорды и награды">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} type="button" className="quiet" aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                history.replaceState(null, "", id === "awards" ? "/records?tab=awards" : "/records");
              }}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">Ищем рекордсменов…</p>}
        {data && tab === "records" && (
          <>
            <p className="help hall-lead">Рекорд держит один велосипед, покатушка или участник — и лидер может смениться.</p>
            <RecordGroups records={data.records} />
            {!data.records.length && <p className="help">Рекорды пока отключены администратором.</p>}
            <details className="hall-rules">
              <summary>Условия участия и подсчёт рекордов</summary>
              <p>
                Участвуют публичные велосипеды и покатушки незаблокированных
                владельцев; велосипед, исключённый модератором, не участвует.
                Заполненность карточки — от {data.settings.minimumCompleteness}%.
                Цена участвует только при включённом показе; валюта — {data.settings.currency}.
                Максимальная скорость покатушки — только если владелец её показывает.
              </p>
              <p>
                Минимальная цена: строго выше {data.settings.budgetMinimum} ₽,
                фото, производитель, модель и год. Допустимый вес:
                {" "}{data.settings.weightMinimum}–{data.settings.weightMaximum} кг;
                рекорды веса по категориям соревнуются отдельно.
              </p>
              <p>
                Выбор сообщества — число уникальных пользователей, поставивших
                дополнительную реакцию. Лайки — отдельный рекорд. Собственные
                голоса и голоса заблокированных пользователей не считаются.
                При равенстве значений лидер определяется по стабильному ID.
              </p>
            </details>
            <p className="hall-updated">Актуально на {new Date(data.asOf).toLocaleString("ru-RU")}</p>
          </>
        )}
        {data && tab === "awards" && (
          <>
            <p className="help hall-lead">Награда остаётся навсегда, даже если условие потом перестало выполняться.</p>
            <Groups items={data.awards || []} label="Все награды" Card={AwardCard} />
            {!data.awards?.length && <p className="help">Награды пока отключены администратором.</p>}
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
