"use client";
import type { ReactNode, Dispatch, SetStateAction, CSSProperties } from "react";
import type { ViewerDto } from "../../lib/contracts.ts";
import type { CommunityHomeDto } from "./content-types.ts";
import type { RecordHolder } from "../../lib/gamification.ts";
import type { JsonData } from "../../lib/contracts.ts";
import Link from "next/link";
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
  Newspaper,
  Info,
} from "lucide-react";
import GlobalHeader from "./global-header.tsx";
import { SocialFooter } from "./social-primitives.tsx";
import { useSite } from "./site-provider.tsx";
import BikeCard from "./bike-card.tsx";
import { useAutoScroll } from "./use-auto-scroll.ts";
import BikeCarousel from "./bike-carousel.tsx";
import AchievementArt from "./achievement-art.tsx";
import { ContentTypeLabel } from "./content-label.tsx";
import SearchBox from "./search-box.tsx";
import HeroArtwork from "./hero-artwork.tsx";
import styles from "./home.module.css";
import TogetherActions from "./together-actions.tsx";
// A route over a ruled map: two riders meet on the way. Decoration only,
// drawn with semantic tokens so both themes read as one system.
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
        d="M24 184 C 70 180, 72 120, 118 118 S 176 150, 206 104 S 250 40, 296 36"
      />
      <path className={styles.artBranch} d="M60 36 C 96 52, 110 84, 118 118" />
      <circle className={styles.artStart} cx="24" cy="184" r="6" />
      <circle className={styles.artStart} cx="60" cy="36" r="6" />
      <circle className={styles.artMeet} cx="118" cy="118" r="11" />
      <circle className={styles.artMeetCore} cx="118" cy="118" r="4" />
      <circle className={styles.artFinish} cx="296" cy="36" r="7" />
      <g className={styles.artTag} transform="translate(186 140)">
        <rect width="104" height="40" rx="8" />
        <text x="12" y="17">
          СБ · 09:00
        </text>
        <text x="12" y="32">
          2 райдера
        </text>
      </g>
    </svg>
  );
}
// Blocks 3–6 of the home page (#254): a band of the ruled column like the hero
// and «Покататься вместе», its title in a thin rail inside the band with the
// section's links on the right. `tone` picks one of the few band surfaces.
function HomeBand({
  id,
  title,
  icon: Icon,
  action,
  tone,
  children,
}: {
  id: string;
  title: string;
  icon: typeof Bike;
  action?: ReactNode;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <section className="frame" aria-labelledby={id + "-heading"}>
      <div
        className={"frame-inner " + styles.band}
        data-tone={tone}
        data-home-band={id}
      >
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
// «Покататься вместе» (#245): one large block right after the hero, the same
// for a guest and a rider, with no personal data — the two actions open the
// composers in a window; a guest follows them to sign in.
function TogetherHero({ user }: { user: ViewerDto | null }) {
  return (
    <section className="frame" aria-labelledby="together-heading">
      <div className={"frame-inner " + styles.together}>
        <div className={styles.togetherCopy}>
          <span className="eyebrow">Покатушки</span>
          <h2 id="together-heading">Покататься вместе</h2>
          <p>
            Отметьте, когда хочется ехать, — подберём выезды и покажем, с кем
            можно собраться. Велосипед в гараже не нужен.
          </p>
          <TogetherActions key={user?.id || "guest"} signedIn={!!user} />
        </div>
        <TogetherArt />
      </div>
    </section>
  );
}
import { profilePath, publicPath } from "../../lib/public-urls.ts";
import { metricValue } from "../../lib/game-metrics.ts";
import { personName } from "../../lib/usernames.ts";
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
          <Link href="/account?tab=bikes&action=add">Добавить велосипед →</Link>
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
// One row: a glimpse of the next card makes horizontal scrolling discoverable.
const trendingSizes =
  "(max-width: 600px) 82vw, (max-width: 1050px) 50vw, 400px";
// A record is held by a bike, a ride or a rider (#106).
function recordHolder(holder: JsonData<RecordHolder>): [string, string] {
  if (holder.kind === "ride") return [publicPath("ride", holder), holder.name];
  if (holder.kind === "profile")
    return [profilePath(holder.author.username), personName(holder.author)];
  return [publicPath("bike", holder), holder.name];
}
const emptyData = { popular: [], events: [], content: [], records: [] };
export default function Home() {
  const { settings, viewer: user, t } = useSite(),
    [paused, setPaused] = useState(false),
    [data, setData] = useState<CommunityHomeDto | null>(null),
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
        return r.json() as Promise<CommunityHomeDto>;
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
        {/* Marketing intro (docs/development/design-system.md → Layout): the ruled column with the
            headline, search and the administrator's pictures and colours. */}
        <section className="frame" aria-labelledby="hero-title">
          <div
            className={"frame-inner " + styles.hero}
            style={
              // Without its own colours the block takes the accent (#131).
              settings.heroBackgroundMode === "custom"
                ? ({
                    "--hero-light": settings.heroBackgroundLight,
                    "--hero-dark": settings.heroBackgroundDark,
                  } as CSSProperties)
                : undefined
            }
          >
            <div className={styles.heroContent}>
              <div className={styles.heroCopy}>
                <div className={styles.heroTitle}>
                  <HeroArtwork
                    animation={settings.heroTitleAnimation}
                    imageId={settings.heroImageId}
                    playing={settings.heroAnimationsEnabled}
                    compact
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
                  <Link className="text-link" href="/bikes">
                    {t("Смотреть велосипеды")} <ArrowRight size={14} />
                  </Link>
                  <span>или</span>
                  <Link
                    className="text-link"
                    href="/account?tab=bikes&action=add"
                  >
                    {t("добавить свой")}
                  </Link>
                </div>
              </div>
              <div
                className={styles.animationStage}
                data-hero-animation
                aria-hidden="true"
              >
                <HeroArtwork
                  animation={settings.heroStageAnimation}
                  darkAnimation={settings.heroStageDarkAnimation}
                  imageId={settings.heroStageImageId}
                  playing={settings.heroAnimationsEnabled}
                />
                <span className={styles.stageLabel}>
                  {t("colabike / в движении")}
                </span>
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
        <TogetherHero user={user} />
        <HomeBand
          id="popular"
          title={t("Популярные велосипеды")}
          icon={Bike}
          action={
            <Link className="text-link" href="/bikes?sort=popular">
              {t("Все велосипеды")} <ArrowRight size={14} />
            </Link>
          }
        >
          {/* One status row for the whole page: the blocks below keep their
              geometry and say briefly that they are waiting for it. */}
          {error && (
            <p className={"error " + styles.status} role="alert">
              {error}{" "}
              <button
                className="quiet"
                onClick={() => setRevision((v) => v + 1)}
              >
                Повторить
              </button>
            </p>
          )}
          <BikeCarousel busy={!data && !error}>
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
          </BikeCarousel>
          {data && !content.popular.length && (
            <p className="empty-state">
              Пока нет публичных велосипедов. Ваш может стать первым.
            </p>
          )}
        </HomeBand>
        <HomeBand
          id="community"
          title={t("Что нового")}
          icon={Newspaper}
          tone="subtle"
          action={
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
          }
        >
          {content.content.length > 0 && (
            <div className={styles.stories}>
              {content.content.map((item) => {
                const Icon = markers[item.type] || BookOpen;
                return (
                  <article
                    className={styles.story}
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
                      <Link className={styles.storyLink} href={item.href}>
                        {item.title}
                      </Link>
                    </h3>
                    {item.excerpt && <p>{item.excerpt}</p>}
                  </article>
                );
              })}
            </div>
          )}
          {!data && !error && (
            <div className={styles.stories} aria-hidden="true">
              {Array.from({ length: 3 }, (_, i) => (
                <div className={styles.story} key={i}>
                  <span className={"skeleton " + styles.lineSkeleton} />
                  <span className={"skeleton " + styles.lineSkeleton} />
                </div>
              ))}
            </div>
          )}
          {data && !content.content.length && (
            <p className="empty-state">
              Здесь появятся новые истории, маршруты и сборки.
            </p>
          )}
          {error && <p className={styles.waiting}>Появится после загрузки.</p>}
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
        <HomeBand id="about" title="О проекте" icon={Info} tone="ruled">
          <div className={styles.about}>
            <span className={styles.aboutMark} aria-hidden="true">
              <Wrench size={22} />
            </span>
            <p>
              <strong>{t("У каждой сборки есть своя история.")}</strong>
              <span>
                ColaBike помогает сохранить её — от первой детали до нового
                маршрута.
              </span>
            </p>
            <Link className="button secondary" href="/about">
              Подробнее о проекте <ArrowRight size={16} />
            </Link>
          </div>
        </HomeBand>
      </main>
      <SocialFooter />
    </>
  );
}
