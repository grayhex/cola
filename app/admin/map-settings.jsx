"use client";
import { mapDefaults } from "../../lib/map-settings.js";
export default function MapSettings({ settings, onChange }) {
  const v = settings.map || mapDefaults,
    set = (k, value) => onChange("map", { ...v, [k]: value });
  const yandex = v.provider === "yandex";
  return (
    <section className="admin-panel">
      <h2>Карта маршрутов</h2>
      <p className="help">
        {yandex
          ? "Яндекс Карты подключаются через официальный JavaScript API 3.0. Ключ используется только в браузере."
          : "OpenStreetMap работает без API-ключа. Запросы тайлов идут из браузера, с обычным кешированием и указанием авторства."}
      </p>
      <label className="setting-row">
        Подключать подложку
        <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
      </label>
      <label className="field">
        <span>Провайдер карты</span>
        <select value={v.provider} onChange={(e) => set("provider", e.target.value)}>
          <option value="osm">OpenStreetMap</option>
          <option value="yandex">Яндекс Карты · JavaScript API 3.0</option>
          <option value="raster">Свой сервер растровых тайлов</option>
          <option value="style">Стиль MapLibre</option>
        </select>
      </label>
      {v.provider === "raster" && (
        <label className="field">
          <span>URL тайлов: {"{z}/{x}/{y}"}</span>
          <input value={v.tileUrl} maxLength={2000} onChange={(e) => set("tileUrl", e.target.value)} />
        </label>
      )}
      {v.provider === "style" && (
        <label className="field">
          <span>URL стиля MapLibre</span>
          <input value={v.styleUrl} maxLength={2000} onChange={(e) => set("styleUrl", e.target.value)} />
        </label>
      )}
      {v.provider !== "osm" && (
        <label className="field">
          <span>{yandex ? "API-ключ Яндекс Карт" : "Публичный API-ключ"}</span>
          <input
            value={v.publicKey}
            required={yandex && v.enabled}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set("publicKey", e.target.value)}
          />
          <small>
            {yandex
              ? "Ключ пакета JavaScript API из кабинета Яндекс Карт. Он виден посетителям: ограничьте его по HTTP Referer доменом colabike.ru. После смены ключа сохраните настройки и обновите страницу."
              : "Только ключ для браузера: он виден посетителям. В URL используйте {key}. Секретные серверные ключи сюда не вводите."}
          </small>
        </label>
      )}
      {v.provider !== "osm" && !yandex && (
        <label className="field">
          <span>Авторство / название провайдера</span>
          <input value={v.attribution} maxLength={200} onChange={(e) => set("attribution", e.target.value)} />
        </label>
      )}
      {yandex && (
        <p className="help">
          URL тайлов и OAuth-секрет не нужны. Авторство отображает сам Яндекс API.
          Полноценная карта загружается только в видимой области страницы покатушки;
          превью в списках показывают линию без API-запросов. Учитывайте ограничения
          своего тарифа.
        </p>
      )}
      <p className="help">
        Если подложка отключена или недоступна, маршрут остаётся виден. Личные
        настройки отображения — «Аккаунт → Оформление».
      </p>
    </section>
  );
}
