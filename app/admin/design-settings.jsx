"use client";
import { useId, useState } from "react";
import { accentText } from "../../lib/appearance.js";
import AssetPicker from "./asset-picker.jsx";
import { BlockSettings } from "./layout-settings.jsx";
import { Field, Select, SectionTabs } from "./design-controls.jsx";
import styles from "./design.module.css";

export function ThemeSettings({ settings: s, onChange }) {
  const appearance = s.appearance;
  return (
    <section className={"admin-panel " + styles.compactPanel}>
      <h2>Внешний вид</h2>
      <p className="help">
        Единая нейтральная палитра и локальный Source Sans 3. Личный выбор темы
        в шапке имеет приоритет над настройкой сайта.
      </p>
      <div className={styles.themeGrid}>
        <div className="admin-form-grid">
          <Select
            label="Тема по умолчанию"
            value={appearance.theme}
            onChange={(v) =>
              onChange("appearance", { ...appearance, theme: v })
            }
            options={[
              ["system", "Как на устройстве"],
              ["light", "Светлая"],
              ["dark", "Тёмная"],
            ]}
          />
          <Field label="Акцентный цвет">
            <input
              type="color"
              value={appearance.accent}
              onChange={(e) =>
                onChange("appearance", {
                  ...appearance,
                  accent: e.target.value,
                })
              }
            />
          </Field>
        </div>
        <div className={styles.themePreview}>
          <small>Предпросмотр акцента</small>
          <h2>ColaBike</h2>
          <p>Покажи свой велосипед.</p>
          <span
            className="preview-button"
            style={{
              background: appearance.accent,
              color: accentText(appearance.accent),
              borderRadius: 8,
            }}
          >
            Добавить велосипед
          </span>
        </div>
      </div>
    </section>
  );
}
export function HomepageSettings({
  settings: s,
  onChange,
  assets,
  busy,
  onUpload,
}) {
  return (
    <section className={"admin-panel " + styles.compactPanel}>
      <h2>Главная страница</h2>
      <AssetPicker
        label="Hero image"
        help="PNG или WebP с прозрачным фоном. Рекомендуется 320 × 320 px. Одно изображение для обеих тем."
        value={s.heroImageId}
        assets={assets}
        busy={busy}
        emptyLabel="Нейтральный значок"
        compact
        accept="image/png,image/webp"
        onChange={(v) => onChange("heroImageId", v)}
        onUpload={async (file) => {
          const asset = await onUpload(file, {
            target: "setting",
            key: "heroImageId",
          });
          if (asset) onChange("heroImageId", asset.id);
        }}
      />
      <Field
        label="Заголовок hero"
        help="Перенос строки разделяет две строки заголовка."
      >
        <textarea
          rows={2}
          maxLength={150}
          value={s.heroHeadline}
          onChange={(e) => onChange("heroHeadline", e.target.value)}
        />
      </Field>
      <Field label="Подпись hero">
        <textarea
          rows={2}
          maxLength={300}
          value={s.heroDescription}
          onChange={(e) => onChange("heroDescription", e.target.value)}
        />
      </Field>
      <p className="help">
        Популярные байки, события и новый контент формируются из публичных
        материалов. Старые баннеры не используются новой главной.
      </p>
    </section>
  );
}

