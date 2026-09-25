"use client";
import { navigationSections } from "../../lib/navigation.js";
import { aboutSections, aboutDefaults } from "../../lib/about-content.js";
import { ArrowUp, ArrowDown } from "../ui/icons.jsx";
import { Select } from "./design-controls.jsx";
import styles from "./design.module.css";

export function NavigationSettings({ settings, onChange }) {
  const sections = navigationSections(settings);
  const labels = {
    bikes: "Велосипеды",
    journal: "Журнал",
    rides: "Покатушки",
    market: "Рынок",
    articles: "Статьи",
    about: "О проекте",
  };
  const set = (id, key, value) =>
    onChange(
      "navigation",
      sections.map((s) => (s.id === id ? { ...s, [key]: value } : s)),
    );
  function move(index, delta) {
    if (index + delta < 0 || index + delta >= sections.length) return;
    const next = [...sections];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange("navigation", next);
  }
  return (
    <section className={"admin-panel " + styles.compactPanel}>
      <h2>Основное меню</h2>
      <p className="help">
        Порядок, подписи и видимость разделов. Поиск, уведомления и аккаунт
        остаются отдельными действиями. Скрытие пункта не закрывает страницу.
      </p>
      <ol className={styles.menuList} aria-label="Порядок разделов меню">
        {sections.map((section, index) => (
          <li key={section.id} className={styles.menuRow}>
            <span className={styles.menuIndex} aria-hidden="true">
              {index + 1}
            </span>
            <label className={styles.menuName}>
              <span>{labels[section.id] || section.id}</span>
              <input
                aria-label={"Название в меню: " + labels[section.id]}
                value={section.label}
                maxLength={32}
                onChange={(e) => set(section.id, "label", e.target.value)}
              />
            </label>
            <label className={styles.menuVisible}>
              <input
                type="checkbox"
                checked={section.visible}
                aria-label={"Показывать: " + labels[section.id]}
                onChange={(e) => set(section.id, "visible", e.target.checked)}
              />
              Показывать
            </label>
            <div className={styles.menuOrder}>
              <button
                type="button"
                disabled={index === 0}
                aria-label={"Выше: " + labels[section.id]}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                disabled={index === sections.length - 1}
                aria-label={"Ниже: " + labels[section.id]}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AboutSettings({ settings, onChange }) {
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
          Два раздела страницы /about под вступлением. Выключение пункта меню
          не скрывает саму страницу. Тексты обновляются вместе с кодом; здесь
          можно настроить заголовки разделов, видимость блоков и иллюстраций.
          Иллюстрация — значок в кольцах или изображение из вкладки «Графика».
        </p>
      </div>
      <label className="setting-row">
        <span>Показывать статистику проекта</span>
        <input
          type="checkbox"
          checked={settings.showAboutStats !== false}
          onChange={(e) => onChange("showAboutStats", e.target.checked)}
        />
      </label>
      {config.sections
        .filter((s) => s.id !== "history")
        .map((section) => (
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
            <label className="setting-row">
              Показывать раздел
              <input
                type="checkbox"
                checked={section.visible}
                onChange={(e) => set(section.id, "visible", e.target.checked)}
              />
            </label>
            <label className="setting-row">
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
                <label className="setting-row" key={item.id}>
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
          </fieldset>
        ))}
    </section>
  );
}
