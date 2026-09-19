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
} from "lucide-react";
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
};
const illustrations = {
  guide: "aboutGuideImageId",
  technology: "aboutTechnologyImageId",
  history: "aboutHistoryImageId",
};
export default function About({ user }) {
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
