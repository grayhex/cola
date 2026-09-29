"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, MapPin, X } from "lucide-react";
import { MapAttribution } from "./ride-basemap.jsx";
import { useSite } from "./site-provider.jsx";
import {
  mapDefaults,
  isRasterProvider,
  tileTemplate,
  pointViewport,
  coarsePoint,
} from "../../lib/map-settings.js";
import styles from "./ride-passport.module.css";

// Coarse area on the admin's raster basemap (#241): a circle, never a precise
// point. No geolocation, geocoder or WebGL; tiles load only when the picker is
// open (or the read-only preview is on screen). Other providers keep the label.
export const areaRadii = [1, 2, 3, 5, 10, 20, 50, 100];
// Without an earlier choice the picker opens on Moscow; the user moves it.
const initialCenter = [37.62, 55.75];
const width = 640,
  height = 320;
function useRasterConfig() {
  const { personalSettings: settings } = useSite();
  const config = settings.map || mapDefaults;
  return config.enabled && isRasterProvider(config) ? config : null;
}
function Tiles({ viewport, template, onFail }) {
  return viewport.tiles.map((t) => (
    <image
      key={t.z + ":" + t.x + ":" + t.y}
      x={t.left}
      y={t.top}
      width="256"
      height="256"
      href={template
        .replaceAll("{z}", t.z)
        .replaceAll("{x}", t.x)
        .replaceAll("{y}", t.y)}
      onError={onFail}
    />
  ));
}
function Circle({ viewport, area, marker = false }) {
  const [x, y] = viewport.point(area.center);
  return (
    <>
      <circle
        className={styles.areaCircle}
        cx={x}
        cy={y}
        r={Math.max(6, viewport.pixels(area.radiusM))}
      />
      {marker && <circle className={styles.areaCenter} cx={x} cy={y} r="4" />}
    </>
  );
}
/** Read-only preview for a stored area with centre and radius. */
export function AreaPreview({ area }) {
  const config = useRasterConfig(),
    ref = useRef(null),
    [visible, setVisible] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const center = area?.center,
    radiusM = area?.radiusM;
  const viewport = useMemo(
    () =>
      center && radiusM
        ? pointViewport(center, zoomFor(radiusM, center[1]), width, height)
        : null,
    [center, radiusM],
  );
  if (!viewport) return null;
  return (
    <div ref={ref} className={styles.areaMap}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Приблизительная область: круг около ${area.radiusM / 1000} км`}
      >
        {visible && config && !failed && (
          <Tiles
            viewport={viewport}
            template={tileTemplate(config)}
            onFail={() => setFailed(true)}
          />
        )}
        <Circle viewport={viewport} area={area} />
      </svg>
      {config && !failed && <MapAttribution config={config} />}
    </div>
  );
}
// A zoom where the whole circle comfortably fits the window.
function zoomFor(radiusM, lat) {
  for (let zoom = 14; zoom > 3; zoom--) {
    const perPixel =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
    if (radiusM / perPixel <= height / 2 - 24) return zoom;
  }
  return 3;
}
/** Editable centre + radius. `value` is the whole area object ({label, …}). */
export default function AreaPicker({ value = {}, onChange, disabled }) {
  const config = useRasterConfig(),
    [open, setOpen] = useState(!!value.center),
    [failed, setFailed] = useState(false),
    [zoom, setZoom] = useState(() =>
      value.center ? zoomFor(value.radiusM, value.center[1]) : 10,
    ),
    [view, setView] = useState(value.center || initialCenter);
  const svg = useRef(null);
  const viewport = useMemo(
    () => pointViewport(view, zoom, width, height),
    [view, zoom],
  );
  if (!config)
    return (
      <p className="help">
        Карта в настройках сайта недоступна — достаточно подписи района.
      </p>
    );
  const radiusKm = value.radiusM ? value.radiusM / 1000 : 5;
  const place = (center, radius = radiusKm) => {
    const point = coarsePoint(center);
    setView(point);
    onChange({ ...value, center: point, radiusM: radius * 1000 });
  };
  const clear = () => {
    const { center, radiusM, ...rest } = value;
    void center;
    void radiusM;
    onChange(rest);
  };
  function pick(e) {
    const box = svg.current.getBoundingClientRect();
    place(
      viewport.coordAt(
        ((e.clientX - box.left) / box.width) * width,
        ((e.clientY - box.top) / box.height) * height,
      ),
    );
  }
  function key(e) {
    const step = 48,
      moves = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      place(viewport.coordAt(width / 2 + dx, height / 2 + dy));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setZoom((z) => Math.min(15, z + 1));
    } else if (e.key === "-") {
      e.preventDefault();
      setZoom((z) => Math.max(3, z - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      place(view);
    }
  }
  if (!open)
    return (
      <button
        type="button"
        className="button secondary small"
        disabled={disabled}
        aria-expanded="false"
        onClick={() => setOpen(true)}
      >
        <MapPin size={14} aria-hidden="true" /> Отметить область на карте
      </button>
    );
  const area = value.center ? value : null;
  return (
    <fieldset className={styles.picker} disabled={disabled}>
      <legend>Область на карте</legend>
      <p className="help" id="area-map-help">
        Нажмите на карту или используйте стрелки, «+» и «−». Точка округляется
        примерно до километра — выберите район или парк, не дом.
      </p>
      <div className={styles.areaMap}>
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          role="application"
          tabIndex={0}
          aria-label={
            area
              ? `Карта: выбран круг ${radiusKm} км. Стрелки двигают центр.`
              : "Карта: стрелки или Enter ставят центр области"
          }
          aria-describedby="area-map-help"
          onClick={pick}
          onKeyDown={key}
        >
          {!failed && (
            <Tiles
              viewport={viewport}
              template={tileTemplate(config)}
              onFail={() => setFailed(true)}
            />
          )}
          {area && <Circle viewport={viewport} area={area} marker />}
          {!area && (
            <path
              className={styles.areaCross}
              d={`M${width / 2 - 10},${height / 2}h20M${width / 2},${height / 2 - 10}v20`}
            />
          )}
        </svg>
        {!failed && <MapAttribution config={config} />}
        {failed && (
          <small className="help map-status">
            Подложка не загрузилась · центр всё равно можно выбрать стрелками
          </small>
        )}
      </div>
      <div className={styles.pickerControls}>
        <button
          type="button"
          className="icon secondary small"
          aria-label="Приблизить карту"
          onClick={() => setZoom((z) => Math.min(15, z + 1))}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="icon secondary small"
          aria-label="Отдалить карту"
          onClick={() => setZoom((z) => Math.max(3, z - 1))}
        >
          <Minus size={14} />
        </button>
        <label className="field">
          <span>Радиус</span>
          <select
            value={radiusKm}
            onChange={(e) =>
              area
                ? place(area.center, Number(e.target.value))
                : place(view, Number(e.target.value))
            }
          >
            {areaRadii.map((km) => (
              <option key={km} value={km}>
                {km} км
              </option>
            ))}
          </select>
        </label>
        {area ? (
          <button type="button" className="quiet" onClick={clear}>
            <X size={14} aria-hidden="true" /> Убрать с карты
          </button>
        ) : (
          <button
            type="button"
            className="quiet"
            onClick={() => setOpen(false)}
          >
            Свернуть
          </button>
        )}
      </div>
      <p className="help" role="status">
        {area
          ? `Выбрана область радиусом ${radiusKm} км. Подпись района остаётся обязательной.`
          : "Центр не выбран — подбор будет опираться только на подпись."}
      </p>
    </fieldset>
  );
}
