"use client";
import { useEffect } from "react";
import {
  Bike,
  ScanLine,
  Route,
  Gauge,
  Trophy,
  Users,
  Code2,
  Layers,
  ShieldCheck,
  Settings2,
  History,
  Flag,
  Package,
  BookOpen,
  Lock,
} from "../ui/icons.jsx";
import { useSite } from "../ui/site-provider.jsx";
import { SocialHeader, SocialFooter } from "../ui/social-primitives.jsx";
import { aboutSections, aboutDefaults } from "../../lib/about-content.js";
const icons = {
  bike: Bike,
  scan: ScanLine,
  route: Route,
  gauge: Gauge,
  trophy: Trophy,
  users: Users,
  code: Code2,
  layers: Layers,
  shield: ShieldCheck,
  settings: Settings2,
  history: History,
  flag: Flag,
  market: Package,
  articles: BookOpen,
  account: Lock,
};
const illustrations = {
  guide: "aboutGuideImageId",
  technology: "aboutTechnologyImageId",
  history: "aboutHistoryImageId",
};
export default function About({ user, statistics }) {
  const { settings, setPreferences } = useSite(),
    config = settings.about || aboutDefaults;
  useEffect(() => setPreferences(user?.preferences || {}), [user?.id]);
  const visible = config.sections.filter(
    (s) => s.visible && s.id !== "history",
  );
  return (
    <>
      <SocialHeader user={user} />
      <main className="social-page about-page">
        <div className="about-heading">
          <span className="about-eyebrow">Люди. Велосипеды. Истории.</span>
          <h1>О проекте</h1>
          <p>Соберите велосипед. Покажите сборку. Добавьте приключения.</p>
        </div>
        {statistics && settings.showAboutStats !== false && (
          <section className="about-statistics" aria-label="ColaBike в цифрах">
            <h2>Гараж растёт вместе с нами</h2>
            <dl>
              {[
                [Users, statistics.users, "Участников"],
                [Bike, statistics.bikes, "Велосипедов"],
                [Route, statistics.rides, "Покатушек"],
                [History, statistics.entries, "Записей журнала"],
                [
                  Gauge,
                  Math.round(Number(statistics.distance) / 1000),
                  "Километров",
                ],
              ].map(([Icon, n, label]) => (
                <div key={label}>
                  <Icon size={18} />
                  <dt>{label}</dt>
                  <dd>{Number(n).toLocaleString("ru-RU")}</dd>
                </div>
              ))}
            </dl>
            <p className="help">
              Велосипеды, записи, покатушки и километры — только из публичного
              гаража.
            </p>
          </section>
        )}
        {!!visible.length && (
          <nav className="about-index" aria-label="На этой странице">
            {visible.map((s, i) => (
              <a key={s.id} href={"#" + s.id}>
                <span>0{i + 1}</span>
                {s.title}
              </a>
            ))}
          </nav>
        )}
        {visible.map((section) => {
          const data = aboutSections.find((s) => s.id === section.id),
            asset = settings[illustrations[section.id]],
            Illustration =
              icons[
                { guide: "bike", technology: "layers", history: "history" }[
                  section.id
                ]
              ];
          return (
            <section
              className="about-section"
              id={section.id}
              key={section.id}
              aria-labelledby={section.id + "-title"}
            >
              <div className="about-section-intro">
                <div>
                  <h2 id={section.id + "-title"}>{section.title}</h2>
                  <p>{data.intro}</p>
                </div>
                {section.showIllustration && (
                  <div className="about-illustration">
                    {asset ? (
                      <img src={"/api/assets/" + asset} alt="" />
                    ) : (
                      <Illustration
                        size={100}
                        strokeWidth={1}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="about-grid">
                {data.items
                  .filter((i) => !config.hiddenItems.includes(i.id))
                  .map((item) => {
                    const Icon = icons[item.icon];
                    return (
                      <article className="about-card" key={item.id}>
                        <Icon size={21} aria-hidden="true" />
                        <div>
                          <h3>{item.title}</h3>
                          <p>{item.text}</p>
                          {item.steps && (
                            <ol className="about-steps">
                              {item.steps.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </article>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </main>
      <SocialFooter />
    </>
  );
}
