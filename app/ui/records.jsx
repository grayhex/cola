"use client";
import { useEffect, useState } from "react";
import { socialApi, SocialHeader, SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import AchievementArt from "./achievement-art.jsx";

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

function RecordCard({ record: r, currency }) {
  const b = r.holder;
  return (
    <article
      id={r.key}
      className={"record-card" + (!b ? " vacant" : "")}
      data-record={r.key}
      aria-labelledby={"record-title-" + r.key}
    >
      <div className="record-heading">
        <AchievementArt imageId={r.imageId} />
        <div>
          <span className="record-category">
            {r.group === "Community" ? "Сообщество" : r.group}
          </span>
          <h2 id={"record-title-" + r.key}>{r.name}</h2>
        </div>
      </div>
      {b ? (
        <>
          <div className="record-result">
            {b.cover && (
              <a className="record-bike-photo" href={"/b/" + b.shareId} tabIndex={-1} aria-hidden="true">
                <img src={"/api/photos/" + b.cover} alt="" loading="lazy" width={56} height={40} />
              </a>
            )}
            <div className="record-result-text">
              <strong className="record-value">{value(r, currency)}</strong>
              <a className="record-bike-name" href={"/b/" + b.shareId} title={b.name}>{b.name}</a>
            </div>
          </div>
          <div className="record-meta">
            <a className="record-owner" href={"/u/" + b.author.username} title={b.author.name}>@{b.author.username}</a>
            <small>{r.eligible} участн.</small>
          </div>
        </>
      ) : (
        <div className="record-empty">
          <strong>Рекорд свободен</strong>
          <p>Пока нет подходящих сборок.</p>
        </div>
      )}
    </article>
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
      <main className="social-page records-page">
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
            <div className="record-grid" aria-label="Все рекорды сообщества">
              {data.records.map((r) => (
                <RecordCard key={r.key} record={r} currency={data.settings.currency} />
              ))}
            </div>
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
