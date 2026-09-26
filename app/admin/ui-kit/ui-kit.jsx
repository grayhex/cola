"use client";
import { useId, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Bike,
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  Download,
  Heart,
  Info,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Route,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
  Weight,
  X,
} from "lucide-react";
import GlobalHeader from "../../ui/global-header.jsx";
import { SocialFooter } from "../../ui/social-primitives.jsx";
import SiteIcon, { slotIcons } from "../../ui/site-icon.jsx";
import { emojiSlots } from "../../../lib/ui-emoji.js";
import styles from "./ui-kit.module.css";

const sections = [
  ["tokens", "Токены"],
  ["type", "Типографика"],
  ["buttons", "Кнопки"],
  ["fields", "Поля"],
  ["cards", "Карточки"],
  ["badges", "Бейджи и теги"],
  ["tabs", "Вкладки и фильтры"],
  ["menus", "Меню и диалоги"],
  ["notices", "Уведомления"],
  ["states", "Загрузка и пустые состояния"],
  ["data", "Данные"],
  ["layout", "Компоновка"],
  ["icons", "Иконки"],
];

// Each example is drawn twice: once in the light theme, once in the dark.
function Both({ children, wide }) {
  return (
    <div className={styles.both + (wide ? " " + styles.wide : "")}>
      {["light", "dark"].map((theme) => (
        <div key={theme} className={"theme-" + theme + " " + styles.panel}>
          <span className={styles.panelLabel}>
            {theme === "light" ? "Светлая тема" : "Тёмная тема"}
          </span>
          {children}
        </div>
      ))}
    </div>
  );
}

function Section({ id, title, children, lead }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={id + "-h"}>
      <div className="section-head">
        <h2 id={id + "-h"}>{title}</h2>
      </div>
      {lead && <p className={styles.lead}>{lead}</p>}
      {children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowItems}>{children}</div>
    </div>
  );
}

const swatches = [
  [
    "Поверхности",
    [
      "--bg",
      "--bg-subtle",
      "--surface-subtle",
      "--surface-hover",
      "--surface-inverse",
    ],
  ],
  ["Текст", ["--text", "--text-secondary", "--text-muted", "--text-subtle"]],
  ["Линии", ["--line", "--line-strong", "--line-dashed", "--field-line"]],
  [
    "Акцент и действие",
    ["--accent", "--accent-soft", "--accent-text", "--primary", "--focus"],
  ],
  [
    "Состояния",
    ["--info", "--success", "--warning", "--danger", "--danger-soft"],
  ],
  [
    "Типы велосипедов",
    [
      "--tone-mtb",
      "--tone-road",
      "--tone-urban",
      "--tone-bmx",
      "--tone-cargo",
      "--tone-special",
    ],
  ],
];

function Tokens() {
  return (
    <Both wide>
      {swatches.map(([group, names]) => (
        <Row key={group} label={group}>
          {names.map((name) => (
            <span key={name} className={styles.swatch}>
              <i style={{ background: `var(${name})` }} />
              <code>{name}</code>
            </span>
          ))}
        </Row>
      ))}
      <Row label="Отступы">
        {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
          <span key={n} className={styles.space}>
            <i style={{ width: `var(--space-${n})` }} />
            <code>{n * 4}</code>
          </span>
        ))}
      </Row>
      <Row label="Скругления">
        {["sm", "md", "lg", "xl", "2xl", "full"].map((r) => (
          <span key={r} className={styles.radius}>
            <i style={{ borderRadius: `var(--radius-${r})` }} />
            <code>{r}</code>
          </span>
        ))}
      </Row>
      <Row label="Тени">
        {["xs", "sm", "lg", "xl", "inner"].map((s) => (
          <span key={s} className={styles.shadow}>
            <i style={{ boxShadow: `var(--shadow-${s})` }} />
            <code>{s}</code>
          </span>
        ))}
      </Row>
    </Both>
  );
}

