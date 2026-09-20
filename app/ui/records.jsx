"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./records.module.css";
import { socialApi, SocialHeader, SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import AchievementArt from "./achievement-art.jsx";
import { gameDescription, groupRecords } from "../../lib/gamification-presentation.js";

function value(r, currency) {
  return (
    new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      ...(r.metric === "price" ? { style: "currency", currency } : {}),
    }).format(r.holder.value) +
    (r.metric === "weight" ? " кг" :
      ["upgrade", "completeness"].includes(r.metric) ? "%" : "")
  );
}

function RecordCard({ record: r, settings, index }) {
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
            {r.description || gameDescription("record", r, settings)}
          </p>
        </div>
        {b && (
          <div className="record-result">
            <Link prefetch={false} className="record-bike-name" href={"/b/" + b.shareId} title={b.name}>
              {b.name}
            </Link>
            <span className="record-value">{value(r, settings.currency)}</span>
          </div>
        )}
      </div>
      {b ? (
        <div className="record-meta">
          <Link prefetch={false} className="record-owner" href={"/u/" + b.author.username} title={b.author.name}>
            @{b.author.username}
          </Link>
          <small>{r.eligible} участн.</small>
        </div>
      ) : (
        <p className="record-empty" title="Рекорд свободен · Пока нет подходящих сборок.">
          <strong>Рекорд свободен</strong>{" · Пока нет подходящих сборок."}
        </p>
      )}
    </article>
  );
}

export function RecordGroups({ records, settings }) {
  return (
    <div className="record-groups" aria-label="Все рекорды сообщества">
      {groupRecords(records).map((group) => (
        <section className="record-group" key={group.id} data-record-group={group.id}
          aria-labelledby={"record-group-" + group.id}>
          <h2 id={"record-group-" + group.id} className="record-group-title">
            {group.name}<span aria-hidden="true">{group.records.length}</span>
          </h2>
          <div className="record-grid">
            {group.records.map((r, index) => (
              <RecordCard key={r.key} record={r} settings={settings} index={index} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Records() {
  const { setPreferences } = useSite();
  const [data, setData] = useState(null),
    [user, setUser] = useState(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([socialApi("game/records"), socialApi("me")])
      .then(([d, m]) => {
        if (!active) return;
        setData(d);
        setUser(m.user);
        setPreferences(m.user?.preferences || {});
      })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return (
    <>
      <SocialHeader user={user} />
      <main className={"social-page records-page " + styles.page}>
        <header className="hall-heading">
          <div>
            <p className="eyebrow">ColaBike · Hall of Fame</p>
            <h1>Сборки, о которых говорят</h1>
          </div>
          <p>Награды остаются. Рекорды нужно удержать.</p>
        </header>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">Ищем рекордсменов…</p>}
        {data && (
          <>
            <RecordGroups records={data.records} settings={data.settings} />
            {!data.records.length && <p className="help">Рекорды пока отключены администратором.</p>}
            <details className="hall-rules">
              <summary>Условия участия и подсчёт рекордов</summary>
              <p>
                Участвуют публичные велосипеды незаблокированных владельцев,
                без исключения администратором. Заполненность — от {data.settings.minimumCompleteness}%.
                Цена участвует только при включённом показе; валюта — {data.settings.currency}.
              </p>
              <p>
                Бюджетный герой: цена строго выше {data.settings.budgetMinimum} ₽,
                фото, производитель, модель и год. Допустимый вес:
                {" "}{data.settings.weightMinimum}–{data.settings.weightMaximum} кг;
                каждая категория соревнуется отдельно.
              </p>
              <p>
                Выбор сообщества — число уникальных пользователей, поставивших
                дополнительную реакцию. Лайки — отдельный рекорд. Собственные
                голоса и голоса заблокированных пользователей не считаются.
                При равенстве значений лидер определяется по стабильному ID велосипеда.
              </p>
            </details>
            <p className="hall-updated">Актуально на {new Date(data.asOf).toLocaleString("ru-RU")}</p>
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
