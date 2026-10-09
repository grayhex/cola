"use client";
import type { Area } from "../../lib/ride-match-core.ts";
import type { Place } from "../../lib/geocoding.ts";
import type { Ref } from "react";
import type { PassportDraft } from "./ride-types.ts";
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import AreaPicker from "./ride-area-map.tsx";
import InfoTip from "./info-tip.tsx";
import { usePlaceSearch } from "./use-place-search.ts";
import {
  PositionError,
  currentPosition,
  positionMessages,
} from "./device-position.ts";
import {
  areaFromPlace,
  areaFromPosition,
  areaCompact,
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
  problem,
  id,
  inputRef,
  onBlur,
  onDone,
}: {
  area: Area;
  onChange: (label: string) => void;
  disabled?: boolean;
  /** What is wrong with the name, said under the field. */
  problem?: string;
  id: string;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
  /** Enter, or the button beside the field: the name is final. */
  onDone?: () => void;
}) {
  return (
    <div className={styles.nameField}>
      <label className="field">
        <span>Название области</span>
        <input
          id={id}
          ref={inputRef}
          required
          disabled={disabled}
          maxLength={areaLabelMax}
          placeholder="Например, Измайловский парк"
          aria-invalid={!!problem || undefined}
          aria-describedby={problem ? id + "-problem" : undefined}
          value={area.label || ""}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter would send the form; here it settles the name.
            if (e.key === "Enter" && onDone) {
              e.preventDefault();
              onDone();
            }
          }}
        />
      </label>
      {onDone && (
        <button type="button" className="quiet small" onClick={onDone}>
          Готово
        </button>
      )}
      {problem && (
        <small id={id + "-problem"} className="field-error">
          {problem}
        </small>
      )}
    </div>
  );
}

