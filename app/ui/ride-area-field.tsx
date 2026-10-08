"use client";
import type { Area } from "../../lib/ride-match-core.ts";
import type { Place } from "../../lib/geocoding.ts";
import type { PassportDraft } from "./ride-types.ts";
import { useId, useRef, useState } from "react";
import { LocateFixed, Search, X } from "lucide-react";
import AreaPicker from "./ride-area-map.tsx";
import { usePlaceSearch } from "./use-place-search.ts";
import {
  PositionError,
  currentPosition,
  positionMessages,
} from "./device-position.ts";
import {
  areaFromPlace,
  areaFromPosition,
  areaLabelMax,
  areaProblems,
  areaRadiiKm,
  areaSummary,
  cleanLabel,
  isMapped,
  withLabel,
  withRadius,
} from "../../lib/ride-area.ts";
import styles from "./ride-passport.module.css";

// The approximate area of a ride, an intent or a preference (#241, #370).
// One chosen area — a name, a centre and a radius that describe one place —
// and the ways to choose it: by a place's name, on the map, around the
// device's position. What is typed in the search box is a question, not the
// area: it does not rename the chosen area or leave an old circle under a new
// name, and a place becomes the area only when it is picked. Without a search
// service, a map or a position the area can still be named by hand.
function RadiusSelect({
  area,
  onChange,
  disabled,
}: {
  area: Area;
  onChange: (radiusM: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>Радиус</span>
      <select
        value={(area.radiusM ?? 3000) / 1000}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) * 1000)}
      >
        {areaRadiiKm.map((km) => (
          <option key={km} value={km}>
            {km} км
          </option>
        ))}
      </select>
    </label>
  );
}
function NameField({
  area,
  onChange,
  disabled,
  invalid,
  id,
}: {
  area: Area;
  onChange: (label: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  id: string;
}) {
  return (
    <label className="field">
      <span>Название области</span>
      <input
        id={id}
        required
        disabled={disabled}
        maxLength={areaLabelMax}
        placeholder="Например, Измайловский парк"
        aria-invalid={invalid || undefined}
        value={area.label || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function AreaField({
  value = {},
  onChange,
  disabled = false,
  intent = false,
  label = "Область поездки",
}: {
  value?: PassportDraft;
  onChange: (value: PassportDraft) => void;
  disabled?: boolean;
  intent?: boolean;
  label?: string;
}) {
  const id = useId(),
    [query, setQuery] = useState(""),
    // An area around the device's position waits here until it is confirmed.
    [position, setPosition] = useState<Area | null>(null),
    [locating, setLocating] = useState(false),
    [locationMessage, setLocationMessage] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    // Taking the area away starts the picker over, closed; choosing does not.
    [generation, setGeneration] = useState(0);
  const search = usePlaceSearch(query, !disabled && !position);
  const results = useRef<HTMLUListElement | null>(null);
  const area = value.area;
  const set = (next: Area | undefined) => {
    const rest = { ...value };
    // Only a name that is nothing and goes with no map is no area at all.
    if (!next || (!isMapped(next) && !cleanLabel(next.label || "")))
      delete rest.area;
    else rest.area = next;
    onChange(rest);
  };
  function choose(place: Place) {
    const next = areaFromPlace(place);
    set(next);
    setQuery("");
    setAnnouncement(`Выбрана область: ${areaSummary(next)}`);
  }
  async function useMyLocation() {
    setLocating(true);
    setLocationMessage("");
    try {
      setPosition(areaFromPosition(await currentPosition()));
    } catch (error) {
      setLocationMessage(
        positionMessages[
          error instanceof PositionError ? error.reason : "unavailable"
        ],
      );
    } finally {
      setLocating(false);
    }
  }
  const typed = cleanLabel(query);
  const problems = areaProblems(area);
  const nameId = id + "-name";
  const hint = intent
    ? "Приблизительный район или парк, без домашнего адреса."
    : "Приблизительный район, без домашнего адреса.";
  return (
    <fieldset
      className={styles.areaField}
      disabled={disabled}
      aria-label={label}
    >
      <label className="field">
        <span>
          <Search size={14} aria-hidden="true" /> Найти место
        </span>
        <input
          type="search"
          role="searchbox"
          autoComplete="off"
          maxLength={areaLabelMax}
          placeholder="Например, Измайловский парк"
          aria-describedby={id + "-hint"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // In a form Enter would send it: here it goes to the results.
            if (e.key === "Enter") {
              e.preventDefault();
              results.current?.querySelector("button")?.focus();
            }
          }}
        />
      </label>
      <small id={id + "-hint"} className={styles.placeHint}>
        {hint} Выберите место из списка: подпись, центр и радиус задаются
        вместе.
      </small>
      {/* A live region, not a «status» of its own: the form's other messages
          stay the one status of the window. */}
      <div aria-live="polite" className={styles.placeStatus}>
        {search.status === "loading" && "Ищем…"}
        {search.status === "empty" &&
          "Ничего не найдено. Уточните название или назовите область сами."}
        {search.status === "error" && search.message}
        {announcement}
      </div>
      {search.status === "found" && (
        <ul
          ref={results}
          className={styles.places}
          aria-label="Найденные места"
        >
          {search.places.map((place) => (
            <li key={place.label + place.center.join(",")}>
              <button type="button" onClick={() => choose(place)}>
                <strong>{place.label}</strong>
                {place.detail && <small>{place.detail}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {typed.length >= 2 && !position && (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            set({ label: typed });
            setQuery("");
            setAnnouncement(`Область «${typed}» без привязки к карте`);
          }}
        >
          Использовать «{typed}» как подпись без карты
        </button>
      )}
      <div className={styles.areaActions}>
        <button
          type="button"
          className="button secondary small"
          disabled={locating}
          aria-busy={locating || undefined}
          onClick={useMyLocation}
        >
          <LocateFixed size={14} aria-hidden="true" />
          {locating ? "Определяем…" : "Использовать моё местоположение"}
        </button>
      </div>
      {locationMessage && (
        <p role="status" className="help">
          {locationMessage}
        </p>
      )}
      {/* One picker in one place for every state: choosing a centre on the map
          must not take the map down and build it again. */}
      <div
        className={position || area ? styles.areaCard : undefined}
        role={position || area ? "group" : undefined}
        aria-label={
          position
            ? "Область по вашему положению"
            : area
              ? "Выбранная область"
              : undefined
        }
      >
        {position ? (
          <>
            <p className="help">
              Приблизительная область по вашему положению. Проверьте её,
              назовите и подтвердите: пока вы не нажали «Использовать эту
              область», ничего не меняется. Точное положение не сохраняется —
              центр округляется примерно до километра.
            </p>
            <NameField
              id={nameId + "-position"}
              area={position}
              onChange={(next) => setPosition(withLabel(position, next))}
            />
            <RadiusSelect
              area={position}
              onChange={(radiusM) => setPosition(withRadius(position, radiusM))}
            />
          </>
        ) : area ? (
          <>
            <NameField
              id={nameId}
              area={area}
              invalid={problems.length > 0}
              onChange={(next) => set(withLabel(area, next))}
            />
            {isMapped(area) && (
              <RadiusSelect
                area={area}
                onChange={(radiusM) => set(withRadius(area, radiusM))}
              />
            )}
            <p className="help" role={problems.length ? "alert" : undefined}>
              {problems.length
                ? problems[0]
                : isMapped(area)
                  ? `${areaSummary(area)}. Центр округлён примерно до километра.`
                  : "Без привязки к карте: подбор опирается только на подпись. Отметьте область на карте, чтобы подбор учитывал расстояние."}
            </p>
          </>
        ) : null}
        <AreaPicker
          key={generation}
          engines
          disabled={disabled}
          value={position || area || {}}
          showRadius={false}
          onChange={(next) => (position ? setPosition(next) : set(next))}
        />
        {position ? (
          <div className={styles.areaActions}>
            <button
              type="button"
              className="button small"
              disabled={!cleanLabel(position.label || "")}
              onClick={() => {
                set({ ...position, label: cleanLabel(position.label || "") });
                setPosition(null);
                setAnnouncement("Область по вашему положению выбрана");
              }}
            >
              Использовать эту область
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setPosition(null);
                setGeneration((n) => n + 1);
              }}
            >
              Отмена
            </button>
          </div>
        ) : area ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              set(undefined);
              setGeneration((n) => n + 1);
            }}
          >
            <X size={14} aria-hidden="true" /> Убрать область
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
