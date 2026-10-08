"use client";
import type { Area } from "../../lib/ride-match-core.ts";
import type { MapSettings } from "../../lib/map-settings.ts";
import type { AreaMapHandle } from "./area-map-engines.ts";
import { useEffect, useId, useRef, useState } from "react";
import { Crosshair, MapPin, Minus, Plus, X } from "lucide-react";
import { errorMessage } from "../../lib/errors.ts";
import { mapStyle } from "../../lib/map-settings.ts";
import { isMapped, withCenter, withoutMap } from "../../lib/ride-area.ts";
import { MapAttribution } from "./ride-basemap.tsx";
import styles from "./ride-passport.module.css";

// The area picker for the site's MapLibre-style and Yandex maps (#370). The
// raster maps keep the light SVG picker; these two load their engine only when
// the picker is opened, draw the circle of the chosen area, and put the centre
// where the map is clicked or, from the keyboard, in the middle of the map.
// When the engine cannot start — no WebGL, no SDK, a wrong key or style — the
// area is still found by name, chosen around a position or named by hand.
const initialCenter = [37.62, 55.75];
type Phase = "loading" | "ready" | "error";
const messages = {
  unavailable:
    "Карта не загрузилась. Найдите место по названию или назовите область — этого достаточно.",
  reload:
    "Ключ Яндекс Карт изменился. Обновите страницу для подключения нового ключа.",
  key: "Ключ Яндекс Карт не задан. Найдите место по названию или назовите область.",
  style:
    "Стиль карты не задан в настройках сайта. Найдите место по названию или назовите область.",
};
// A zoom where a circle of this radius fits a window of about 300 px.
function zoomFor(radiusM: number, lat: number) {
  for (let zoom = 14; zoom > 3; zoom--) {
    const perPixel =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
    if (radiusM / perPixel <= 110) return zoom;
  }
  return 3;
}
const accentOf = (element: HTMLElement) => {
  const accent = getComputedStyle(element).getPropertyValue("--accent").trim();
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#e7482f";
};

