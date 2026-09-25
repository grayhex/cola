"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ShoppingBag,
  CalendarDays,
  Bike,
  ArrowRight,
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
import BikeCard from "./bike-card.jsx";
import { ContentTypeLabel } from "./content-label.jsx";
import labelStyles from "./content-label.module.css";
import SearchBox from "./search-box.jsx";
import SmallImage from "./small-image.jsx";
import styles from "./home.module.css";
import { publicPath } from "../../lib/public-urls.js";
const markers = {
  market: ShoppingBag,
  planned: CalendarDays,
  bike: Bike,
  journal: BookOpen,
  article: BookOpen,
  ride: Route,
  achievement: Trophy,
};
function eventText(e) {
  if (e.type === "bike") return `${e.author} добавил ${e.title}`;
  if (e.type === "ride")
    return `${e.author} · ${e.title}${e.distanceM ? ` · ${Math.round(e.distanceM / 1000)} км` : ""}`;
  return `${e.author} · ${e.title}`;
}
// The community's last events in a slow line (Pricing runs a similar
// marquee): it pauses on hover, focus and the button, and stops for
// reduced motion. The copy for the seamless loop is inert.
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
          <Link
            key={e.id}
            href={e.href}
            // Profile links are not prefetched, see AuthorLink.
            prefetch={e.href?.startsWith("/@") ? false : undefined}
            tabIndex={duplicate ? -1 : undefined}
          >
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
            {paused ? <Play size={14} /> : <Pause size={14} />}
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
// Photo-first cards: three per row on desktop, two on tablets and phones.
const trendingSizes = "(max-width: 1050px) 50vw, 400px";
const units = { weight: " кг", price: " ₽", likes: " лайков" };
const emptyData = { popular: [], events: [], content: [], records: [] };
export default function Home() {
  const { settings, viewer: user } = useSite(),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/discovery/home", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((home) => {
        if (controller.signal.aborted) return;
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
        {/* Marketing intro (DESIGN.md → Layout): the ruled column with the
            headline, search and the administrator's pictures and colours. */}
        <section className="frame" aria-labelledby="hero-title">
          <div
            className={"frame-inner " + styles.hero}
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
                <p className={styles.description}>
                  {settings.heroDescription}
                </p>
                <div className={styles.heroSearch} data-home-search>
                  <SearchBox hero />
                </div>
                <div className={styles.heroLinks}>
                  <Link className="text-link" href="/bikes">
                    Смотреть велосипеды <ArrowRight size={14} />
                  </Link>
                  <span>или</span>
                  <Link className="text-link" href="/account?tab=bikes&action=add">
                    добавить свой
                  </Link>
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
                <span className={styles.stageLabel}>colabike / в движении</span>
              </div>
            </div>
            <ActivityTicker events={content.events} />
          </div>
        </section>
        <div className={"page " + styles.sections}>
          {error && (
            <p className="error" role="alert">
              {error}{" "}
              <button
                className="quiet"
                onClick={() => setRevision((v) => v + 1)}
              >
                Повторить
              </button>
            </p>
          )}
          <section className="section" aria-labelledby="popular-heading">
            <div className="section-head">
              <h2 id="popular-heading">Популярные велосипеды</h2>
              <Link className="text-link" href="/bikes?sort=popular">
                Все велосипеды <ArrowRight size={14} />
              </Link>
            </div>
            <div className={styles.trending} aria-busy={!data && !error}>
              {content.popular.map((b) => (
                <BikeCard
                  key={b.id}
                  bike={b}
                  user={user}
                  headingLevel={3}
                  sizes={trendingSizes}
                />
              ))}
              {!data &&
                !error &&
                Array.from({ length: 6 }, (_, i) => (
                  <div
                    className={"skeleton " + styles.skeleton}
                    key={i}
                    aria-hidden="true"
                  />
                ))}
            </div>
            {data && !content.popular.length && (
              <p className="empty-state">
                Пока нет публичных велосипедов. Ваш может стать первым.
              </p>
            )}
          </section>
          <section className="section" aria-labelledby="community-heading">
            <div className="section-head">
              <h2 id="community-heading">Что нового</h2>
              <nav className={styles.sectionLinks} aria-label="Разделы">
                <Link className="text-link" href="/journal">
                  Журнал
                </Link>
                <Link className="text-link" href="/rides">
                  Покатушки
                </Link>
                <Link className="text-link" href="/market">
                  Рынок
                </Link>
              </nav>
            </div>
            <div className="list-grid">
              {content.content.map((item) => {
                const Icon = markers[item.type] || BookOpen;
                return (
                  <article
                    className={`item-card ${styles.story} ${labelStyles.eventCard}`}
                    key={item.id}
                    data-event={item.type}
                  >
                    <div className={styles.storyHead}>
                      <ContentTypeLabel type={item.type}>
                        <Icon size={12} aria-hidden="true" />
                      </ContentTypeLabel>
                      <span className="meta">
                        <span>{item.author}</span>
                        {item.distanceM != null && (
                          <span className="mono">
                            {(item.distanceM / 1000).toLocaleString("ru-RU", {
                              maximumFractionDigits: 1,
                            })}{" "}
                            км
                          </span>
                        )}
                      </span>
                    </div>
                    <h3>
                      <Link className="item-link" href={item.href}>
                        {item.title}
                      </Link>
                    </h3>
                    {item.excerpt && <p>{item.excerpt}</p>}
                  </article>
                );
              })}
            </div>
            {data && !content.content.length && (
              <p className="empty-state">
                Здесь появятся новые истории, маршруты и сборки.
              </p>
            )}
          </section>
          <section className="section" aria-labelledby="records-heading">
            <div className="section-head">
              <h2 id="records-heading">Рекорды</h2>
              <Link className="text-link" href="/records">
                Все рекорды <ArrowRight size={14} />
              </Link>
            </div>
            <div className={styles.records}>
              {content.records.map((record) => (
                <article className={"item-card " + styles.record} key={record.key}>
                  <span className={styles.recordIcon} aria-hidden="true">
                    <Trophy size={16} />
                  </span>
                  <div>
                    <p>{record.name}</p>
                    <Link className="item-link" href={publicPath("bike", record.holder)}>
                      {record.holder.name}
                    </Link>
                    <small className="mono">
                      {record.holder.value.toLocaleString("ru-RU")}
                      {units[record.metric] || ""}
                    </small>
                  </div>
                </article>
              ))}
            </div>
            {data && !content.records.length && (
              <p className="empty-state">
                Рекорды появятся, когда велосипеды выполнят условия рейтинга.{" "}
                <Link className="text-link" href="/records">
                  Как это работает
                </Link>
              </p>
            )}
          </section>
          <aside className={styles.about}>
            <span className="mk-cell-icon" aria-hidden="true">
              <Wrench size={20} />
            </span>
            <p>
              <strong>У каждой сборки есть своя история.</strong>
              <span>
                ColaBike помогает сохранить её — от первой детали до нового
                маршрута.
              </span>
            </p>
            <Link className="button secondary" href="/about">
              О проекте <ArrowRight size={16} />
            </Link>
          </aside>
        </div>
      </main>
      <SocialFooter />
    </>
  );
}
