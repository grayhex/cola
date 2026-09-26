"use client";
import { accentText } from "../../lib/appearance.js";
import AssetPicker from "./asset-picker.jsx";
import { Field, Select } from "./design-controls.jsx";
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
      <h3>Фон сайта</h3>
      <p className="help">
        Изображения выбираются отдельно в «Графика → Фон сайта». Фон меняется
        вместе с темой; прозрачность не затрагивает текст и карточки.
      </p>
      <div className="admin-form-grid">
        {[
          ["Light", "Светлая тема"],
          ["Dark", "Тёмная тема"],
        ].map(([key, label]) => (
          <fieldset key={key} className={styles.compactPanel}>
            <legend>{label}</legend>
            <Select
              label={"Размещение фона · " + label.toLowerCase()}
              value={s[`background${key}Mode`] || "cover"}
              options={[
                ["cover", "Масштабировать на экран"],
                ["tile", "Замостить"],
              ]}
              onChange={(v) => onChange(`background${key}Mode`, v)}
            />
            <Field
              label={"Прозрачность фона · " + label.toLowerCase()}
              help={`${100 - (s[`background${key}Opacity`] ?? 20)}% · 100% полностью скрывает изображение`}
            >
              <input
                aria-label={"Прозрачность фона · " + label.toLowerCase()}
                type="range"
                min="0"
                max="100"
                step="1"
                value={100 - (s[`background${key}Opacity`] ?? 20)}
                onChange={(e) =>
                  onChange(
                    `background${key}Opacity`,
                    100 - Number(e.target.value),
                  )
                }
              />
            </Field>
          </fieldset>
        ))}
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
      <div className={styles.graphicGrid}>
        {[
          ["heroAnimationLightId", "Анимация · светлая тема"],
          ["heroAnimationDarkId", "Анимация · тёмная тема"],
        ].map(([key, label]) => (
          <AssetPicker
            key={key}
            label={label}
            help="Локальный SVG-файл с CSS/SMIL-анимацией · до 1 МБ. Встроенные PNG/JPEG/WebP поддерживаются; внешние файлы и Lottie JSON не поддерживаются."
            value={s[key]}
            assets={assets}
            busy={busy}
            compact
            accept=".svg,image/svg+xml"
            emptyLabel={
              key === "heroAnimationDarkId"
                ? "Как в светлой теме"
                : "Без анимации"
            }
            onChange={(v) => onChange(key, v)}
            onUpload={async (file) => {
              const asset = await onUpload(file, { target: "setting", key });
              if (asset) onChange(key, asset.id);
            }}
          />
        ))}
      </div>
      <Select
        label="Фон блока"
        value={s.heroBackgroundMode}
        onChange={(v) => onChange("heroBackgroundMode", v)}
        options={[
          ["accent", "Оттенок акцентного цвета"],
          ["custom", "Свои цвета"],
        ]}
      />
      {s.heroBackgroundMode === "custom" && (
        <div className="admin-form-grid">
          {[
            ["heroBackgroundLight", "Фон блока · светлая тема"],
            ["heroBackgroundDark", "Фон блока · тёмная тема"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="color"
                value={s[key]}
                onChange={(e) => onChange(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
      )}
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
        материалов.
      </p>
      <div className="admin-form-grid">
        {[
          ["appVersionLabel", "Версия приложения"],
          ["parserVersionLabel", "Версия парсера"],
        ].map(([key, label]) => (
          <Field
            key={key}
            label={label}
            help="Оставьте пустым, чтобы показывать версию сборки."
          >
            <input
              value={s[key]}
              maxLength={40}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </Field>
        ))}
      </div>
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
