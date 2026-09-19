"use client";
import { navigationSections } from "../../lib/navigation.js";
import { aboutSections, aboutDefaults } from "../../lib/about-content.js";
export function NavigationSettings({ settings, onChange }) {
  const sections = navigationSections(settings);
  const set = (id, key, value) =>
    onChange(
      "navigation",
      sections.map((s) => (s.id === id ? { ...s, [key]: value } : s)),
    );
  return (
    <div className="navigation-settings">
      <p className="help">
        Порядок и названия основных разделов. Поиск, уведомления и аккаунт
        остаются справа. Адреса разделов задаёт приложение.
      </p>
      {sections.map((s, i) => (
        <fieldset className="layout-block-editor" key={s.id}>
          <legend>
            {
              { bikes: "Велосипеды", rides: "Покатушки", about: "О проекте" }[
                s.id
              ]
            }
          </legend>
          <label className="field">
            <span>Название в меню</span>
            <input
              value={s.label}
              maxLength={32}
              onChange={(e) => set(s.id, "label", e.target.value)}
            />
          </label>
          <label className="admin-toggle">
            Показывать в меню
            <input
              type="checkbox"
              checked={s.visible}
              onChange={(e) => set(s.id, "visible", e.target.checked)}
            />
          </label>
          <div className="order-actions">
            {[-1, 1].map((delta) => (
              <button
                type="button"
                className="quiet"
                key={delta}
                disabled={i + delta < 0 || i + delta >= sections.length}
                aria-label={(delta < 0 ? "Выше: " : "Ниже: ") + s.id}
                onClick={() => {
                  const next = [...sections];
                  [next[i], next[i + delta]] = [next[i + delta], next[i]];
                  onChange("navigation", next);
                }}
              >
                {delta < 0 ? "↑ Выше" : "↓ Ниже"}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
export function AboutSettings({ settings, onChange, assetPicker }) {
  const config = settings.about || aboutDefaults;
  const set = (id, key, value) =>
    onChange("about", {
      ...config,
      sections: config.sections.map((s) =>
        s.id === id ? { ...s, [key]: value } : s,
      ),
    });
  return (
    <section className="graphics-group">
      <div className="graphics-group-heading">
        <h3>О проекте — содержание</h3>
        <p>
          Три раздела страницы /about. Выключение пункта меню не скрывает саму
          страницу. Тексты обновляются вместе с кодом; здесь можно настроить
          заголовки, видимость информации и иллюстрации.
        </p>
      </div>
      {config.sections.map((section) => (
        <fieldset className="layout-block-editor" key={section.id}>
          <legend>
            {aboutSections.find((s) => s.id === section.id).title}
          </legend>
          <label className="field">
            <span>Заголовок раздела</span>
            <input
              maxLength={150}
              value={section.title}
              onChange={(e) => set(section.id, "title", e.target.value)}
            />
          </label>
          <label className="admin-toggle">
            Показывать раздел
            <input
              type="checkbox"
              checked={section.visible}
              onChange={(e) => set(section.id, "visible", e.target.checked)}
            />
          </label>
          <label className="admin-toggle">
            Показывать иллюстрацию
            <input
              type="checkbox"
              checked={section.showIllustration}
              onChange={(e) =>
                set(section.id, "showIllustration", e.target.checked)
              }
            />
          </label>
          {aboutSections
            .find((s) => s.id === section.id)
            .items.map((item) => (
              <label className="admin-toggle" key={item.id}>
                {item.title}
                <input
                  type="checkbox"
                  checked={!config.hiddenItems.includes(item.id)}
                  onChange={(e) =>
                    onChange("about", {
                      ...config,
                      hiddenItems: e.target.checked
                        ? config.hiddenItems.filter((id) => id !== item.id)
                        : [...config.hiddenItems, item.id],
                    })
                  }
                />
              </label>
            ))}
          {assetPicker(
            {
              guide: "aboutGuideImageId",
              technology: "aboutTechnologyImageId",
              history: "aboutHistoryImageId",
            }[section.id],
            "Иллюстрация: " + section.title,
          )}
        </fieldset>
      ))}
    </section>
  );
}
