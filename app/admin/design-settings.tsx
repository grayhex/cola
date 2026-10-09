"use client";
import type { SettingsProps, AssetUpload, AssetChoice } from "./types.ts";
import { accentText } from "../../lib/appearance.ts";
import AssetPicker from "./asset-picker.tsx";
import { Field, Select } from "./design-controls.tsx";
import styles from "./design.module.css";

export function ThemeSettings({ settings: s, onChange }: SettingsProps) {
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
        {(
          [
            ["Light", "Светлая тема"],
            ["Dark", "Тёмная тема"],
          ] as const
        ).map(([key, label]) => (
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
}: SettingsProps & {
  assets: AssetChoice[];
  busy: boolean;
  onUpload: AssetUpload;
}) {
  return (
    <section className={"admin-panel " + styles.compactPanel}>
      <h2>Главная страница</h2>
      <Field label="Скорость Live, пикселей в секунду">
        <input
          type="number"
          min="5"
          max="80"
          step="1"
          value={s.autoScrollSpeed}
          onChange={(e) => onChange("autoScrollSpeed", Number(e.target.value))}
        />
      </Field>
      <p className="help">
        Скорость ленты событий. Наведение и фокус временно останавливают её;
        кнопка рядом с Live ставит на паузу. Рекорды прокручиваются вручную.
      </p>
      {/* Two independent pictures (#382): the light theme has its own, never
          the dark one filtered; without it the dark one stands in both. */}
      <AssetPicker
        label="Hero — светлая тема"
        help="Отдельная картинка для светлой темы, не инверсия тёмной. Пока она не выбрана, в светлой теме показывается картинка тёмной. Рекомендуем: минимум 2400×1030 px, широкий формат около 21:9, слева ~45% спокойного фона под текст."
        recommendedSize={{ width: 2400, height: 1030 }}
        value={s.heroBackgroundLightImageId}
        assets={assets.filter((asset) => asset.format === "image")}
        busy={busy}
        emptyLabel="Как в тёмной теме"
        onChange={(id) => onChange("heroBackgroundLightImageId", id)}
        onUpload={async (file) => {
          const asset = await onUpload(file);
          if (asset) onChange("heroBackgroundLightImageId", asset.id);
        }}
      />
      <AssetPicker
        label="Hero — тёмная тема"
        help="Картинка тёмной темы; она же запасная для светлой, пока у той нет своей. Рекомендуем: минимум 2400×1030 px, широкий формат около 21:9. Слева ~45% спокойного фона под текст, основной сюжет справа. PNG, JPEG или WebP автоматически оптимизируются."
        recommendedSize={{ width: 2400, height: 1030 }}
        value={s.heroBackgroundImageId}
        assets={assets.filter((asset) => asset.format === "image")}
        busy={busy}
        emptyLabel="Тёмный фон без изображения"
        onChange={(id) => onChange("heroBackgroundImageId", id)}
        onUpload={async (file) => {
          const asset = await onUpload(file);
          if (asset) onChange("heroBackgroundImageId", asset.id);
        }}
      />
      <Field label="Надзаголовок hero">
        <input
          maxLength={100}
          value={s.heroEyebrow}
          onChange={(e) => onChange("heroEyebrow", e.target.value)}
        />
      </Field>
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
        События и рекорды берутся из публичных материалов. Велосипед недели
        настраивается в разделе «Механики → Велосипед недели».
      </p>
      <div className="admin-form-grid">
        {(
          [
            ["appVersionLabel", "Версия приложения"],
            ["parserVersionLabel", "Версия парсера"],
          ] as const
        ).map(([key, label]) => (
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

export function WizardCopy({ settings, onChange }: SettingsProps) {
  return (
    <div className="admin-form-grid">
      {([["wizardLinkLabel", "Мастер: распознать по ссылке"]] as const).map(
        ([key, label]) => (
          <Field key={key} label={label}>
            <input
              value={settings[key] || ""}
              maxLength={150}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </Field>
        ),
      )}
    </div>
  );
}