function Typography() {
  return (
    <Both wide>
      <p className="mk-title" style={{ marginBottom: 8 }}>
        Маркетинг · 48
      </p>
      <h1>Заголовок страницы · 30</h1>
      <h2>Раздел · 24</h2>
      <h3>Подраздел · 18</h3>
      <p>
        Основной текст 16/1.5 — Source Sans 3 с кириллицей: «Съешь же ещё этих
        мягких французских булок». Длинные названия вроде
        «Specialized&nbsp;S-Works&nbsp;Stumpjumper&nbsp;EVO&nbsp;Expert&nbsp;Carbon&nbsp;29»
        переносятся, а не ломают сетку.
      </p>
      <p className="help">Подсказка и метаданные · 13, приглушённый цвет</p>
      <p className="mono">IBM Plex Mono · 12 400 км · 9,4 кг · 2024</p>
      <p>
        <span className="eyebrow">Моно-лейбл над заголовком</span>
      </p>
    </Both>
  );
}

function Buttons() {
  return (
    <Both>
      <Row label="Варианты">
        <button className="button" type="button">
          <Plus /> Добавить
        </button>
        <button className="button secondary" type="button">
          Отмена
        </button>
        <button className="button danger" type="button">
          <Trash2 /> Удалить
        </button>
        <button className="button secondary danger" type="button">
          Снять с публикации
        </button>
      </Row>
      <Row label="Размеры">
        <button className="button small" type="button">
          Маленькая
        </button>
        <button className="button secondary small" type="button">
          Маленькая
        </button>
        <button className="button large" type="button">
          Большая
        </button>
        <button className="button cta" type="button">
          <ArrowUpRight /> CTA
        </button>
      </Row>
      <Row label="Наведение и фокус">
        <button className="button" type="button" data-state="hover">
          Наведение
        </button>
        <button className="button secondary" type="button" data-state="hover">
          Наведение
        </button>
        <button className="button secondary" type="button" data-state="focus">
          Фокус с клавиатуры
        </button>
      </Row>
      <Row label="Недоступно и ожидание">
        <button className="button" type="button" disabled>
          Недоступно
        </button>
        <button className="button secondary" type="button" disabled>
          Недоступно
        </button>
        <button className="button" type="button" aria-busy="true">
          <span className="spinner" aria-hidden="true" /> Сохраняем…
        </button>
      </Row>
      <Row label="Иконочные и текстовые">
        <button className="icon" type="button" aria-label="Нравится">
          <Heart />
        </button>
        <button
          className="icon"
          type="button"
          aria-label="Поделиться"
          data-state="hover"
        >
          <Share2 />
        </button>
        <button className="icon secondary" type="button" aria-label="Ещё">
          <MoreHorizontal />
        </button>
        <button className="icon small" type="button" aria-label="Изменить">
          <Pencil />
        </button>
        <button className="icon" type="button" aria-label="Закрыть" disabled>
          <X />
        </button>
        <button className="quiet" type="button">
          <Bookmark /> Сохранить
        </button>
        <button className="quiet danger" type="button">
          Удалить
        </button>
        <a className="text-link" href="#buttons">
          Ссылка в тексте <ArrowUpRight />
        </a>
      </Row>
    </Both>
  );
}

// A radio group per panel: useId keeps the two themes independent.
function Radios() {
  const name = useId();
  return (
    <>
      <label className="check">
        <input type="radio" name={name} defaultChecked /> Продаю
      </label>
      <label className="check">
        <input type="radio" name={name} /> Отдаю
      </label>
    </>
  );
}

