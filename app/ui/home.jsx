"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  ShoppingBag,
  CalendarDays,
  Bike,
  ArrowRight,
  Heart,
  Trophy,
  BookOpen,
  Route,
  Pause,
  Play,
} from "lucide-react";
import GlobalHeader from "./global-header.jsx";
import { SocialFooter, socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { useBikeReaction } from "./use-bike-reaction.js";
import { Avatar } from "./avatar.jsx";
import SmallImage from "./small-image.jsx";
import { photoVariants } from "./bike-photo.jsx";
import styles from "./home.module.css";
import { profilePath, publicPath } from "../../lib/public-urls.js";
import { classificationLabels } from "../../lib/bike-classification.js";
import { buildTags } from "../../lib/card-presentation.js";
import { recordValue } from "../../lib/gamification-presentation.js";
import { listingPriceLabel } from "../../lib/market-types.js";
import { routePaths } from "../../lib/ride-geometry.js";
import { plural } from "../../lib/plural.js";
const markers = {
  market: ShoppingBag,
  planned: CalendarDays,
  bike: Bike,
  journal: BookOpen,
  article: BookOpen,
  ride: Route,
  achievement: Trophy,
};
const number = (n) => Number(n || 0).toLocaleString("ru-RU");
const shortDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
    : "";
};
function eventText(e) {
  if (e.type === "bike") return `${e.author} добавил ${e.title}`;
  if (e.type === "ride")
    return `${e.author} · ${e.title}${e.distanceM ? ` · ${Math.round(e.distanceM / 1000)} км` : ""}`;
  return `${e.author} · ${e.title}`;
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
// Last word of the last line in the accent; lines stack on wide screens.
function Headline({ text }) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <h1 id="hero-title" className={styles.title}>
      {lines.map((line, i) => {
        if (i < lines.length - 1)
          return (
            <span key={i} className={styles.line}>
              {line}{" "}
            </span>
          );
        const cut = line.lastIndexOf(" ");
        return (
          <span key={i} className={styles.line}>
            {line.slice(0, cut + 1)}
            <span className={styles.accentWord}>{line.slice(cut + 1)}</span>
          </span>
        );
      })}
    </h1>
  );
}
// Live community events, one at a time; pauses on hover, focus, the button
// and reduced motion.
export function LiveCard({ events = [], icon = null }) {
  const [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false),
    [holding, setHolding] = useState(false),
    reduced = useReducedMotion(),
    count = events.length;
  useEffect(() => {
    if (paused || holding || reduced || count < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), 6000);
    return () => clearInterval(timer);
  }, [paused, holding, reduced, count]);
  const event = count ? events[index % count] : null,
    Marker = (event && markers[event.type]) || Bike;
  return (
    <section
      className={styles.live}
      aria-label="Последние события сообщества"
      onMouseEnter={() => setHolding(true)}
      onMouseLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHolding(false);
      }}
    >
      <span className={styles.liveIcon} aria-hidden="true">
        {icon ? <img src={icon} alt="" /> : <Marker size={20} />}
      </span>
      <div className={styles.liveText}>
        <span className={styles.liveLabel}>ColaBike / в движении</span>
        {event ? (
          <Link
            className={styles.liveEvent}
            href={event.href}
            // Profile links are not prefetched, see AuthorLink.
            prefetch={event.href?.startsWith("/@") ? false : undefined}
          >
            {eventText(event)}
          </Link>
        ) : (
          <strong className={styles.liveEvent}>
            Первые истории ещё впереди
          </strong>
        )}
      </div>
      {!event ? (
        <Link
          className={styles.liveAction}
          href="/account?tab=bikes&action=add"
        >
          Добавить велосипед
        </Link>
      ) : (
        count > 1 &&
        !reduced && (
          <button
            type="button"
            className={styles.livePause}
            aria-pressed={paused}
            aria-label={
              paused ? "Продолжить смену событий" : "Остановить смену событий"
            }
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        )
      )}
    </section>
  );
}
// The big frame: the admin's animation, else the most liked build, else a
// quiet drawing. The Live chip and the latest events sit on top of it.
function HeroVisual({ settings, cover, events }) {
  const light = settings.heroAnimationLightId,
    dark = settings.heroAnimationDarkId || light,
    [failed, setFailed] = useState(null),
    image = cover?.photos?.[0],
    photo = image && failed !== image.id ? image : null;
  return (
    <div
      className={styles.visual}
      data-light-animation={!!light}
      data-dark-animation={!!dark}
      style={{
        "--hero-light": settings.heroBackgroundLight,
        "--hero-dark": settings.heroBackgroundDark,
      }}
    >
      {photo ? (
        <Link
          className={styles.cover}
          href={publicPath("bike", cover)}
          aria-label={"Открыть " + cover.name}
          data-hero-cover
        >
          <img
            src={`/api/photos/${photo.id}?width=1280`}
            srcSet={photoVariants(photo.id)}
            sizes="(max-width: 1023px) 100vw, 50vw"
            alt=""
            fetchPriority="high"
            decoding="async"
            onError={() => setFailed(photo.id)}
          />
        </Link>
      ) : (
        <div className={styles.cover} aria-hidden="true" data-hero-cover>
          <svg
            className={styles.drawing}
            viewBox="0 0 200 120"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="50" cy="82" r="30" />
            <circle cx="150" cy="82" r="30" />
            <path d="M50 82L84 42H140L150 82M84 42L100 82H50M100 82L140 42M78 32H92M140 42L136 26L150 23" />
          </svg>
        </div>
      )}
      {(light || dark) && (
        <div className={styles.stage} data-hero-animation aria-hidden="true">
          {light && (
            <img
              className={styles.animationLight}
              src={"/api/assets/" + light}
              alt=""
            />
          )}
          {dark && (
            <img
              className={styles.animationDark}
              src={"/api/assets/" + dark}
              alt=""
            />
          )}
        </div>
      )}
      <span className={styles.liveChip}>
        <i aria-hidden="true" />
        Live
      </span>
      <LiveCard
        events={events}
        icon={
          settings.heroImageId ? "/api/assets/" + settings.heroImageId : null
        }
      />
    </div>
  );
}
function Hero({ settings, statistics, cover, events }) {
  const stats = statistics && [
    [
      number(statistics.bikes),
      plural(statistics.bikes, "сборка", "сборки", "сборок"),
    ],
    [
      number(statistics.rides),
      plural(statistics.rides, "покатушка", "покатушки", "покатушек"),
    ],
    [
      number(Math.round(Number(statistics.distance) / 1000)) + " км",
      "накатано вместе",
    ],
  ];
  const empty =
    !statistics ||
    !(statistics.bikes || statistics.rides || Number(statistics.distance));
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.copy}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>
            <i aria-hidden="true" />
            Сообщество велосипедистов
          </p>
          <Headline text={settings.heroHeadline} />
          <p className={styles.description}>{settings.heroDescription}</p>
          <div className={styles.actions}>
            <Link className="button accent large" href="/bikes">
              Смотреть велосипеды <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link
              className="button secondary large"
              href="/account?tab=bikes&action=add"
            >
              Добавить свой
            </Link>
          </div>
        </div>
        {!empty && (
          <dl className={styles.stats} aria-label="ColaBike в цифрах">
            {stats.map(([value, label]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <HeroVisual settings={settings} cover={cover} events={events} />
    </section>
  );
}
// Photo, type, like, name, one or two build parts, author and likes.
const cardSizes = "(max-width: 767px) 260px, (max-width: 1199px) 50vw, 330px";
function BikeCard({ bike, user }) {
  const reaction = useBikeReaction(bike, user),
    href = publicPath("bike", bike),
    photo = bike.photos?.[0],
    type = classificationLabels(bike)[0],
    tags = bike.tags ?? buildTags(bike.components);
  return (
    <article className={styles.card} data-bike-id={bike.id}>
      <div className={styles.cardPhoto}>
        <Link href={href} tabIndex={-1} aria-hidden="true">
          <SmallImage
            className={styles.cardImage}
            src={photo ? `/api/photos/${photo.id}?width=640` : null}
            srcSet={photo ? photoVariants(photo.id) : undefined}
            sizes={cardSizes}
          />
        </Link>
        {type && <span className={styles.cardType}>{type}</span>}
        <button
          type="button"
          className={styles.cardLike}
          disabled={bike.is_owner}
          aria-label={"Нравится: " + (reaction.likes ?? 0)}
          aria-pressed={reaction.liked}
          aria-busy={reaction.pending}
          onClick={reaction.toggle}
        >
          <Heart
            size={16}
            fill={reaction.liked ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className={styles.cardBody}>
        <h3>
          <Link href={href}>{bike.name}</Link>
        </h3>
        {tags.length > 0 && (
          <ul className={styles.tags} aria-label="Комплектация">
            {tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <div className={styles.cardMeta}>
          <span className={styles.author}>
            <Avatar person={bike.author} size="tiny" />
            {bike.author?.username ? (
              <Link prefetch={false} href={profilePath(bike.author.username)}>
                {bike.author.name}
              </Link>
            ) : (
              bike.author?.name
            )}
          </span>
          <span className={styles.likes} aria-hidden="true">
            <Heart size={13} /> {reaction.likes ?? 0}
          </span>
        </div>
        {reaction.error && (
          <p role="alert">Лайк не сохранился. Попробуйте ещё раз.</p>
        )}
      </div>
    </article>
  );
}
const chips = [
  ["", "Все"],
  ["road", "Шоссе"],
  ["gravel", "Гревел"],
  ["mtb", "МТБ"],
  ["urban_touring", "Город"],
];
function PopularBikes({ bikes, loading, user }) {
  const [category, setCategory] = useState(""),
    [byCategory, setByCategory] = useState({}),
    [failed, setFailed] = useState(""),
    [attempt, setAttempt] = useState(0);
  // A type shows its last list at once and refreshes it in the background.
  useEffect(() => {
    if (!category) return;
    let active = true;
    setFailed("");
    fetch(
      "/api/showcase?" + new URLSearchParams({ sort: "popular", category }),
      { cache: "no-store" },
    )
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((data) => {
        if (active)
          setByCategory((all) => ({ ...all, [category]: data.bikes }));
      })
      .catch(() => {
        if (active) setFailed(category);
      });
    return () => {
      active = false;
    };
  }, [category, attempt]);
  const list = (category ? byCategory[category] : bikes)?.slice(0, 8),
    busy = category ? !list && failed !== category : loading,
    all =
      "/bikes?" +
      new URLSearchParams({ sort: "popular", ...(category && { category }) });
  return (
    <section className={styles.section} aria-labelledby="popular-heading">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="popular-heading">
            Популярные<span className={styles.wide}> велосипеды</span>
          </h2>
          <p className={styles.note}>Сборки, которые отмечает сообщество</p>
        </div>
        <div className={styles.filters}>
          <div
            className={styles.chips}
            role="group"
            aria-label="Тип велосипеда"
          >
            {chips.map(([key, label]) => (
              <button
                key={key || "all"}
                type="button"
                className={styles.chip}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <Link className={styles.more} href={all}>
            Смотреть все <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className={styles.cards} aria-busy={busy}>
        {list?.map((b) => (
          <BikeCard key={b.id} bike={b} user={user} />
        ))}
        {busy &&
          Array.from({ length: 4 }, (_, i) => (
            <div className={styles.skeleton} key={i} aria-hidden="true" />
          ))}
      </div>
      {failed === category && category && !list && (
        <p className={styles.empty} role="alert">
          Не удалось загрузить велосипеды.{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Повторить
          </button>
        </p>
      )}
      {list && !list.length && (
        <div className={styles.empty}>
          <p>
            {category
              ? "Среди популярных пока нет велосипедов этого типа."
              : "Пока нет публичных велосипедов. Ваш может стать первым."}
          </p>
          <Link
            className="button secondary"
            href="/account?tab=bikes&action=add"
          >
            Добавить велосипед
          </Link>
        </div>
      )}
    </section>
  );
}
// Mini route like the ride pages draw it, without the map.
function RouteThumb({ geometry }) {
  const paths = routePaths(geometry || [], 112, 84, 10);
  return paths.length ? (
    <svg viewBox="0 0 112 84" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  ) : (
    <Route size={24} aria-hidden="true" />
  );
}
const feeds = {
  journal: {
    label: "Журнал",
    load: () =>
      socialApi("community/feed?page=1&type=journal&mode=new").then((d) =>
        d.items.map((e) => ({
          id: e.id,
          href: publicPath("journal", e),
          title: e.title,
          excerpt: e.excerpt,
          meta: [
            "Журнал",
            shortDate(e.publishedAt || e.createdAt),
            e.author?.name,
          ],
          image: e.photo ? e.photo + "?width=320" : null,
        })),
      ),
    empty: "Записей в журналах пока нет.",
    action: ["/j/new", "Написать в журнал"],
    all: ["/journal", "Весь журнал"],
  },
  rides: {
    label: "Покатушки",
    load: () =>
      socialApi("rides?page=1").then((d) =>
        d.rides.map((r) => ({
          id: r.id,
          href: publicPath("ride", r),
          title: r.title,
          excerpt: r.description,
          meta: [
            r.status === "completed" ? "Покатушка" : "Планы",
            r.metrics?.distanceM
              ? (r.metrics.distanceM / 1000).toLocaleString("ru-RU", {
                  maximumFractionDigits: 1,
                }) + " км"
              : null,
            shortDate(r.scheduledAt || r.date),
          ],
          route: r.geometry,
        })),
      ),
    empty: "Покатушек пока нет.",
    action: ["/account?tab=rides&action=add", "Добавить покатушку"],
    all: ["/rides", "Все покатушки"],
  },
  market: {
    label: "Рынок",
    load: () =>
      socialApi("market?page=1").then((d) =>
        d.items.map((m) => ({
          id: m.id,
          href: publicPath("market", m),
          title: m.title,
          excerpt: m.description,
          meta: ["Рынок", listingPriceLabel(m), m.location],
          image: m.photos?.[0]
            ? "/api/market/media/" + m.photos[0].id + "?width=320"
            : null,
        })),
      ),
    empty: "Объявлений пока нет.",
    action: ["/market/new", "Разместить объявление"],
    all: ["/market", "Весь рынок"],
  },
};
const feedIds = Object.keys(feeds);
function WhatsNew() {
  const [tab, setTab] = useState("journal"),
    [items, setItems] = useState({}),
    [errors, setErrors] = useState({}),
    tabs = useRef([]),
    id = useId();
  useEffect(() => {
    if (items[tab]) return;
    let active = true;
    feeds[tab]
      .load()
      .then((list) => {
        if (active) setItems((all) => ({ ...all, [tab]: list.slice(0, 4) }));
      })
      .catch((e) => {
        if (active) setErrors((all) => ({ ...all, [tab]: e.message }));
      });
    return () => {
      active = false;
    };
  }, [tab, items]);
  const feed = feeds[tab],
    list = items[tab],
    error = errors[tab];
  return (
    <section className={styles.news} aria-labelledby="community-heading">
      <div className={styles.newsHead}>
        <h2 id="community-heading">Что нового</h2>
        <div
          className={styles.segments}
          role="tablist"
          aria-label="Что показать"
          onKeyDown={(e) => {
            const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
            if (!step) return;
            e.preventDefault();
            const next =
              feedIds[
                (feedIds.indexOf(tab) + step + feedIds.length) % feedIds.length
              ];
            setTab(next);
            tabs.current[feedIds.indexOf(next)]?.focus();
          }}
        >
          {feedIds.map((key, i) => (
            <button
              key={key}
              ref={(el) => (tabs.current[i] = el)}
              type="button"
              role="tab"
              id={`${id}-${key}`}
              aria-selected={tab === key}
              aria-controls={`${id}-panel`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
            >
              {feeds[key].label}
            </button>
          ))}
        </div>
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        aria-busy={!list && !error}
      >
        {error ? (
          <p className={styles.empty} role="alert">
            {error}{" "}
            <button
              type="button"
              className="quiet"
              onClick={() => setErrors((all) => ({ ...all, [tab]: "" }))}
            >
              Повторить
            </button>
          </p>
        ) : !list ? (
          <div className={styles.newsSkeleton} aria-hidden="true" />
        ) : list.length ? (
          <ul className={styles.newsList}>
            {list.map((item) => (
              <li key={item.id}>
                <Link className={styles.newsItem} href={item.href}>
                  <span className={styles.thumb} aria-hidden="true">
                    {item.image ? (
                      <SmallImage src={item.image} />
                    ) : item.route !== undefined ? (
                      <RouteThumb geometry={item.route} />
                    ) : (
                      <BookOpen size={24} />
                    )}
                  </span>
                  <span className={styles.newsText}>
                    <span className={styles.newsMeta}>
                      {item.meta.filter(Boolean).join(" · ")}
                    </span>
                    <h3>{item.title}</h3>
                    {item.excerpt && <span>{item.excerpt}</span>}
                  </span>
                  <ArrowRight
                    className={styles.arrow}
                    size={22}
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <p>{feed.empty}</p>
            <Link className="button secondary" href={feed.action[0]}>
              {feed.action[1]}
            </Link>
          </div>
        )}
        {list?.length > 0 && (
          <Link className={styles.more} href={feed.all[0]}>
            {feed.all[1]} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}
function Records({ records, loading }) {
  const unit = (r) =>
    r.metric === "likes"
      ? " " + plural(r.holder.value, "лайк", "лайка", "лайков")
      : "";
  return (
    <section className={styles.records} aria-labelledby="records-heading">
      <div className={styles.recordsHead}>
        <h2 id="records-heading">Рекорды</h2>
        <Link href="/records">
          Все <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      {records.length ? (
        <ul className={styles.recordList}>
          {records.slice(0, 3).map((record) => (
            <li key={record.key}>
              <span className={styles.recordName}>{record.name}</span>
              <span className={styles.recordValue}>
                {recordValue(record) + unit(record)}
              </span>
              <Link
                className={styles.recordHolder}
                href={publicPath("bike", record.holder)}
              >
                {[record.holder.name, record.holder.author?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </Link>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <div className={styles.recordSkeleton} aria-hidden="true" />
      ) : (
        <p className={styles.recordEmpty}>
          Рекорды появятся, когда велосипеды выполнят условия рейтинга.{" "}
          <Link href="/records">Как это работает</Link>
        </p>
      )}
    </section>
  );
}
const emptyData = { popular: [], events: [], content: [], records: [] };
export default function Home({ statistics = null }) {
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
  const content = data || emptyData,
    cover = content.popular.find((b) => b.photos?.length);
  return (
    <>
      <GlobalHeader user={user} />
      <main className={styles.home}>
        <Hero
          settings={settings}
          statistics={statistics}
          cover={cover}
          events={content.events}
        />
        {error && (
          <div className={styles.loadError} role="alert">
            {error}{" "}
            <button className="quiet" onClick={() => setRevision((v) => v + 1)}>
              Повторить
            </button>
          </div>
        )}
        <PopularBikes
          bikes={data ? content.popular : null}
          loading={!data && !error}
          user={user}
        />
        <div className={styles.split}>
          <WhatsNew />
          <Records records={content.records} loading={!data && !error} />
        </div>
        <aside className={styles.cta} aria-label="О проекте">
          <p>
            У каждой сборки есть своя история. ColaBike помогает сохранить её —
            от первой детали до нового маршрута.
          </p>
          <Link className="button large" href="/about">
            О проекте
          </Link>
        </aside>
      </main>
      <SocialFooter />
    </>
  );
}
