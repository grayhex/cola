"use client";
import { mapDefaults } from "../../lib/map-settings.js";
export default function MapSettings({ settings, onChange }) {
  const v = settings.map || mapDefaults,
    set = (k, value) => onChange("map", { ...v, [k]: value });
  return (
    <section className="admin-panel">
      <h2>Карта маршрутов</h2>
      <p className="help">
        OpenStreetMap работает без API-ключа. Запросы тайлов идут из браузера, с
        обычным кешированием и указанием авторства.
      </p>
      <label className="admin-toggle">
        Подключать подложку
        <input
          type="checkbox"
          checked={v.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
      </label>
      <label className="field">
        <span>Провайдер карты</span>
        <select
          value={v.provider}
          onChange={(e) => set("provider", e.target.value)}
        >
          <option value="osm">OpenStreetMap</option>
          <option value="raster">Свой сервер растровых тайлов</option>
          <option value="style">Стиль MapLibre</option>
        </select>
      </label>
      {v.provider === "raster" && (
        <label className="field">
          <span>URL тайлов: {"{z}/{x}/{y}"}</span>
          <input
            value={v.tileUrl}
            maxLength={2000}
            onChange={(e) => set("tileUrl", e.target.value)}
          />
        </label>
      )}
      {v.provider === "style" && (
        <label className="field">
          <span>URL стиля MapLibre</span>
          <input
            value={v.styleUrl}
            maxLength={2000}
            onChange={(e) => set("styleUrl", e.target.value)}
          />
        </label>
      )}
      {v.provider !== "osm" && (
        <>
          <label className="field">
            <span>Публичный API-ключ</span>
            <input
              value={v.publicKey}
              maxLength={500}
              autoComplete="off"
              onChange={(e) => set("publicKey", e.target.value)}
            />
            <small>
              Только ключ для браузера: он виден посетителям. В URL используйте{" "}
              {"{key}"}. Секретные серверные ключи сюда не вводите.
            </small>
          </label>
          <label className="field">
            <span>Авторство / название провайдера</span>
            <input
              value={v.attribution}
              maxLength={200}
              onChange={(e) => set("attribution", e.target.value)}
            />
          </label>
        </>
      )}
      <p className="help">
        Если подложка отключена или недоступна, маршрут остаётся виден. Личные
        настройки отображения — «Аккаунт → Оформление».
      </p>
    </section>
  );
}