function Fields() {
  return (
    <Both>
      <div className="form-grid">
        <label className="field">
          <span>Название</span>
          <input defaultValue="Cube Nuroad Race" />
          <small>До 80 символов</small>
        </label>
        <label className="field">
          <span>Пустое поле</span>
          <input placeholder="Например, Stumpjumper" />
        </label>
        <label className="field">
          <span>Фокус</span>
          <input defaultValue="Shimano GRX" data-state="focus" />
        </label>
        <label className="field">
          <span>Ошибка</span>
          <input defaultValue="-3" aria-invalid="true" />
          <small className="field-error">Вес должен быть больше нуля</small>
        </label>
        <label className="field">
          <span>Недоступно</span>
          <input defaultValue="Задаётся автоматически" disabled />
        </label>
        <label className="field">
          <span>Выбор</span>
          <select defaultValue="gravel">
            <option value="road">Шоссе</option>
            <option value="gravel">Гравийник</option>
            <option value="mtb">Горный</option>
          </select>
        </label>
        <label className="field full">
          <span>Описание</span>
          <textarea defaultValue="Гравийник для длинных выходных: широкие покрышки, крылья и сумки." />
        </label>
      </div>
      <Row label="Отметки">
        <label className="check">
          <input type="checkbox" defaultChecked /> Публичный
        </label>
        <Radios />
        <label className="check">
          <input type="checkbox" disabled /> Недоступно
        </label>
        <label className="check">
          <input
            type="checkbox"
            role="switch"
            className="toggle"
            defaultChecked
          />{" "}
          Переключатель
        </label>
      </Row>
      <Row label="Поиск и файл">
        <label className="search-pill" style={{ width: 240 }}>
          <Search />
          <input
            type="search"
            placeholder="Найти велосипед"
            aria-label="Найти велосипед"
          />
        </label>
        <input type="file" aria-label="Файл" />
      </Row>
      <div className="form-actions">
        <button className="button secondary" type="button">
          Отмена
        </button>
        <button className="button" type="button">
          Сохранить
        </button>
      </div>
    </Both>
  );
}

function Cards() {
  return (
    <Both>
      <div className="card">
        <strong>Карточка</strong>
        <p className="help" style={{ marginTop: 4 }}>
          Тонкая граница, скругление 12, тень xs. Для блоков на рабочих
          страницах.
        </p>
      </div>
      <div className="list-grid" style={{ marginTop: 16 }}>
        {[
          ["Cube Nuroad Race", "Гравийник", "9,4 кг", "12"],
          [
            "Merida Silex 400 — очень длинное название сборки",
            "Гравийник",
            "10,2 кг",
            "3",
          ],
        ].map(([name, type, weight, likes]) => (
          <article key={name} className="item-card">
            <a
              className="item-link"
              href="#cards"
              style={{ display: "block", padding: 8 }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Bike
                  size={16}
                  style={{ color: "var(--tone-road)" }}
                  aria-hidden="true"
                />
                <span className="item-title">{name}</span>
              </span>
              <span className="meta nowrap" style={{ marginTop: 2 }}>
                <span>{type}</span>
                <span>
                  <Weight aria-hidden="true" /> {weight}
                </span>
                <span>
                  <Heart aria-hidden="true" /> {likes}
                </span>
              </span>
            </a>
          </article>
        ))}
      </div>
      <div className="mk-mini" style={{ marginTop: 16 }}>
        <span className="mk-mini-label">Маркетинг · мини-карточка</span>
        <p style={{ fontSize: 24, fontWeight: 700 }}>12 400 км</p>
        <p className="help">за сезон на трёх велосипедах</p>
      </div>
    </Both>
  );
}

function Badges() {
  return (
    <Both>
      <Row label="Бейджи">
        <span className="badge">Черновик</span>
        <span className="badge" data-tone="info">
          Новое
        </span>
        <span className="badge" data-tone="success">
          Опубликовано
        </span>
        <span className="badge" data-tone="warning">
          На проверке
        </span>
        <span className="badge" data-tone="danger">
          Скрыто
        </span>
        <span className="badge" data-tone="accent">
          Рекорд
        </span>
        <span className="badge mono">2024</span>
      </Row>
      <Row label="Теги">
        <span className="tag">
          <Bike /> Гравийник
        </span>
        <button className="tag" type="button">
          <MapPin /> Москва <span className="tag-count">24</span>
        </button>
        <button className="tag" type="button" data-state="hover">
          Наведение
        </button>
        <button className="tag" type="button" aria-pressed="true">
          <Check /> Выбран
        </button>
        <span className="tag small">M</span>
        <button className="tag" type="button" disabled>
          Недоступно
        </button>
      </Row>
    </Both>
  );
}

function Tabs() {
  const [tab, setTab] = useState("bikes");
  const [filter, setFilter] = useState("all");
  return (
    <Both>
      <div className="ui-tabs" role="tablist" aria-label="Пример вкладок">
        {[
          ["bikes", "Велосипеды", 12],
          ["rides", "Покатушки", 4],
          ["journal", "Журнал", 31],
          ["saved", "Сохранённое", 0],
        ].map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label} <span className="count">{count}</span>
          </button>
        ))}
      </div>
      <ul className="segmented" aria-label="Пример фильтра">
        {[
          ["all", "Все"],
          ["mtb", "Горные"],
          ["road", "Шоссе"],
          ["gravel", "Гравий"],
        ].map(([id, label]) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Both>
  );
}

