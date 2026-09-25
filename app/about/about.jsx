"use client";
import { useEffect } from "react";
import {
  Bell,
  Bike,
  Bookmark,
  Calendar,
  Check,
  CheckCheck,
  CircleCheck,
  Code2,
  Heart,
  Layers,
  Link2,
  Lock,
  MessageCircle,
  NotebookPen,
  ScanLine,
  Search,
  ShieldCheck,
} from "../ui/icons.jsx";
import { useSite } from "../ui/site-provider.jsx";
import { SocialHeader, SocialFooter } from "../ui/social-primitives.jsx";
import { useReveal } from "../ui/use-reveal.js";
import Link from "next/link";
import { legalKinds, legalTitles } from "../../lib/legal-titles.js";
import {
  aboutHero,
  aboutSections,
  aboutDefaults,
} from "../../lib/about-content.js";
import styles from "./about.module.css";

const icons = {
  bike: Bike,
  journal: NotebookPen,
  search: Search,
  shield: ShieldCheck,
  code: Code2,
  scan: ScanLine,
  lock: Lock,
  check: CheckCheck,
  layers: Layers,
};
const illustrations = {
  guide: "aboutGuideImageId",
  technology: "aboutTechnologyImageId",
};

// The hero's glyph field, after Pricing's ASCII background: wheels, routes
// and sparks in a fixed pattern (no randomness, so server and client agree).
const glyphs = ["◎", "·", "⟡", "·", "✳", "◎", "·", "→", "○", "·", "✦", "⟡"];
function GlyphField() {
  return (
    <div className="glyph-field" aria-hidden="true">
      {Array.from({ length: 22 }, (_, row) => (
        <div key={row}>
          {Array.from({ length: 64 }, (_, col) => {
            const glyph = glyphs[(col * 7 + row * 5) % glyphs.length];
            const text = glyph + (col < 63 ? "  " : "");
            if ((col * 13 + row * 29) % 23 === 0)
              return <i key={col}>{text}</i>;
            if ((col * 11 + row * 17) % 19 === 0)
              return <b key={col}>{text}</b>;
            return text;
          })}
        </div>
      ))}
    </div>
  );
}

