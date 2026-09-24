"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadYandexMaps } from "../../lib/yandex-maps.js";
import { createYandexRideMap, yandexRoute } from "../../lib/yandex-ride-map.js";
import RideBasemap from "./ride-basemap.jsx";
import styles from "./yandex-ride-map.module.css";

const unavailable =
  "Яндекс Карты недоступны. Показана резервная карта OSM. Проверьте ключ, разрешённый домен и лимит API в настройках карты.";

export default function YandexRideMap({
  geometry,
  config,
  view = "map",
  scrollZoom = false,
}) {
  const frame = useRef(null);
  const canvas = useRef(null);
  const handle = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState({ ready: false, error: "" });
  const route = useMemo(() => yandexRoute(geometry), [geometry]);
  const enabled = config.enabled && view === "map" && !!route;
  const key = config.publicKey?.trim() || "";

  useEffect(() => {
    if (!enabled) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        // Do not recreate a billable map when scrolling it out and back in.
        observer.disconnect();
      }
    });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    let disposed = false;
    let instance;
    setState({ ready: false, error: "" });
    if (!enabled || !visible) return;
    const failed = (message = unavailable) => {
      if (!disposed) setState({ ready: false, error: message });
    };
    loadYandexMaps(key, { retry: attempt > 0 })
      .then((api) => {
        if (disposed) return;
        instance = createYandexRideMap(api, canvas.current, route, {
          color:
            getComputedStyle(canvas.current)
              .getPropertyValue("--accent")
              .trim() || "#e7482f",
          scrollZoom,
          markerClass: styles.marker,
          onReady: () => {
            if (!disposed) setState({ ready: true, error: "" });
          },
          onUnavailable: failed,
        });
        handle.current = instance;
      })
      .catch((error) => {
        if (error.message === "YANDEX_MAPS_RELOAD_REQUIRED") {
          failed(
            "Ключ Яндекс Карт изменился. Обновите страницу для подключения нового ключа.",
          );
        } else if (error.message === "YANDEX_MAPS_KEY_MISSING") {
          failed("Ключ Яндекс Карт не задан. Показана резервная карта OSM.");
        } else {
          failed();
        }
      });
    return () => {
      disposed = true;
      handle.current = null;
      instance?.destroy();
    };
  }, [enabled, visible, key, route, scrollZoom, attempt]);

  if (view === "hidden") return null;
  if (!enabled) return <RideBasemap geometry={geometry} forceRoute />;
  return (
    <div className={styles.wrapper} data-map-provider="yandex">
      <div
        className={styles.frame}
        ref={frame}
        aria-busy={visible && !state.ready && !state.error}
      >
        <div
          ref={canvas}
          className={styles.canvas}
          data-ready={state.ready}
          aria-label="Яндекс Карта маршрута"
          aria-hidden={!state.ready}
          inert={!state.ready}
        />
        {!state.ready && (
          <div className={styles.fallback}>
            <RideBasemap geometry={geometry} thumbnail />
          </div>
        )}
        {state.ready && (
          <div
            className={styles.controls}
            role="group"
            aria-label="Управление Яндекс Картой"
          >
            <button
              type="button"
              aria-label="Приблизить карту"
              onClick={() => handle.current?.zoom(1)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Отдалить карту"
              onClick={() => handle.current?.zoom(-1)}
            >
              −
            </button>
            <button type="button" onClick={() => handle.current?.fit()}>
              Весь маршрут
            </button>
          </div>
        )}
      </div>
      {state.error ? (
        <p className="help" role="status">
          {state.error}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              if (handle.current || !window.ymaps3) setAttempt((v) => v + 1);
              else window.location.reload();
            }}
          >
            Повторить загрузку
          </button>
        </p>
      ) : visible && !state.ready ? (
        <p className="help" role="status">
          Загружаем Яндекс Карту…
        </p>
      ) : null}
    </div>
  );
}
