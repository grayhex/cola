"use client";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { CommunityHomeDto } from "./content-types.ts";
import type { RecordHolder } from "../../lib/gamification.ts";
import type { JsonData } from "../../lib/contracts.ts";
import type { homeSnapshot } from "../../lib/discovery.ts";
import Link from "next/link";
import { AddBikeLink } from "./add-bike.tsx";
import { preload } from "react-dom";
import { heroWidths } from "../../lib/media-sizes.ts";
import { useEffect, useRef, useState } from "react";
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
  Info,
} from "lucide-react";
import GlobalHeader from "./global-header.tsx";
import { SocialFooter } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import { useAutoScroll } from "./use-auto-scroll.ts";
import BikeCarousel from "./bike-carousel.tsx";
import AchievementArt from "./achievement-art.tsx";
import TogetherActions from "./together-actions.tsx";
import RegistrationNote, { useRegistrationText } from "./registration-note.tsx";
import RidePulse from "./home-ride-pulse.tsx";
import BikeWeek from "./home-bike-week.tsx";
import { profilePath, publicPath } from "../../lib/public-urls.ts";
import { metricValue } from "../../lib/game-metrics.ts";
import { personName } from "../../lib/usernames.ts";
import styles from "./home.module.css";
export type HomeSnapshot = JsonData<Awaited<ReturnType<typeof homeSnapshot>>>;

function TogetherArt() {
  return (
    <svg
      className={styles.togetherArt}
      viewBox="0 0 320 220"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={styles.artRoute}
        d="M24 184 C70 180 72 120 118 118 S176 150 206 104 S250 40 296 36"
      />
      <path className={styles.artBranch} d="M60 36 C96 52 110 84 118 118" />
      <circle className={styles.artStart} cx="24" cy="184" r="6" />
      <circle className={styles.artStart} cx="60" cy="36" r="6" />
      <circle className={styles.artMeet} cx="118" cy="118" r="11" />
      <circle className={styles.artFinish} cx="118" cy="118" r="4" />
      <circle className={styles.artFinish} cx="296" cy="36" r="7" />
    </svg>
  );
}
function HomeBand({
  id,
  title,
  icon: Icon,
  action,
  children,
}: {
  id: string;
  title: string;
  icon: typeof Bike;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="frame" aria-labelledby={id + "-heading"}>
      <div className={"frame-inner " + styles.band} data-home-band={id}>
        <div className={styles.bandRail}>
          <h2 id={id + "-heading"}>
            <Icon size={16} aria-hidden="true" />
            {title}
          </h2>
          {action}
        </div>
        <div className={styles.bandBody}>{children}</div>
      </div>
    </section>
  );
}
const markers: Record<string, typeof Bike> = {
  market: ShoppingBag,
  planned: CalendarDays,
  bike: Bike,
  journal: BookOpen,
  article: BookOpen,
  ride: Route,
  achievement: Trophy,
};
function eventText(e: CommunityHomeDto["events"][number]) {
  if (e.type === "bike") return `${e.author} добавил ${e.title}`;
  if (e.type === "ride")
    return `${e.author} · ${e.title}${e.distanceM ? ` · ${Math.round(e.distanceM / 1000)} км` : ""}`;
  return `${e.author} · ${e.title}`;
}
// The community's last events in a slow line (Pricing runs a similar
// marquee): it pauses on hover, focus and the button, and stops for
// reduced motion. The copy for the seamless loop is inert.
export function ActivityTicker({
  events = [],
  paused = false,
  setPaused,
  speed = 24,
}: {
  events?: CommunityHomeDto["events"];
  paused?: boolean;
  setPaused: Dispatch<SetStateAction<boolean>>;
  speed?: number;
}) {
  const rail = useRef<HTMLDivElement>(null);
  useAutoScroll(rail, { speed, paused: paused || !events.length, loop: true });
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
            ref={rail}
            className={styles.rail}
            onWheel={() => setPaused(true)}
            onTouchStart={() => setPaused(true)}
            onKeyDown={() => setPaused(true)}
            tabIndex={0}
            aria-label="События; прокрутите, чтобы прочитать все"
          >
            <div className={styles.track} data-paused={paused}>
              {list()}
              {list(true)}
            </div>
          </div>
        </>
      ) : (
        <p>
          Первые истории ещё впереди.{" "}
          <AddBikeLink>Добавить велосипед →</AddBikeLink>
        </p>
      )}
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
    </section>
  );
}
// A record is held by a bike, a ride or a rider (#106).
function recordHolder(holder: JsonData<RecordHolder>): [string, string] {
  if (holder.kind === "ride") return [publicPath("ride", holder), holder.name];
  if (holder.kind === "profile")
    return [profilePath(holder.author.username), personName(holder.author)];
  return [publicPath("bike", holder), holder.name];
}