export function AreaField({
  value = {},
  onChange,
  disabled = false,
  intent = false,
  label = "Область поездки",
  check = 0,
  onPending,
}: {
  value?: PassportDraft;
  onChange: (value: PassportDraft) => void;
  disabled?: boolean;
  intent?: boolean;
  label?: string;
  /**
   * The form counts up when it refused to save for the area: the field says
   * what is missing at the place and takes the focus there.
   */
  check?: number;
  /**
   * Tells the form whether an area around the device's position is waiting for
   * a name and a confirmation: such an area is not the form's area yet, and
   * the form must not save the old one in its place.
   */
  onPending?: (pending: boolean) => void;
}) {
  const id = useId(),
    [query, setQuery] = useState(""),
    // An area around the device's position waits here until it is confirmed.
    [position, setPosition] = useState<Area | null>(null),
    [locating, setLocating] = useState(false),
    [locationMessage, setLocationMessage] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    // Taking the area away starts the picker over, closed; choosing does not.
    [generation, setGeneration] = useState(0),
    // «Изменить место»: the search is back, the chosen area stays meanwhile.
    [changing, setChanging] = useState(false),
    // «Переименовать»: the name field in place of the chip's text.
    [renaming, setRenaming] = useState(false),
    // The name of a position's area is asked for, and said when it is not given.
    [positionAsked, setPositionAsked] = useState(false),
    [searchAsked, setSearchAsked] = useState(false);
  const search = usePlaceSearch(query, !disabled && !position);
  const results = useRef<HTMLUListElement | null>(null),
    searchInput = useRef<HTMLInputElement | null>(null),
    nameInput = useRef<HTMLInputElement | null>(null),
    positionName = useRef<HTMLInputElement | null>(null),
    focusPositionName = useRef(false),
    focusName = useRef(false),
    focusSearch = useRef(false);
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
    setChanging(false);
    setRenaming(false);
    setAnnouncement(`Выбрана область: ${areaSummary(next)}`);
  }
  async function useMyLocation() {
    setLocating(true);
    setLocationMessage("");
    try {
      focusPositionName.current = true;
      setPositionAsked(false);
      setPosition(areaFromPosition(await currentPosition()));
    } catch (error) {
      focusPositionName.current = false;
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
  // A name is missing from the area on the screen: said under the field, which
  // is shown for as long as it is missing.
  const problem = area && problems.length ? problems[0] : "";
  const showName = !!area && (renaming || !!problem);
  const showSearch = !position && (!area || changing);
  const nameId = id + "-name";
  const hint = intent
    ? "Приблизительный район или парк, без домашнего адреса."
    : "Приблизительный район, без домашнего адреса.";
  const positionProblem =
    positionAsked && !cleanLabel(position?.label || "")
      ? "Назовите область: подпись обязательна"
      : "";
  // Focus goes where the person is to act next, after the page has it.
  useEffect(() => {
    if (position && focusPositionName.current) {
      focusPositionName.current = false;
      positionName.current?.focus();
    }
    if (showName && focusName.current) {
      focusName.current = false;
      nameInput.current?.focus();
    }
    if (showSearch && focusSearch.current) {
      focusSearch.current = false;
      searchInput.current?.focus();
    }
  });
  useEffect(() => {
    onPending?.(!!position);
    return () => onPending?.(false);
  }, [position, onPending]);
  // The form refused to save for the area: the missing thing is said at its
  // place and has the focus (a name, or a place to look for).
  useEffect(() => {
    if (!check) return;
    setPositionAsked(true);
    setSearchAsked(true);
    if (position) positionName.current?.focus();
    else if (area) {
      if (problem) nameInput.current?.focus();
    } else searchInput.current?.focus();
  }, [check]); // eslint-disable-line react-hooks/exhaustive-deps -- a signal
  useEffect(() => {
    // The live region says it once, when it appears.
    if (problem) setAnnouncement(problem);
  }, [problem]);
  return (
    <fieldset
      className={styles.areaField}
      disabled={disabled}
      aria-label={label}
    >
      {showSearch && (
        <div className={styles.searchBlock}>
          <div className={styles.searchHead}>
            <label htmlFor={id + "-search"}>
              <Search size={14} aria-hidden="true" /> Найти место
            </label>
            <InfoTip id={id + "-hint"} label="Подробнее: поиск места">
              {hint} Выберите место из списка: подпись, центр и радиус задаются
              вместе.
            </InfoTip>
            {area && (
              <button
                type="button"
                className={"quiet small " + styles.clear}
                onClick={() => {
                  setChanging(false);
                  setQuery("");
                }}
              >
                Не менять
              </button>
            )}
          </div>
          <div className={styles.searchRow}>
            <input
              id={id + "-search"}
              ref={searchInput}
              type="search"
              role="searchbox"
              autoComplete="off"
              maxLength={areaLabelMax}
              placeholder="Например, Измайловский парк"
              aria-describedby={id + "-hint"}
              aria-invalid={(searchAsked && !area && !position) || undefined}
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
            <button
              type="button"
              className="button secondary small"
              disabled={locating}
              aria-busy={locating || undefined}
              aria-label="Использовать моё местоположение"
              title="Использовать моё местоположение"
              onClick={useMyLocation}
            >
              <LocateFixed size={14} aria-hidden="true" />
              <span className={styles.locateText}>
                {locating ? "Определяем…" : "Моё местоположение"}
              </span>
            </button>
          </div>
          {searchAsked && !area && !position && (
            <small className="field-error">
              Укажите район или парк: найдите место по названию.
            </small>
          )}
        </div>
      )}
      {/* The search says what it is doing in plain view; what was chosen is
          announced to a screen reader only (the chip shows it). Live regions,
          not a «status» of their own: the form's other messages stay the one
          status of the window. */}
      <div aria-live="polite" className={styles.placeStatus}>
        {search.status === "loading" && showSearch && "Ищем…"}
        {search.status === "empty" &&
          showSearch &&
          "Ничего не найдено. Уточните название или назовите область сами."}
        {search.status === "error" && showSearch && search.message}
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {showSearch && search.status === "found" && (
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
      {showSearch && typed.length >= 2 && (
        <button
          type="button"
          className={"quiet " + styles.asLabel}
          onClick={() => {
            set({ label: typed });
            setQuery("");
            setChanging(false);
            setAnnouncement(`Область «${typed}» без привязки к карте`);
          }}
        >
          Использовать «{typed}» как подпись без карты
        </button>
      )}
      {locationMessage && showSearch && (
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
            <div className={styles.chosenHead}>
              <span className={styles.chip}>
                <LocateFixed size={14} aria-hidden="true" /> По вашему положению
              </span>
              <InfoTip label="Подробнее: область по положению">
                Приблизительная область по вашему положению. Назовите её районом
                или парком и подтвердите: пока вы не нажали «Использовать эту
                область», ничего не меняется. Точное положение не сохраняется —
                центр округляется примерно до километра.
              </InfoTip>
            </div>
            <div className={styles.nameRow}>
              <NameField
                id={nameId + "-position"}
                area={position}
                inputRef={positionName}
                problem={positionProblem}
                onBlur={() => setPositionAsked(true)}
                onChange={(next) => setPosition(withLabel(position, next))}
              />
              <RadiusSelect
                area={position}
                onChange={(radiusM) =>
                  setPosition(withRadius(position, radiusM))
                }
              />
            </div>
            {!positionProblem && !cleanLabel(position.label || "") && (
              <small className={styles.needName}>
                Укажите название района или парка, чтобы сохранить область.
              </small>
            )}
          </>
        ) : area ? (
          <>
            <div className={styles.chosenHead}>
              <span className={styles.chip}>
                <MapPin size={14} aria-hidden="true" />
                {areaCompact(area)}
              </span>
              <InfoTip label="Подробнее: выбранная область">
                {isMapped(area)
                  ? "Центр округлён примерно до километра: подбор учитывает расстояние до области."
                  : "Без привязки к карте подбор опирается только на подпись. Отметьте область на карте, чтобы он учитывал расстояние."}
              </InfoTip>
              <span className={styles.chosenActions}>
                {!changing && (
                  <button
                    type="button"
                    className="quiet small"
                    onClick={() => {
                      focusSearch.current = true;
                      setChanging(true);
                    }}
                  >
                    Изменить место
                  </button>
                )}
                {!showName && (
                  <button
                    type="button"
                    className="quiet small"
                    onClick={() => {
                      focusName.current = true;
                      setRenaming(true);
                    }}
                  >
                    Переименовать
                  </button>
                )}
                <button
                  type="button"
                  className="icon quiet small"
                  aria-label="Очистить область"
                  title="Очистить область"
                  onClick={() => {
                    set(undefined);
                    setChanging(false);
                    setRenaming(false);
                    setGeneration((n) => n + 1);
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </span>
            </div>
            <div
              className={
                styles.nameRow + (showName ? "" : " " + styles.radiusOnly)
              }
            >
              {showName && (
                <NameField
                  id={nameId}
                  area={area}
                  inputRef={nameInput}
                  problem={problem}
                  onChange={(next) => set(withLabel(area, next))}
                  onDone={
                    problem
                      ? undefined
                      : () => {
                          setRenaming(false);
                        }
                  }
                />
              )}
              {isMapped(area) && (
                <RadiusSelect
                  area={area}
                  onChange={(radiusM) => set(withRadius(area, radiusM))}
                />
              )}
            </div>
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
        {position && (
          <div className={styles.areaActions}>
            <button
              type="button"
              className="button small"
              aria-disabled={!cleanLabel(position.label || "") || undefined}
              onClick={() => {
                if (!cleanLabel(position.label || "")) {
                  // Not given yet: say it at the field and go there.
                  setPositionAsked(true);
                  positionName.current?.focus();
                  return;
                }
                set({ ...position, label: cleanLabel(position.label || "") });
                setPosition(null);
                setChanging(false);
                setRenaming(false);
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
        )}
      </div>
    </fieldset>
  );
}
