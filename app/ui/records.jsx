"use client";
import { useEffect, useState } from "react";
import { Trophy, ArrowUpRight } from "./icons.jsx";
import {
  socialApi,
  SocialHeader,
  SocialFooter,
  Avatar,
} from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import Photo from "./bike-photo.jsx";
function value(r, currency) {
  return (
    new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
      ...(r.metric === "price" ? { style: "currency", currency } : {}),
    }).format(r.holder.value) +
    (r.metric === "weight"
      ? " кг"
      : ["upgrade", "completeness"].includes(r.metric)
        ? "%"
        : "")
  );
}
function RecordCard({ record: r, currency }) {
  const b = r.holder;
  return (
    <article
      id={r.key}
      className={"record-card " + (!b ? "vacant" : "")}
      data-record={r.key}
    >
      <div className="record-cover">
        {b ? (
          <a href={"/b/" + b.shareId}>
            <Photo
              bike={{
                id: b.id,
                name: b.name,
                category: b.category,
                brand: "",
                model: "",
                photos: b.cover ? [{ id: b.cover }] : [],
              }}
            />
          </a>
        ) : (
          <Trophy size={42} />
        )}
        <span className="record-title">
          <Trophy size={16} />
          {r.name}
        </span>
      </div>
      <div className="record-info">
        {b ? (
          <>
            <strong className="record-value">{value(r, currency)}</strong>
            <h3>
              <a href={"/b/" + b.shareId}>
                {b.name}
                <ArrowUpRight size={17} />
              </a>
            </h3>
            <a className="record-owner" href={"/u/" + b.author.username}>
              <Avatar person={b.author} />
              <span>
                {b.author.name}
                <small>@{b.author.username}</small>
              </span>
            </a>
            <small>{r.eligible} участников · текущий лидер</small>
          </>
        ) : (
          <>
            <h3>Первый рекорд — впереди</h3>
            <p>Пока нет подходящих сборок.</p>
          </>
        )}
      </div>
    </article>
  );
}
export default function Records() {
  const { setPreferences } = useSite();
  const [data, setData] = useState(null),
    [user, setUser] = useState(),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([socialApi("game/records"), socialApi("me")])
      .then(([d, m]) => {
        setData(d);
        setUser(m.user);
        setPreferences(m.user?.preferences || {});
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page records-page">
        <header className="hall-heading">
          <p className="eyebrow">ColaBike · Hall of Fame</p>
          <h1>Сборки, о которых говорят</h1>
          <p>Награды остаются в истории. Рекорды нужно удержать.</p>
        </header>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">Ищем рекордсменов…</p>}
        {data && (
          <>
            <div className="hall-heroes">
              {data.records
                .filter((r) =>
                  ["community", "popular", "expensive"].includes(r.key),
                )
                .sort(
                  (a, b) =>
                    ["community", "popular", "expensive"].indexOf(a.key) -
                    ["community", "popular", "expensive"].indexOf(b.key),
                )
                .map((r) => (
                  <RecordCard
                    key={r.key}
                    record={r}
                    currency={data.settings.currency}
                  />
                ))}
            </div>
            <p className="help">
              Актуально на {new Date(data.asOf).toLocaleString("ru-RU")}. При
              равенстве значений лидер определяется по стабильному ID
              велосипеда.
            </p>
            <details className="hall-rules">
              <summary>Как становятся рекордсменами</summary>
              <p>
                Только публичные велосипеды незаблокированных владельцев, без
                исключения администратором. Заполненность — от{" "}
                {data.settings.minimumCompleteness}%. Цена участвует только при
                включённом показе; валюта площадки — {data.settings.currency}.
              </p>
              <p>
                Бюджетный герой: цена строго выше {data.settings.budgetMinimum}{" "}
                ₽, фото, производитель, модель и год. Допустимый вес:{" "}
                {data.settings.weightMinimum}–{data.settings.weightMaximum} кг;
                каждая категория соревнуется отдельно.
              </p>
              <p>
                Выбор сообщества — число уникальных пользователей, поставивших
                хотя бы одну дополнительную реакцию. Лайки — отдельный рекорд.
                Собственные голоса и голоса заблокированных пользователей не
                считаются. Прокаченность и заполненность используют открытые
                правила площадки.
              </p>
            </details>
            {["Цена", "Вес", "Популярность", "Community", "Прокаченность"].map(
              (group) => (
                <section className="record-group" key={group}>
                  <h2>{group === "Community" ? "Голос сообщества" : group}</h2>
                  <div className="record-grid">
                    {data.records
                      .filter(
                        (r) =>
                          r.group === group &&
                          !["community", "popular", "expensive"].includes(
                            r.key,
                          ),
                      )
                      .map((r) => (
                        <RecordCard
                          key={r.key}
                          record={r}
                          currency={data.settings.currency}
                        />
                      ))}
                  </div>
                  {!data.records.some((r) => r.group === group) && (
                    <p className="help">Рекорды этой группы отключены.</p>
                  )}
                  {group === "Популярность" && (
                    <a href="#popular">Любимец публики ↑</a>
                  )}
                  {group === "Цена" && (
                    <a href="#expensive">Без компромиссов ↑</a>
                  )}
                </section>
              ),
            )}
          </>
        )}
      </main>
      <SocialFooter />
    </>
  );
}