export function LayoutSettings({ settings: s, onChange }) {
  const [tab, setTab] = useState("cards");
  const radio = useId();
  return (
    <section className={"admin-panel " + styles.compactPanel}>
      <SectionTabs
        label="Настройки компоновки"
        value={tab}
        onChange={setTab}
        items={[
          ["cards", "Витрина и карточки"],
          ["blocks", "Блоки карточки"],
          ["header", "Шапка и фон"],
        ]}
      >
        {(active) =>
          active === "blocks" ? (
            <BlockSettings settings={s} onChange={onChange} />
          ) : active === "cards" ? (
            <>
              <fieldset className={styles.layoutChoices}>
                <legend>Плотность карточки велосипеда</legend>
                {[
                  [
                    "dense",
                    "Компактно",
                    "Маленькое фото и две колонки деталей.",
                  ],
                  [
                    "balanced",
                    "Сбалансированно",
                    "Умеренные отступы и компактная комплектация.",
                  ],
                  [
                    "spacious",
                    "Подробно",
                    "Крупное фото и одна колонка деталей.",
                  ],
                ].map(([value, title, text]) => (
                  <label key={value} className={styles.layoutChoice}>
                    <input
                      type="radio"
                      name={radio}
                      value={value}
                      checked={s.bikeLayout === value}
                      onChange={() => onChange("bikeLayout", value)}
                    />
                    <span>
                      <strong>{title}</strong>
                      <small>{text}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="admin-form-grid">
                <Select
                  label="Выравнивание заголовков"
                  value={s.textAlign}
                  onChange={(v) => onChange("textAlign", v)}
                  options={[
                    ["left", "По левому краю"],
                    ["center", "По центру"],
                  ]}
                />
                <Select
                  label="Карточек в ряд на компьютере"
                  value={String(s.desktopColumns)}
                  onChange={(v) => onChange("desktopColumns", Number(v))}
                  options={[
                    ["2", "Две"],
                    ["3", "Три"],
                    ["4", "Четыре"],
                    ["5", "Пять"],
                  ]}
                />
                <Select
                  label="Отображение фотографии"
                  value={s.photoMode}
                  onChange={(v) => onChange("photoMode", v)}
                  options={[
                    ["natural", "Целиком, без внешних полей"],
                    ["cover", "Заполнить блок с кадрированием"],
                  ]}
                />
                <Select
                  label="Пропорции при кадрировании"
                  value={s.photoRatio}
                  onChange={(v) => onChange("photoRatio", v)}
                  options={[
                    ["4/3", "4:3"],
                    ["3/2", "3:2"],
                    ["16/9", "16:9"],
                    ["1/1", "Квадрат"],
                  ]}
                />
              </div>
              <p className="help">
                На телефоне — одна колонка. Порядок и видимость деталей
                настраиваются во вкладке «Блоки карточки».
              </p>
            </>
          ) : (
            <>
              <div className="admin-form-grid">
                <Select
                  label="Подготовка логотипа"
                  value={s.headerArtworkFit || "padded-strip"}
                  onChange={(v) => onChange("headerArtworkFit", v)}
                  options={[
                    ["padded-strip", "Прежний баннер с полями сверху и снизу"],
                    ["contain", "Обрезанный логотип целиком"],
                  ]}
                />
                <Select
                  label="Размещение фонового изображения"
                  value={s.backgroundMode || "cover"}
                  onChange={(v) => onChange("backgroundMode", v)}
                  options={[
                    ["cover", "Масштабировать на экран"],
                    ["tile", "Замостить без масштабирования"],
                  ]}
                />
                <Field
                  label={`Прозрачность фона: ${100 - Number(s.backgroundOpacity ?? 20)}%`}
                  help="0% — без прозрачности, 100% — полностью скрыто."
                >
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={100 - Number(s.backgroundOpacity ?? 20)}
                    disabled={!s.backgroundImageId}
                    onChange={(e) =>
                      onChange(
                        "backgroundOpacity",
                        100 - Number(e.target.value),
                      )
                    }
                  />
                </Field>
              </div>
              <p className="help">
                Файлы логотипа, панорамы и фона выбираются во вкладке «Графика →
                Иллюстрации».
              </p>
              <p className="help">
                Legacy-настройки хранятся для совместимости. Новая шапка и
                главная не используют панораму, фон и прежний логотип.
              </p>
            </>
          )
        }
      </SectionTabs>
    </section>
  );
}

export function WizardCopy({ settings, onChange }) {
  return (
    <div className="admin-form-grid">
      {[
        ["wizardLinkLabel", "Мастер: распознать по ссылке"],
        ["wizardManualLabel", "Мастер: заполнить вручную"],
      ].map(([key, label]) => (
        <Field key={key} label={label}>
          <input
            value={settings[key] || ""}
            maxLength={150}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </Field>
      ))}
    </div>
  );
}