const destinations = [
  {
    href: "/rides",
    label: "Покатушки",
    text: "Маршруты и компания для выезда",
    icon: Route,
  },
  {
    href: "/components",
    label: "Компоненты",
    text: "Детали для вашей сборки",
    icon: Wrench,
  },
  {
    href: "/articles",
    label: "Статьи",
    text: "Опыт и знания сообщества",
    icon: BookOpen,
  },
  {
    href: "/market",
    label: "Рынок",
    text: "Найти нужное, передать лишнее",
    icon: ShoppingBag,
  },
];
// Match frame-inner: 1536px cap, responsive gutters and two 1px rails.
const heroSizes =
  "(min-width: 1584px) 1534px, (min-width: 768px) calc(100vw - 50px), (min-width: 360px) calc(100vw - 34px), calc(100vw - 26px)";
export default function Home() {
  const { settings, viewer: user, t } = useSite(),
    registrationText = useRegistrationText(),
    [paused, setPaused] = useState(false),
    [data, setData] = useState<HomeSnapshot | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/discovery/home?view=landing", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json() as Promise<HomeSnapshot>;
      })
      .then((home) => {
        if (!controller.signal.aborted) {
          setData(home);
          setError("");
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("Не удалось загрузить сообщество.");
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (Date.now() - last > 60_000) {
        last = Date.now();
        setRevision((v) => v + 1);
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const content = data || { events: [], records: [] };
  // The picture behind the hero (#382): one for each theme when the light one
  // is assigned, otherwise the single picture of both. Every picture goes
  // through the same responsive endpoint; with two, the one of the other theme
  // is hidden by the theme of the page (set before the first paint) and, being
  // lazy and hidden, is not fetched: only the current theme's is loaded.
  const darkHero = settings.heroBackgroundImageId || null,
    lightHero = settings.heroBackgroundLightImageId || null;
  const separate = !!lightHero && lightHero !== darkHero;
  const heroes = (
    separate
      ? [
          { theme: "light", id: lightHero },
          { theme: "dark", id: darkHero },
        ]
      : [{ theme: "both", id: darkHero || lightHero }]
  ).flatMap(({ theme, id }) => {
    if (!id) return [];
    const url = `/api/assets/${id}`;
    return [
      {
        theme,
        url,
        srcSet: heroWidths
          .map((width) => `${url}?width=${width} ${width}w`)
          .join(", "),
      },
    ];
  });
  // A picture for one theme only cannot be preloaded: the theme is not known
  // on the server.
  if (heroes.length === 1 && !separate)
    preload(heroes[0].url + "?width=2400", {
      as: "image",
      imageSrcSet: heroes[0].srcSet,
      imageSizes: heroSizes,
      fetchPriority: "high",
    });
  return (
    <>
      <GlobalHeader user={user} />
      <main className={styles.home}>
        <section className="frame" aria-labelledby="hero-title">
          <div className="frame-inner">
            <div className={styles.hero}>
              {heroes.map((hero) => (
                <img
                  key={hero.theme}
                  className={styles.heroImage}
                  data-hero-background
                  data-hero-theme={hero.theme}
                  src={hero.url + "?width=2400"}
                  srcSet={hero.srcSet}
                  sizes={heroSizes}
                  alt=""
                  fetchPriority="high"
                  loading={separate ? "lazy" : undefined}
                  decoding="async"
                />
              ))}
              <div className={styles.heroCopy}>
                <span className={styles.heroEyebrow}>
                  {settings.heroEyebrow}
                </span>
                <h1 id="hero-title">
                  {settings.heroHeadline.split("\n").map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </h1>
                <p className={styles.description}>{settings.heroDescription}</p>
              </div>
            </div>
            <ActivityTicker
              events={content.events}
              paused={paused}
              setPaused={setPaused}
              speed={settings.autoScrollSpeed}
            />
          </div>
        </section>
        <section className="frame" aria-labelledby="together-heading">
          <div className={"frame-inner " + styles.together}>
            <div className={styles.togetherCopy}>
              <span className="eyebrow">Покатушки</span>
              <h2 id="together-heading">
                Покататься вместе
                {/* The sign of the footnote below (#382), only for a guest and
                    only while the note has words: the title's name is the same. */}
                {!user && registrationText && (
                  <sup className={styles.footnoteMark} aria-hidden="true">
                    *
                  </sup>
                )}
              </h2>
              <p>
                Отметьте, когда хочется ехать, — подберём выезды и покажем, с
                кем можно собраться. Велосипед в гараже не нужен.
              </p>
              <TogetherActions
                key={user?.id || "guest"}
                signedIn={!!user}
                note={false}
                describedBy={
                  !user && registrationText ? "together-footnote" : undefined
                }
                onSaved={() => setRevision((v) => v + 1)}
              />
              {!user && (
                <RegistrationNote
                  id="together-footnote"
                  marker
                  className={styles.footnote}
                />
              )}
              <TogetherArt />
            </div>
            <div className={styles.pulsePanel}>
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
              <RidePulse pulse={data?.pulse} user={user} error={!!error} />
            </div>
          </div>
        </section>
        <HomeBand
          id="bike-week"
          title="Велосипед недели"
          icon={Bike}
          action={
            <Link className="text-link" href="/bikes">
              Все велосипеды <ArrowRight size={14} />
            </Link>
          }
        >
          <BikeWeek bike={data?.bikeOfWeek} loading={!data && !error} />
        </HomeBand>
        <HomeBand id="popular" title="Популярное на ColaBike" icon={Route}>
          <nav
            className={styles.destinations}
            aria-label="Популярное на ColaBike"
          >
            {destinations.map(({ href, label, text, icon: Icon }) => (
              <Link key={href} href={href} className={styles.destination}>
                <Icon size={22} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{text}</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </HomeBand>
        <HomeBand
          id="records"
          title="Рекорды"
          icon={Trophy}
          action={
            <Link className="text-link" href="/records">
              {t("Все рекорды")} <ArrowRight size={14} />
            </Link>
          }
        >
          {/* A manual rail (#264): it scrolls by wheel, touch, drag and the
              arrow keys, never by itself, and has no arrow buttons. */}
          {content.records.length > 0 && (
            <BikeCarousel
              compact
              label="Рекорды сообщества"
              railLabel="Рекорды; используйте стрелки для прокрутки"
            >
              {content.records.map((record) => {
                const [href, holder] = recordHolder(record.holder);
                return (
                  <article className={styles.record} key={record.key}>
                    {/* The rule's own illustration, a presentation size
                        loaded on scroll; a missing or broken one falls back
                        to the shared record mark. */}
                    <AchievementArt
                      imageId={record.imageId}
                      size={52}
                      loading="lazy"
                    />
                    <div>
                      <p>{record.name}</p>
                      <Link className="item-link" href={href}>
                        {holder}
                      </Link>
                      <small className="mono">
                        {metricValue(record.metric, record.holder.value)}
                      </small>
                    </div>
                  </article>
                );
              })}
            </BikeCarousel>
          )}
          {!data && !error && (
            <div className={styles.records} aria-hidden="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div className={"skeleton " + styles.recordSkeleton} key={i} />
              ))}
            </div>
          )}
          {data && !content.records.length && (
            <p className="empty-state">
              Рекорды появятся, когда велосипеды и покатушки выполнят условия.{" "}
              <Link className="text-link" href="/records">
                Как это работает
              </Link>
            </p>
          )}
          {error && <p className={styles.waiting}>Появится после загрузки.</p>}
        </HomeBand>

        <HomeBand id="about" title="О проекте" icon={Info}>
          <div className={styles.about}>
            <span className={styles.aboutMark} aria-hidden="true">
              <Bike size={28} />
            </span>
            <p>
              <strong>Велосипед объединяет.</strong>
              <span>
                ColaBike — место для ваших сборок, историй и новых дорог.
              </span>
            </p>
            <Link className="button secondary" href="/about">
              О проекте <ArrowRight size={16} />
            </Link>
          </div>
        </HomeBand>
      </main>
      <SocialFooter />
    </>
  );
}
