"use client";
import styles from "./bike-fields.module.css";
import MultiSelectCombo from "./multi-select-combo.tsx";
import {
  chosenPrices,
  priceSummary,
  priceVisibilityKeys,
  priceVisibilityLabels,
  pricesFromChoice,
  type PriceVisibility,
} from "../../lib/price-visibility.ts";

export function FormerBikeField({
  value = false,
  onChange,
  disabled = false,
  compact = false,
}: {
  value?: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  // In a group of settings: tight margins, the explanation below the label.
  compact?: boolean;
}) {
  return (
    <div className={compact ? styles.ownershipCompact : styles.ownership}>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        Бывший велосипед
      </label>
      <p className="help">
        Раньше принадлежал вам. Велосипед останется в гараже, но для него нельзя
        добавлять новые покатушки. Существующая история сохранится.
      </p>
    </div>
  );
}

// «Публичный» / «Только я»: one choice of two, the same meaning as the old
// «Приватный велосипед» box (the server keeps its own publication checks).
export function PrivacyField({
  isPublic,
  onChange,
  disabled = false,
}: {
  isPublic: boolean;
  onChange: (isPublic: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.privacy} disabled={disabled}>
      <legend>Приватность</legend>
      <div className={styles.radios}>
        {(
          [
            [true, "Публичный"],
            [false, "Только я"],
          ] as const
        ).map(([value, label]) => (
          <label key={label} className={styles.radio}>
            <input
              type="radio"
              name="bike-privacy"
              checked={isPublic === value}
              onChange={() => onChange(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// The three show-the-price settings as one combo box (#370).
export function PriceVisibilityField({
  value,
  onChange,
  disabled = false,
}: {
  value: PriceVisibility;
  onChange: (value: PriceVisibility) => void;
  disabled?: boolean;
}) {
  const chosen = chosenPrices(value);
  return (
    <MultiSelectCombo
      label="Показ стоимости"
      options={priceVisibilityKeys.map((key) => ({
        value: key,
        label: priceVisibilityLabels[key],
      }))}
      value={chosen}
      disabled={disabled}
      summary={priceSummary(chosen)}
      onChange={(next) => onChange(pricesFromChoice(next))}
    />
  );
}