function DialogDemo() {
  const dialog = useRef(null);
  const title = useId();
  return (
    <div>
      <button
        className="button secondary"
        type="button"
        onClick={() => dialog.current?.showModal()}
      >
        Открыть диалог
      </button>
      <dialog ref={dialog} aria-labelledby={title}>
        <div className="dialog-head">
          <h2 id={title}>Удалить запись?</h2>
          <button
            className="icon"
            type="button"
            aria-label="Закрыть"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        <p>Запись «Замена кассеты и цепи» исчезнет из журнала.</p>
        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            Отмена
          </button>
          <button
            className="button danger"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            Удалить
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Menus() {
  return (
    <Both>
      <div className={styles.menuStage}>
        <div className="menu" role="menu" aria-label="Пример меню">
          <span className="menu-label">Велосипед</span>
          <button className="menu-item" role="menuitem" type="button">
            <Pencil /> Изменить
          </button>
          <button
            className="menu-item"
            role="menuitem"
            type="button"
            data-state="hover"
          >
            <Share2 /> Поделиться
          </button>
          <button
            className="menu-item"
            role="menuitem"
            type="button"
            aria-disabled="true"
          >
            <Download /> Экспорт недоступен
          </button>
          <hr className="menu-divider" />
          <button className="menu-item danger" role="menuitem" type="button">
            <Trash2 /> Удалить
          </button>
        </div>
        <DialogDemo />
      </div>
    </Both>
  );
}

function Notices() {
  return (
    <Both>
      <p className="notice">
        <Info /> Черновик виден только вам.
      </p>
      <p className="notice" data-tone="success">
        <Check /> Настройки опубликованы на сайте.
      </p>
      <p className="notice" data-tone="warning">
        <TriangleAlert /> Фото меньше 1200 px будет выглядеть мягко.
      </p>
      <p className="error" role="alert">
        <TriangleAlert /> Не удалось сохранить: проверьте подключение.
      </p>
      <div className={"toast " + styles.static}>
        <Check /> Ссылка скопирована
      </div>
    </Both>
  );
}

function States() {
  return (
    <Both>
      <Row label="Загрузка">
        <span className="spinner" aria-label="Загрузка" role="status" />
        <span className={styles.skeletons} aria-hidden="true">
          <span className="skeleton" style={{ width: 180, height: 12 }} />
          <span className="skeleton" style={{ width: 120, height: 12 }} />
        </span>
      </Row>
      <div className="empty-state">
        <Route />
        <h3>Покатушек пока нет</h3>
        <p>Загрузите GPX, FIT или TCX — маршрут появится на карте.</p>
        <button className="button small" type="button">
          <Plus /> Добавить покатушку
        </button>
      </div>
    </Both>
  );
}

function Data() {
  return (
    <Both>
      <table className="data-table">
        <thead>
          <tr>
            <th>Деталь</th>
            <th>Пробег</th>
            <th>Цена</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Цепь Shimano CN-M8100</td>
            <td className="mono">3 040 км</td>
            <td className="mono">4 200 ₽</td>
          </tr>
          <tr>
            <td>Кассета 11-36</td>
            <td className="mono">3 040 км</td>
            <td className="mono">7 900 ₽</td>
          </tr>
        </tbody>
      </table>
      <dl className="kv" style={{ marginTop: 16 }}>
        <div>
          <dt>Вес</dt>
          <dd>9,4 кг</dd>
        </div>
        <div>
          <dt>Размер</dt>
          <dd>M</dd>
        </div>
      </dl>
      <p className="meta" style={{ marginTop: 16 }}>
        <span>
          <Calendar aria-hidden="true" /> 12 мая
        </span>
        <span>Обслуживание</span>
        <span>
          <Heart aria-hidden="true" /> 8
        </span>
        <span>
          <Bell aria-hidden="true" /> подписка
        </span>
      </p>
    </Both>
  );
}

function Layouts() {
  return (
    <Both wide>
      <div className="page-head">
        <div className="page-title">
          <h1>Велосипеды</h1>
          <span className="count">1 204</span>
        </div>
        <label className="search-pill">
          <Search />
          <input
            type="search"
            placeholder="Найти"
            aria-label="Найти велосипед"
          />
        </label>
        <div className="page-actions">
          <button className="button secondary small" type="button">
            Сортировка: новые <ChevronDown />
          </button>
        </div>
      </div>
      <div className={styles.frameDemo}>
        <div className="frame-hero">
          <p className="mk-title" style={{ fontSize: 30 }}>
            Маркетинговый режим
          </p>
          <p className="mk-lead" style={{ fontSize: 16 }}>
            Разлинованная колонка, крупная типографика, «текст + демонстрация».
          </p>
        </div>
        <div className="mk-split" data-tone="blue">
          <div className="mk-copy" style={{ padding: 24 }}>
            <span className="mk-eyebrow">Журнал</span>
            <p className="mk-text">Каждая замена детали — запись с датой.</p>
          </div>
          <div className="mk-demo" style={{ minHeight: 160 }}>
            <div className="mk-mini">
              <span className="mk-mini-label">Сервис</span>
              <p>Замена кассеты и цепи</p>
            </div>
          </div>
        </div>
      </div>
    </Both>
  );
}

function Icons() {
  return (
    <Both wide>
      <ul className={styles.icons}>
        {emojiSlots
          .filter((s) => slotIcons[s.key])
          .map((s) => (
            <li key={s.key}>
              <SiteIcon name={s.key} settings={{ emojis: {} }} size={18} />
              <span>{s.label}</span>
            </li>
          ))}
      </ul>
      <p className="help">
        Линейные иконки Lucide, обводка 1,75, размеры 14/16/18. Эмодзи из
        Админка → Дизайн → Значки заменяет иконку в том же размере.
      </p>
    </Both>
  );
}

// The sections of the kit: on their own page and inside the admin, where
// the admin menu stays next to them (#131).
export function UiKitSections() {
  return (
    <>
      <nav className="segmented" aria-label="Разделы UI Kit">
        {sections.map(([id, label]) => (
          <a key={id} href={"#" + id}>
            {label}
          </a>
        ))}
      </nav>
      <Section
        id="tokens"
        title="Токены"
        lead="Цвета задаются по назначению; тёмная тема меняет значения, а не компоненты."
      >
        <Tokens />
      </Section>
      <Section id="type" title="Типографика">
        <Typography />
      </Section>
      <Section
        id="buttons"
        title="Кнопки"
        lead="Главное действие — чёрная кнопка (белая в тёмной теме), обычные — градиент с тонкой рамкой."
      >
        <Buttons />
      </Section>
      <Section id="fields" title="Поля">
        <Fields />
      </Section>
      <Section
        id="cards"
        title="Карточки"
        lead="Строка-карточка по образцу Hugging Face Datasets: моноширинное имя, метаданные через «•»."
      >
        <Cards />
      </Section>
      <Section id="badges" title="Бейджи и теги">
        <Badges />
      </Section>
      <Section id="tabs" title="Вкладки и фильтры">
        <Tabs />
      </Section>
      <Section id="menus" title="Меню и диалоги">
        <Menus />
      </Section>
      <Section id="notices" title="Уведомления">
        <Notices />
      </Section>
      <Section id="states" title="Загрузка и пустые состояния">
        <States />
      </Section>
      <Section id="data" title="Данные">
        <Data />
      </Section>
      <Section
        id="layout"
        title="Компоновка"
        lead="Рабочий режим — плотная строка заголовка с поиском; маркетинговый — разлинованная колонка."
      >
        <Layouts />
      </Section>
      <Section id="icons" title="Иконки">
        <Icons />
      </Section>
    </>
  );
}

export default function UiKit() {
  return (
    <>
      <GlobalHeader />
      <main className="page">
        <div className="page-head">
          <div className="page-title">
            <h1>UI Kit</h1>
            <span className="count">дизайн-система ColaBike</span>
          </div>
          <p className="page-lead">
            Утверждённые токены, компоненты и их состояния в светлой и тёмной
            теме. Правила применения — в DESIGN.md в корне репозитория.
          </p>
        </div>
        <UiKitSections />
      </main>
      <SocialFooter />
    </>
  );
}
