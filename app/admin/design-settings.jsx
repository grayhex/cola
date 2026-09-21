"use client";
import { useId, useState } from "react";
import { applyPixelClub, accentText } from "../../lib/appearance.js";
import { fontLabels, displayFonts, fontStacks } from "../../lib/fonts.js";
import { BlockSettings } from "./layout-settings.jsx";
import PanoramaPreview from "./panorama-preview.jsx";
import { Field, Select, SectionTabs } from "./design-controls.jsx";
import styles from "./design.module.css";

export function ThemeSettings({ settings: s, onChange, onPreset }) {
  return <section className={"admin-panel " + styles.compactPanel}>
    <div className={styles.sectionHeading}><h2>Тема и шрифты</h2>
      <button type="button" className="button secondary small" onClick={() => onPreset(applyPixelClub)}>Пиксельный велоклуб</button></div>
    <p className="help">Пресет меняет палитру, шрифты и прозрачность фона, но не удаляет загруженную графику. Публикация — после сохранения.</p>
    <div className={styles.themeGrid}>
      <div className="admin-form-grid">
        <Select label="Тема сайта" value={s.theme} onChange={(v) => onChange("theme", v)} options={[["light", "Светлая"], ["dark", "Тёмная"], ["system", "Как на устройстве"]]} />
        <Select label="Палитра" value={s.designPreset || "classic"} onChange={(v) => onChange("designPreset", v)} options={[["classic", "Прежняя"], ["pixel-club", "Пиксельный велоклуб"]]} />
        <Select label="Основной шрифт" value={s.font} onChange={(v) => onChange("font", v)} options={Object.entries(fontLabels)} />
        <Select label="Шрифт крупных заголовков" value={s.displayFont || "body"} onChange={(v) => onChange("displayFont", v)} options={Object.entries(displayFonts)} />
        <Field label="Акцентный цвет"><input type="color" value={s.accent} onChange={(e) => onChange("accent", e.target.value)} /></Field>
        <Field label={`Скругления: ${s.radius} px`}><input type="range" min="0" max="28" value={s.radius} onChange={(e) => onChange("radius", Number(e.target.value))} /></Field>
      </div>
      <div className={styles.themePreview} style={{ fontFamily: fontStacks[s.font], borderRadius: s.radius,
        background: s.theme === "dark" ? "#202724" : s.designPreset === "pixel-club" ? "#EEF1F4" : "#f3f5f0",
        color: s.theme === "dark" ? "#f3f5f0" : s.designPreset === "pixel-club" ? "#1E2830" : "#202724" }}>
        <small>Предпросмотр оформления</small>
        <h2 style={{ fontFamily: s.displayFont === "unbounded" ? '"Cola Unbounded", sans-serif' : fontStacks[s.font] }}>{s.siteName}</h2>
        <p>Ваш велосипед. Каждая деталь на своём месте.</p>
        <span className="preview-button" style={{ background: s.accent, color: accentText(s.accent), borderRadius: s.radius }}>Добавить велосипед</span>
      </div>
    </div>
  </section>;
}

export function LayoutSettings({ settings: s, onChange }) {
  const [tab, setTab] = useState("cards");
  const radio = useId();
  return <section className={"admin-panel " + styles.compactPanel}>
    <SectionTabs label="Настройки компоновки" value={tab} onChange={setTab}
      items={[["cards", "Витрина и карточки"], ["blocks", "Блоки карточки"], ["header", "Шапка и фон"]]}>
      {(active) => active === "blocks" ? <BlockSettings settings={s} onChange={onChange} /> : active === "cards" ? <>
        <fieldset className={styles.layoutChoices}><legend>Плотность карточки велосипеда</legend>
          {[["dense", "Компактно", "Маленькое фото и две колонки деталей."], ["balanced", "Сбалансированно", "Умеренные отступы и компактная комплектация."], ["spacious", "Подробно", "Крупное фото и одна колонка деталей."]].map(([value, title, text]) =>
            <label key={value} className={styles.layoutChoice}><input type="radio" name={radio} value={value} checked={s.bikeLayout === value} onChange={() => onChange("bikeLayout", value)} />
              <span><strong>{title}</strong><small>{text}</small></span></label>)}
        </fieldset>
        <div className="admin-form-grid">
          <Select label="Выравнивание заголовков" value={s.textAlign} onChange={(v) => onChange("textAlign", v)} options={[["left", "По левому краю"], ["center", "По центру"]]} />
          <Select label="Карточек в ряд на компьютере" value={String(s.desktopColumns)} onChange={(v) => onChange("desktopColumns", Number(v))} options={[["2", "Две"], ["3", "Три"], ["4", "Четыре"], ["5", "Пять"]]} />
          <Select label="Отображение фотографии" value={s.photoMode} onChange={(v) => onChange("photoMode", v)} options={[["natural", "Целиком, без внешних полей"], ["cover", "Заполнить блок с кадрированием"]]} />
          <Select label="Пропорции при кадрировании" value={s.photoRatio} onChange={(v) => onChange("photoRatio", v)} options={[["4/3", "4:3"], ["3/2", "3:2"], ["16/9", "16:9"], ["1/1", "Квадрат"]]} />
        </div><p className="help">На телефоне — одна колонка. Порядок и видимость деталей настраиваются во вкладке «Блоки карточки».</p>
      </> : <>
        <div className="admin-form-grid">
          <Select label="Подготовка логотипа" value={s.headerArtworkFit || "padded-strip"} onChange={(v) => onChange("headerArtworkFit", v)} options={[["padded-strip", "Прежний баннер с полями сверху и снизу"], ["contain", "Обрезанный логотип целиком"]]} />
          <Select label="Размещение фонового изображения" value={s.backgroundMode || "cover"} onChange={(v) => onChange("backgroundMode", v)} options={[["cover", "Масштабировать на экран"], ["tile", "Замостить без масштабирования"]]} />
          <Field label={`Прозрачность фона: ${100 - Number(s.backgroundOpacity ?? 20)}%`} help="0% — без прозрачности, 100% — полностью скрыто.">
            <input type="range" min="0" max="100" step="1" value={100 - Number(s.backgroundOpacity ?? 20)} disabled={!s.backgroundImageId}
              onChange={(e) => onChange("backgroundOpacity", 100 - Number(e.target.value))} /></Field>
        </div>
        <p className="help">Файлы логотипа, панорамы и фона выбираются во вкладке «Графика → Иллюстрации».</p>
        <details className={styles.previewDetails}><summary>Предпросмотр шапки и панорамы</summary><PanoramaPreview settings={s} />
          <p className="help">Логотип без полей: 800×160 px. Панорама: 2400×270 px; важные детали в центральной зоне 2400×200 px. На телефоне панорама показывается целиком.</p></details>
      </>}
    </SectionTabs>
  </section>;
}

export function WizardCopy({ settings, onChange }) {
  return <div className="admin-form-grid">
    {[["wizardLinkLabel", "Мастер: распознать по ссылке"], ["wizardManualLabel", "Мастер: заполнить вручную"]].map(([key, label]) =>
      <Field key={key} label={label}><input value={settings[key] || ""} maxLength={150} onChange={(e) => onChange(key, e.target.value)} /></Field>)}
  </div>;
}
