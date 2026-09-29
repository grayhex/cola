"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SiteIcon from "./site-icon.jsx";
import styles from "./activity-sync.module.css";

const endpoint = "/api/activity-sync/rwgps";
async function api(path = "", method = "GET", body) {
  const response = await fetch(endpoint + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Не удалось выполнить действие");
  return value;
}
export default function ActivitySync({ bikes, disabled = false, onImported }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [bike, setBike] = useState(""),
    [notice, setNotice] = useState(""),
    [version, setVersion] = useState(0);
  const callback = useSearchParams().get("activity_sync");
  useEffect(() => {
    let active = true,
      timer,
      lastSync,
      firstLoad = true;
    async function load() {
      try {
        const result = await api();
        if (!active) return;
        setData(result);
        setError("");
        if (
          lastSync !== undefined &&
          result.lastSyncAt &&
          result.lastSyncAt !== lastSync
        )
          onImported?.();
        lastSync = result.lastSyncAt;
        if (firstLoad) setBike(result.bikeId || "");
        firstLoad = false;
        if (result.connected || result.revoking) timer = setTimeout(load, 5000);
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [version, onImported]);
  async function perform(action) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "connect") {
        const result = await api("/connect", "POST", { bikeId: bike || null });
        window.location.assign(result.url);
        return;
      }
      if (action === "disconnect") {
        await api("", "DELETE");
        setNotice("Подключение отключено. Импортированные поездки сохранены.");
      } else {
        await api("/sync", "POST", { bikeId: bike || null });
        setNotice("Синхронизация поставлена в очередь.");
      }
      setData(await api());
      setVersion((v) => v + 1);
      onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="integration-rwgps">
      <div className={styles.heading}>
        <div>
          <h3 id="integration-rwgps">Ride with GPS</h3>
          <p>Велопоездки автоматически появляются здесь после записи.</p>
        </div>
        <span className={styles.status}>
          {data?.revoking
            ? "Завершаем отключение"
            : data?.connected
              ? "Подключено"
              : data?.enabled
                ? "Автосинхронизация"
                : "Пока недоступно"}
        </span>
      </div>
      {!data && !error && <p role="status">Проверяем подключение…</p>}
      {(error || callback === "error") && (
        <p role="alert">
          {error ||
            "Не удалось подключить Ride with GPS. Начните подключение заново."}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data?.enabled && (
        <>
          <label className={styles.bike}>
            Велосипед для импорта
            <select
              value={bike}
              disabled={busy || disabled}
              onChange={(e) => setBike(e.target.value)}
            >
              <option value="">Автоматически по типу поездки</option>
              {bikes
                .filter((b) => !b.is_former)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <p className={styles.hint}>
            Импортируем последние 12 месяцев. Если велосипед не определён
            однозначно, поездка дождётся вашего выбора. Новые поездки
            непубличные.
          </p>
          <p className={styles.hint}>
            Удаление поездки в Ride with GPS удалит связанную поездку здесь.
          </p>
        </>
      )}
      {data?.connected && (
        <>
          <p>
            Последняя синхронизация:{" "}
            {data.lastSyncAt
              ? new Date(data.lastSyncAt).toLocaleString("ru-RU")
              : "ещё не завершена"}
            {data.pending > 0 ? ` · В очереди: ${data.pending}` : ""}
          </p>
          <p className={styles.hint}>
            Импортировано: {data.counts?.synced || 0}
            {data.counts?.waiting_bike
              ? ` · Нужен велосипед: ${data.counts.waiting_bike}`
              : ""}
            {data.counts?.error ? ` · С ошибкой: ${data.counts.error}` : ""}
          </p>
          {data.error && <p role="status">{data.error}</p>}
          {data.items?.length > 0 && (
            <details>
              <summary>Поездки, требующие внимания</summary>
              <ul>
                {data.items.map((item) => (
                  <li key={item.id}>
                    {item.name || "Поездка"} —{" "}
                    {item.status === "waiting_bike"
                      ? "выберите велосипед и синхронизируйте снова"
                      : item.last_error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <div className={styles.actions}>
        {data?.connected ? (
          <>
            <button
              type="button"
              className="quiet"
              disabled={busy || disabled || !data.enabled}
              onClick={() => perform("sync")}
            >
              <SiteIcon name="repeat" />
              Синхронизировать сейчас
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy || disabled}
              onClick={() => perform("disconnect")}
            >
              Отключить Ride with GPS
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || disabled || !data?.enabled || data?.revoking}
            onClick={() => perform("connect")}
          >
            Подключить Ride with GPS
          </button>
        )}
        {error && (
          <button
            type="button"
            className="quiet"
            onClick={() => setVersion((v) => v + 1)}
          >
            Повторить
          </button>
        )}
      </div>
      {!data?.enabled && (
        <small>Пока можно загрузить GPX / FIT / TCX или Garmin CSV.</small>
      )}
    </section>
  );
}