function Statistics({ statistics }) {
  const cells = [
    ["Участников", statistics.users],
    ["Велосипедов", statistics.bikes],
    ["Покатушек", statistics.rides],
    ["Записей журнала", statistics.entries],
    ["Километров", Math.round(Number(statistics.distance) / 1000)],
  ];
  return (
    <section className={styles.stats} aria-label="ColaBike в цифрах">
      <p className={styles.statsLead}>
        Гараж растёт
        <br /> вместе с <span>сообществом</span>
      </p>
      <dl>
        {cells.map(([label, n]) => (
          <div key={label}>
            <dd>{Number(n || 0).toLocaleString("ru-RU")}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      <p className={styles.statsNote}>
        Велосипеды, записи, покатушки и километры — только из публичного гаража.
      </p>
    </section>
  );
}

// A bike icon in quiet concentric rings (Storage's security emblem), or the
// picture chosen in Админка → Дизайн → Графика.
function Emblem({ asset, icon: Icon }) {
  if (asset)
    return (
      <img
        className={styles.illustration}
        src={"/api/assets/" + asset}
        alt=""
        loading="lazy"
        decoding="async"
      />
    );
  return (
    <div className={styles.emblem} aria-hidden="true">
      <span />
      <span />
      <span />
      <Icon size={44} strokeWidth={1.5} />
    </div>
  );
}

function Cells({ items }) {
  return (
    <div className="mk-cells">
      {items.map((item) => {
        const Icon = icons[item.icon] || Bike;
        return (
          <article key={item.id} data-reveal-item>
            <span className="mk-cell-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        );
      })}
    </div>
  );
}

/* ── Demonstrations: static pictures of real screens (HTML, CSS, SVG). ── */
function BikeDemo() {
  const parts = [
    ["Рама", "Cube Nuroad C:62"],
    ["Групсет", "Shimano GRX 820 2×12"],
    ["Колёса", "DT Swiss G 1800"],
    ["Покрышки", "Schwalbe G-One Overland 45"],
  ];
  return (
    <div className={styles.demoStack}>
      <div className={"mk-mini " + styles.resolver}>
        <div className={styles.resolverLine}>
          <Link2 size={14} />
          <span className="mono">shop.example/cube-nuroad-race</span>
        </div>
        <div className={styles.track}>
          <i />
        </div>
        <div className={styles.resolverDone}>
          <CircleCheck size={14} />
          Найдено 12 деталей и 3 фото
        </div>
      </div>
      <div className={"mk-mini " + styles.bikeCard}>
        <div className={styles.bikeHead}>
          <svg
            className={styles.bikePhoto}
            viewBox="0 0 120 80"
            role="presentation"
          >
            <rect width="120" height="80" rx="8" />
            <g>
              <circle cx="34" cy="52" r="15" />
              <circle cx="88" cy="52" r="15" />
              <path d="M34 52 51 32h28l9 20M51 32l9 20H34m26 0 19-20M47 26h8m24 6-3-9 8-2" />
            </g>
          </svg>
          <div>
            <strong>Cube Nuroad Race</strong>
            <span className="meta">
              <span>Гравийник</span>
              <span>M</span>
              <span>9,4 кг</span>
            </span>
          </div>
        </div>
        <ul className={styles.parts}>
          {parts.map(([group, name]) => (
            <li key={group}>
              <span>{group}</span>
              <b>{name}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function JournalDemo() {
  const entries = [
    {
      kind: "Обслуживание",
      tone: "info",
      at: "3 040 км · 12 мая",
      title: "Замена кассеты и цепи",
      parts: ["Кассета 11-34 → 11-36", "Цепь CN-M8100"],
    },
    {
      kind: "Впечатления",
      tone: "accent",
      at: "1 200 км · 18 апреля",
      title: "Первые выходные на грунте",
    },
    {
      kind: "Сборка / апгрейд",
      tone: "success",
      at: "0 км · 2 марта",
      title: "Первая версия сборки",
    },
  ];
  return (
    <ol className={styles.timeline}>
      {entries.map((e) => (
        <li key={e.title}>
          <div className="mk-mini">
            <div className={styles.entryHead}>
              <span className="badge" data-tone={e.tone}>
                {e.kind}
              </span>
              <span className="mono">{e.at}</span>
            </div>
            <strong>{e.title}</strong>
            {e.parts && (
              <div className={styles.snapshot}>
                {e.parts.map((p) => (
                  <span key={p} className="tag small">
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReadingDemo() {
  return (
    <div className={styles.demoStack}>
      <div className={"mk-mini " + styles.feedCard}>
        <div className={styles.feedHead}>
          <span className={styles.avatar}>МК</span>
          <div>
            <strong>Марина Котова</strong>
            <span className="meta">
              <span>Specialized Stumpjumper</span>
            </span>
          </div>
        </div>
        <span className="badge" data-tone="accent">
          <Bell size={12} /> Подписка на автора и велосипед
        </span>
        <strong className={styles.feedTitle}>Первый выезд в горы</strong>
        <p className={styles.feedText}>
          Проехали 40 км по тропам, вилка отработала отлично — давление оставил
          заводским.
        </p>
        <span className="meta">
          <span>
            <Heart /> 12
          </span>
          <span>
            <MessageCircle /> 3
          </span>
          <span className={styles.saved}>
            <Bookmark /> В сохранённом
          </span>
        </span>
      </div>
      <div className={"mk-mini " + styles.note}>
        <CheckCheck size={16} />
        Запись показана один раз, даже если вы подписаны и на автора, и на
        велосипед.
      </div>
    </div>
  );
}

function RidesDemo() {
  return (
    <div className={styles.demoStack}>
      <div className={"mk-mini " + styles.rideCard}>
        <svg className={styles.map} viewBox="0 0 320 170" role="presentation">
          <defs>
            <pattern
              id="about-map-grid"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <path className={styles.gridLine} d="M20 0H0v20" />
            </pattern>
            <pattern
              id="about-map-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <path className={styles.hatchLine} d="M0 0v6" />
            </pattern>
          </defs>
          <rect width="320" height="170" className={styles.mapGrid} />
          <path
            className={styles.mapWater}
            d="M188 104c16-18 50-20 66-6 14 12 8 34-14 40-24 8-66-12-52-34Z"
          />
          <path
            className={styles.routeHidden}
            d="M46 132c10-6 18-14 22-24"
            pathLength="1"
          />
          <path
            className={styles.route}
            d="M68 108c10-24 22-50 52-60 30-10 48 10 64 28s38 16 58 4 22-30 12-44"
            pathLength="1"
          />
          <path
            className={styles.routeHidden}
            d="M254 36c-4-8-12-14-22-16"
            pathLength="1"
          />
          <circle className={styles.zone} cx="46" cy="132" r="30" />
          <circle className={styles.zone} cx="240" cy="24" r="26" />
        </svg>
        <dl className={styles.metrics}>
          <div>
            <dt>Дистанция</dt>
            <dd>42,3 км</dd>
          </div>
          <div>
            <dt>Набор</dt>
            <dd>380 м</dd>
          </div>
          <div>
            <dt>В движении</dt>
            <dd>1:52</dd>
          </div>
        </dl>
      </div>
      <div className={"mk-mini " + styles.rsvp}>
        <Calendar size={16} />
        <span>Суббота, 9:00 · каждую неделю</span>
        <span className="badge" data-tone="success">
          Иду · 5
        </span>
        <span className="badge">Может быть · 2</span>
      </div>
    </div>
  );
}

const demos = {
  "demo-bike": BikeDemo,
  "demo-journal": JournalDemo,
  "demo-reading": ReadingDemo,
  "demo-rides": RidesDemo,
};

function Scenario({ item }) {
  const Demo = demos[item.id];
  return (
    <section className="frame">
      <div className="frame-inner">
        <article
          className="mk-split"
          data-tone={item.tone}
          aria-labelledby={item.id + "-title"}
          data-reveal-item
        >
          <div className="mk-copy">
            <span className="mk-eyebrow">{item.eyebrow}</span>
            <h3 className="mk-h2" id={item.id + "-title"}>
              {item.title}
            </h3>
            <p className="mk-text">{item.text}</p>
            {item.points && (
              <ul className="mk-checks">
                {item.points.map((point) => (
                  <li key={point}>
                    <span aria-hidden="true">
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* A picture of the interface: nothing inside is clickable. */}
          <div className="mk-demo" aria-hidden="true">
            {Demo && <Demo />}
          </div>
        </article>
      </div>
    </section>
  );
}

function Gap() {
  return (
    <div className="frame frame-gap" aria-hidden="true">
      <div className="frame-inner" />
    </div>
  );
}

export default function About({ user, statistics }) {
  const { settings, setPreferences } = useSite(),
    config = settings.about || aboutDefaults;
  useEffect(() => setPreferences(user?.preferences || {}), [user?.id]);
  const root = useReveal();
  const shown = (id) =>
    config.sections.find((s) => s.id === id) ||
    aboutDefaults.sections.find((s) => s.id === id);
  const items = (section) =>
    aboutSections
      .find((s) => s.id === section)
      .items.filter((i) => !config.hiddenItems.includes(i.id));
  const guide = shown("guide"),
    technology = shown("technology");
  const guideItems = items("guide");
  const features = guideItems.filter((i) => i.kind === "feature"),
    scenarios = guideItems.filter((i) => i.kind === "scenario"),
    steps = guideItems.find((i) => i.kind === "steps");
  const intro = (id) => aboutSections.find((s) => s.id === id).intro;
  return (
    <>
      <SocialHeader user={user} />
      <main className={styles.page} ref={root}>
        <section className="frame">
          <div className="frame-inner">
            <div className={"frame-hero " + styles.hero}>
              <GlyphField />
              <h1 className={styles.title}>
                {aboutHero.title}{" "}
                <span className="mk-gradient">
                  <span>{aboutHero.accent}</span>
                  <span aria-hidden="true">{aboutHero.accent}</span>
                </span>
              </h1>
              <p className={styles.lead}>{aboutHero.lead}</p>
            </div>
            {statistics && settings.showAboutStats !== false && (
              <Statistics statistics={statistics} />
            )}
          </div>
        </section>
        {guide.visible && (
          <>
            <Gap />
            <section className="frame" aria-labelledby="guide-title">
              <div className="frame-inner" id="guide">
                <div className={"mk-band " + styles.band} data-reveal-item>
                  {guide.showIllustration && (
                    <Emblem asset={settings[illustrations.guide]} icon={Bike} />
                  )}
                  <h2 className="mk-h2" id="guide-title">
                    {guide.title}
                  </h2>
                  <p>{intro("guide")}</p>
                </div>
                {features.length > 0 && <Cells items={features} />}
              </div>
            </section>
            {scenarios.map((item) => (
              <Scenario key={item.id} item={item} />
            ))}
            {steps && (
              <>
                <Gap />
                <section className="frame" aria-labelledby="steps-title">
                  <div className="frame-inner">
                    <div className={"mk-band " + styles.stepsHead}>
                      <h3 className="mk-h2" id="steps-title">
                        {steps.title}
                      </h3>
                      <p>{steps.text}</p>
                    </div>
                    <ol
                      className="mk-steps"
                      style={{ "--mk-steps": steps.steps.length }}
                    >
                      {steps.steps.map((step) => (
                        <li key={step.title} data-reveal-item>
                          <strong>{step.title}</strong>
                          <span>{step.text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </section>
              </>
            )}
          </>
        )}
        {technology.visible && (
          <>
            <Gap />
            <section className="frame" aria-labelledby="technology-title">
              <div className="frame-inner" id="technology">
                <div className={"mk-band " + styles.band} data-reveal-item>
                  {technology.showIllustration && (
                    <Emblem
                      asset={settings[illustrations.technology]}
                      icon={Layers}
                    />
                  )}
                  <h2 className="mk-h2" id="technology-title">
                    {technology.title}
                  </h2>
                  <p>{intro("technology")}</p>
                </div>
                <Cells items={items("technology")} />
              </div>
            </section>
          </>
        )}
        {/* The documents live here rather than in the footer (#124). */}
        <section className="frame" aria-labelledby="documents-title">
          <div className="frame-inner">
            <div className={styles.documents}>
              <h2 id="documents-title">Документы</h2>
              <ul>
                {legalKinds.map((kind) => (
                  <li key={kind}>
                    <Link className="text-link" href={"/legal/" + kind}>
                      {legalTitles[kind]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
      <SocialFooter />
    </>
  );
}