export default function EngineAreaPicker({
  value = {},
  onChange,
  disabled,
  config,
}: {
  value?: Area;
  onChange: (value: Area) => void;
  disabled?: boolean;
  config: MapSettings;
}) {
  const id = useId(),
    [open, setOpen] = useState(isMapped(value)),
    [phase, setPhase] = useState<Phase>("loading"),
    [problem, setProblem] = useState(""),
    [attempt, setAttempt] = useState(0);
  const canvas = useRef<HTMLDivElement | null>(null),
    handle = useRef<AreaMapHandle | null>(null),
    latest = useRef({ value, onChange, disabled }),
    // The centre the map itself put there: the map is already looking at it.
    placed = useRef(""),
    shown = useRef("");
  latest.current = { value, onChange, disabled };
  const mapped = isMapped(value) ? value : null;
  const key = mapped ? `${mapped.center.join(",")}:${mapped.radiusM}` : "";
  const provider = config.provider;
  const publicKey = config.publicKey?.trim() || "";
  const styleSource = provider === "style" ? mapStyle(config) : null;
  // A style that is a URL; an empty one is a setting that was never filled in.
  const styleUrl = typeof styleSource === "string" ? styleSource : "";

  // The engine lives while the picker is open.
  useEffect(() => {
    if (!open) return;
    let disposed = false,
      created: AreaMapHandle | undefined;
    setPhase("loading");
    setProblem("");
    shown.current = "";
    const container = canvas.current;
    if (!container) return;
    if (provider === "style" && !styleUrl) {
      setPhase("error");
      setProblem(messages.style);
      return;
    }
    if (provider === "yandex" && !publicKey) {
      setPhase("error");
      setProblem(messages.key);
      return;
    }
    const start = latest.current.value;
    const options = {
      center: isMapped(start) ? start.center : initialCenter,
      zoom: isMapped(start) ? zoomFor(start.radiusM, start.center[1]) : 10,
      color: accentOf(container),
      dotClass: styles.engineDot,
      onPick: (point: number[]) => {
        const {
          value: current,
          onChange: change,
          disabled: off,
        } = latest.current;
        if (off) return;
        const next = withCenter(current, point);
        placed.current = next.center?.join(",") || "";
        change(next);
      },
      onReady: () => {
        if (disposed) return;
        setPhase("ready");
        setProblem("");
      },
      onError: (reason: "unavailable" | "reload") => {
        if (disposed) return;
        setPhase("error");
        setProblem(messages[reason]);
      },
    };
    const make =
      provider === "yandex"
        ? import("./area-map-engines.ts").then((engine) =>
            engine.createYandexAreaMap(container, publicKey, {
              ...options,
              retry: attempt > 0,
            }),
          )
        : import("./area-map-engines.ts").then((engine) =>
            engine.createLibreAreaMap(container, styleUrl, options),
          );
    make
      .then((engineHandle) => {
        if (disposed) {
          engineHandle.destroy();
          return;
        }
        created = engineHandle;
        handle.current = engineHandle;
        const { value: current } = latest.current;
        engineHandle.show(isMapped(current) ? current : null, false);
      })
      .catch((error) => {
        if (disposed) return;
        setPhase("error");
        setProblem(
          errorMessage(error) === "YANDEX_MAPS_RELOAD_REQUIRED"
            ? messages.reload
            : errorMessage(error) === "YANDEX_MAPS_KEY_MISSING"
              ? messages.key
              : messages.unavailable,
        );
      });
    return () => {
      disposed = true;
      handle.current = null;
      created?.destroy();
    };
  }, [open, provider, publicKey, styleUrl, attempt]);

  // The circle follows the area; an area that comes from outside (a place, a
  // position, an edit) is also brought into view, one the map itself placed is not.
  useEffect(() => {
    const engine = handle.current;
    if (!engine || phase === "error") return;
    const own = !!mapped && placed.current === mapped.center.join(",");
    engine.show(mapped, !own && key !== shown.current);
    shown.current = key;
  }, [key, mapped, phase]);
  // The first area also opens the picker, so a place found by name is seen.
  useEffect(() => {
    if (mapped) setOpen(true);
  }, [mapped]);

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
  const km = mapped ? mapped.radiusM / 1000 : null;
  return (
    <fieldset
      className={styles.picker}
      disabled={disabled}
      data-map-provider={provider}
    >
      <legend>Область на карте</legend>
      <p className="help" id={id + "-help"}>
        Нажмите на карту, чтобы поставить центр, или передвиньте карту и нажмите
        «Поставить центр сюда». Точка округляется примерно до километра —
        выберите район или парк, не дом.
      </p>
      <div className={styles.engineFrame}>
        <div
          ref={canvas}
          className={styles.engineCanvas + " map-engine"}
          role="group"
          aria-label={
            km
              ? `Карта: выбран круг ${km} км`
              : "Карта: центр области не выбран"
          }
          aria-describedby={id + "-help"}
          aria-busy={phase === "loading"}
          data-ready={phase === "ready"}
          data-area-center={mapped?.center.join(",") || undefined}
          data-area-radius={mapped?.radiusM}
        />
        {phase === "ready" && provider !== "yandex" && (
          <MapAttribution config={config} />
        )}
      </div>
      <div className={styles.pickerControls}>
        <button
          type="button"
          className="icon secondary small"
          aria-label="Приблизить карту"
          disabled={phase !== "ready"}
          onClick={() => handle.current?.zoom(1)}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="icon secondary small"
          aria-label="Отдалить карту"
          disabled={phase !== "ready"}
          onClick={() => handle.current?.zoom(-1)}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={phase !== "ready"}
          onClick={() => {
            const middle = handle.current?.center();
            if (!middle) return;
            const next = withCenter(latest.current.value, middle);
            placed.current = next.center?.join(",") || "";
            onChange(next);
          }}
        >
          <Crosshair size={14} aria-hidden="true" /> Поставить центр сюда
        </button>
        {mapped ? (
          <button
            type="button"
            className="quiet"
            onClick={() => onChange(withoutMap(value))}
          >
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
      {phase === "loading" && (
        <small className="help" aria-live="polite">
          Загружаем карту…
        </small>
      )}
      {phase === "error" && (
        <p className="help" role="status">
          {problem || messages.unavailable}{" "}
          {problem === messages.unavailable && (
            <button
              type="button"
              className="quiet"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Повторить загрузку
            </button>
          )}
          {problem === messages.reload && (
            <button
              type="button"
              className="quiet"
              onClick={() => window.location.reload()}
            >
              Обновить страницу
            </button>
          )}
        </p>
      )}
    </fieldset>
  );
}
