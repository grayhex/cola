"use client";
import { classificationLabels } from "../../lib/bike-classification.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ShoppingBag,
  CalendarDays,
  Bike,
  ArrowRight,
  Heart,
  MessageCircle,
  Trophy,
  BookOpen,
  Route,
  Pause,
  Play,
  Wrench,
} from "lucide-react";
import GlobalHeader from "./global-header.jsx";
import { SocialFooter } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { useBikeReaction } from "./use-bike-reaction.js";
import SearchBox from "./search-box.jsx";
import SmallImage from "./small-image.jsx";
import styles from "./home.module.css";
const markers = {
  market: ShoppingBag,
  planned: CalendarDays,
  bike: Bike,
  journal: BookOpen,
  ride: Route,
  achievement: Trophy,
};
function eventText(e) {
  if (e.type === "bike") return `${e.author} добавил ${e.title}`;
  if (e.type === "ride")
    return `${e.author} · ${e.title}${e.distanceM ? ` · ${Math.round(e.distanceM / 1000)} км` : ""}`;
  if (e.type === "achievement") return `${e.author} · ${e.title}`;
  return `${e.author} · ${e.title}`;
}
export function ActivityTicker({ events = [] }) {
  const [paused, setPaused] = useState(false);
  const list = (duplicate = false) => (
    <div
      className={styles.tickerList}
      aria-hidden={duplicate || undefined}
      inert={duplicate || undefined}
    >
      {events.map((e) => {
        const Marker = markers[e.type] || Bike;
        return (
          <Link key={e.id} href={e.href} tabIndex={duplicate ? -1 : undefined}>
            <Marker size={14} aria-hidden="true" />
            {eventText(e)}
          </Link>
        );
      })}
    </div>
  );
  return (
    <section
      className={styles.ticker}
      aria-label="Последние события сообщества"
    >
      <strong className={styles.live}>
        <i aria-hidden="true" />
        Live
      </strong>
      {events.length ? (
        <>
          <div
            className={styles.rail}
            tabIndex={0}
            aria-label="События; прокрутите, чтобы прочитать все"
          >
            <div
              className={styles.track}
              data-paused={paused}
              style={{
                "--ticker-duration": Math.max(60, events.length * 8) + "s",
              }}
            >
              {list()}
              {list(true)}
            </div>
          </div>
          <button
            className={styles.pause}
            aria-label={
              paused
                ? "Продолжить движение событий"
                : "Приостановить движение событий"
            }
            aria-pressed={paused}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </>
      ) : (
        <p>
          Первые истории ещё впереди.{" "}
          <Link href="/account?tab=bikes&action=add">Добавить велосипед →</Link>
        </p>
      )}
    </section>
  );
}
function TrendingBike({ bike, user }) {
  const { catalog } = useSite(),
    reaction = useBikeReaction(bike, user),
    href = "/b/" + bike.share_id;
  return (
    <article className={styles.bike} data-bike-id={bike.id}>
      <Link
        href={href}
        className={styles.thumbnailLink}
        aria-label={"Открыть " + bike.name}
      >
        <SmallImage
          className={styles.thumbnail}
          src={
            bike.photos[0] ? `/api/photos/${bike.photos[0].id}?width=160` : null
          }
        />
      </Link>
      <div className={styles.bikeBody}>
        <h3>
          <Link href={href}>{bike.name}</Link>
        </h3>
        <p className={styles.metadata}>
          {bike.author?.username ? (
            <Link href={"/u/" + bike.author.username}>{bike.author.name}</Link>
          ) : (
            bike.author?.name
          )}
          <span>·</span>
          {classificationLabels(bike).join(" · ") || bike.category}
          {bike.weight && (
            <>
              <span>·</span>
              {Number(bike.weight)} кг
            </>
          )}
        </p>
        <div className={styles.signals}>
          <button
            type="button"
            disabled={bike.is_owner}
            aria-label={"Нравится: " + reaction.likes}
            aria-pressed={reaction.liked}
            aria-busy={reaction.pending}
            onClick={reaction.toggle}
          >
            <Heart size={14} fill={reaction.liked ? "currentColor" : "none"} />
            {reaction.likes ?? 0}
          </button>
          <Link
            href={href + "#discussion"}
            aria-label={"Комментарии: " + (bike.comments || 0)}
          >
            <MessageCircle size={14} />
            {bike.comments || 0}
          </Link>
          {bike.badges?.[0] && (
            <span title={bike.badges[0].name}>
              <Trophy size={13} />
              {bike.badges[0].name}
            </span>
          )}
        </div>
        {reaction.error && (
          <p role="alert">Лайк не сохранился. Попробуйте ещё раз.</p>
        )}
      </div>
    </article>
  );
}
const emptyData = { popular: [], events: [], content: [], records: [] };
export default function Home() {
  const { settings, setPreferences } = useSite(),
    [data, setData] = useState(null),
    [user, setUser] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/me", { signal: controller.signal, cache: "no-store" }).then(
        (r) => r.json(),
      ),
      fetch("/api/discovery/home", {
        signal: controller.signal,
        cache: "no-store",
      }).then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      }),
    ])
      .then(([me, home]) => {
        if (controller.signal.aborted) return;
        setUser(me.user);
        setPreferences(me.user?.preferences || {});
        setData(home);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("Не удалось загрузить сообщество.");
      });
    return () => controller.abort();
  }, [revision]);
  const content = data || emptyData;
  return (
    <>
      <GlobalHeader user={user} />
      <main className={styles.home}>
        <section
          className={styles.hero}
          aria-labelledby="hero-title"
          style={{
            "--hero-light": settings.heroBackgroundLight,
            "--hero-dark": settings.heroBackgroundDark,
          }}
        >
          <div className={styles.heroContent}>
            <div className={styles.heroCopy}>
              <div className={styles.heroTitle}>
                <SmallImage
                  src={
                    settings.heroImageId
                      ? "/api/assets/" + settings.heroImageId
                      : null
                  }
                  className={styles.heroImage}
                  alt=""
                  priority
                />
                <h1 id="hero-title">
                  {settings.heroHeadline.split("\n").map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </h1>
              </div>
              <p className={styles.description}>{settings.heroDescription}</p>
              <div className={styles.heroSearch} data-home-search>
                <SearchBox hero />
              </div>
              <div className={styles.heroLinks}>
                <Link href="/bikes">
                  Смотреть велосипеды <ArrowRight size={14} />
                </Link>
                <span>или</span>
                <Link href="/account?tab=bikes&action=add">добавить свой</Link>
              </div>
            </div>
            <div
              className={styles.animationStage}
              data-hero-animation
              aria-hidden="true"
            >
              {settings.heroAnimationLightId && (
                <img
                  className={styles.animationLight}
                  src={"/api/assets/" + settings.heroAnimationLightId}
                  alt=""
                />
              )}
              {(settings.heroAnimationDarkId ||
                settings.heroAnimationLightId) && (
                <img
                  className={styles.animationDark}
                  src={
                    "/api/assets/" +
                    (settings.heroAnimationDarkId ||
                      settings.heroAnimationLightId)
                  }
                  alt=""
                />
              )}
              <span className={styles.stageLabel}>COLABIKE / В ДВИЖЕНИИ</span>
            </div>
          </div>
          <ActivityTicker events={content.events} />
        </section>
        {error && (
          <div className={styles.loadError} role="alert">
            {error}{" "}
            <button className="quiet" onClick={() => setRevision((v) => v + 1)}>
              Повторить
            </button>
          </div>
        )}
        <section className={styles.section} aria-labelledby="popular-heading">
          <div className={styles.sectionTitle}>
            <h2 id="popular-heading">Популярные велосипеды</h2>
          </div>
          <p className={styles.sectionNote}>
            Сборки, которые отмечает сообщество
          </p>
          <div className={styles.trending} aria-busy={!data && !error}>
            {content.popular.map((b) => (
              <TrendingBike key={b.id} bike={b} user={user} />
            ))}
            {!data &&
              !error &&
              Array.from({ length: 6 }, (_, i) => (
                <div className={styles.skeleton} key={i} aria-hidden="true" />
              ))}
          </div>
          {data && !content.popular.length && (
            <p className={styles.empty}>
              Пока нет публичных велосипедов. Ваш может стать первым.
            </p>
          )}
          <Link className={styles.sectionLink} href="/bikes?sort=popular">
            Смотреть все велосипеды <ArrowRight size={16} />
          </Link>
        </section>
        <section className={styles.section} aria-labelledby="community-heading">
          <div className={styles.sectionBar}>
            <h2 id="community-heading">Что нового</h2>
            <div>
              <Link href="/journal">Все записи →</Link>
              <Link href="/rides">Все покатушки →</Link>
              <Link href="/market">Рынок →</Link>
            </div>
          </div>
          <div className={styles.contentGrid}>
            {content.content.map((item) => {
              const Icon = {
                journal: BookOpen,
                ride: Route,
                bike: Bike,
                market: ShoppingBag,
                planned: CalendarDays,
              }[item.type];
              return (
                <article className={styles.story} key={item.id}>
                  <div className={styles.storyKind}>
                    <Icon size={16} />
                    {
                      {
                        market: "Рынок",
                        planned: "Планируемая покатушка",
                        journal: "Запись",
                        ride: "Покатушка",
                        bike: "Велосипед",
                      }[item.type]
                    }
                    <span>· {item.author}</span>
                  </div>
                  <h3>
                    <Link href={item.href}>{item.title}</Link>
                  </h3>
                  {item.excerpt && <p>{item.excerpt}</p>}
                  {item.distanceM != null && (
                    <span className={styles.distance}>
                      {(item.distanceM / 1000).toLocaleString("ru-RU", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      км
                    </span>
                  )}
                  <Link className={styles.readMore} href={item.href}>
                    Открыть <ArrowRight size={14} />
                  </Link>
                </article>
              );
            })}
          </div>
          {data && !content.content.length && (
            <p className={styles.empty}>
              Здесь появятся новые истории, маршруты и сборки.
            </p>
          )}
        </section>
        <section className={styles.section} aria-labelledby="records-heading">
          <div className={styles.sectionBar}>
            <h2 id="records-heading">Рекорды</h2>
            <Link href="/records">Все рекорды →</Link>
          </div>
          <div className={styles.records}>
            {content.records.map((record) => (
              <article className={styles.record} key={record.key}>
                <Trophy size={19} />
                <div>
                  <p>{record.name}</p>
                  <Link href={"/b/" + record.holder.shareId}>
                    {record.holder.name}
                  </Link>
                  <small>
                    {record.holder.value.toLocaleString("ru-RU")}
                    {record.metric === "weight"
                      ? " кг"
                      : record.metric === "price"
                        ? " ₽"
                        : record.metric === "likes"
                          ? " лайков"
                          : ""}
                  </small>
                </div>
              </article>
            ))}
          </div>
          {data && !content.records.length && (
            <p className={styles.empty}>
              Рекорды появятся, когда велосипеды выполнят условия рейтинга.{" "}
              <Link href="/records">Как это работает →</Link>
            </p>
          )}
        </section>
        <aside className={styles.about}>
          <Wrench size={22} />
          <p>
            У каждой сборки есть своя история.
            <br />
            <span>
              ColaBike помогает сохранить её — от первой детали до нового
              маршрута.
            </span>
          </p>
          <Link href="/about">
            О проекте <ArrowRight size={16} />
          </Link>
        </aside>
      </main>
      <SocialFooter />
    </>
  );
}
