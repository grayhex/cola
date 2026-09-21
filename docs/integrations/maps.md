# Картографические подложки

[Оглавление](../README.md)

## Ответственность

Карта показывает уже разрешённую API геометрию покатушки; она не пересчитывает GPX, не достраивает скрытые участки и не выполняет routing/geocoding. Серверные privacy-зоны и настройки зрителя — разные вещи. При отказе подложки сохраняются линия маршрута и метрики.

Код: [map-settings.js](../../lib/map-settings.js), [ride-map.jsx](../../app/ui/ride-map.jsx), [ride-basemap.jsx](../../app/ui/ride-basemap.jsx), [admin map settings](../../app/admin/map-settings.jsx). Серверная схема находится в [admin-validation.js](../../lib/admin-validation.js).

## Провайдеры

| Значение | Реализация | Настройка |
| --- | --- | --- |
| `osm` | Официальная растровая подложка OSM; MapLibre detail и SVG preview | Default, без ключа |
| `raster` | Совместимый HTTPS XYZ endpoint | `tileUrl` с `{z}/{x}/{y}`, при необходимости `{key}` |
| `style` | MapLibre style URL | `styleUrl`, при необходимости публичный ключ |
| `yandex` | Официальный JavaScript API 3.0, отдельный renderer | `publicKey` продукта JavaScript API |

Меняется в **Админка → Система → Карта**. Значения карты доступны браузеру; server secrets туда не вводятся. Сохранённые personal preferences `rideMapView` и `mapScrollZoom` управляют показом/колесом только у зрителя.

Legacy `MAP_STYLE_URL` остаётся env-настройкой и передаётся странице. Яндекс имеет приоритет над ним; для остальных провайдеров явный `styleUrl` в `RideMap` может переопределять вычисленный стиль. При неожиданном результате проверяйте одновременно admin settings и эту переменную. Не описывайте её как обязательную для всех карт или как всегда игнорируемую после сохранения settings.

## Яндекс

[Загрузчик](../../lib/yandex-maps.js), [renderer](../../lib/yandex-ride-map.js), [компонент](../../app/ui/yandex-ride-map.jsx) используют JS API v3, не недокументированные tile URLs. Ключ вводится в существующее поле; OAuth Client Secret, новые env и миграция БД для этого не нужны.

В кабинете провайдера ограничьте браузерный ключ нужным HTTP Referer; для staging используйте отдельный разрешённый домен/ключ. Порядок настройки и актуальные ограничения: [официальная документация Яндекса](https://yandex.ru/maps-api/docs/js-api/limit.html). Лимиты/стоимость проверяйте в своём кабинете, не по старому скриншоту.

SDK загружается при появлении полноценной карты, один раз на документ. В списках и миниатюрах при Яндексе используются SVG-линии без запросов к Яндексу **и OSM**. Режимы «линия», «скрыть», выключенная подложка и пустая geometry не должны загружать SDK. Ошибки и таймауты не запускают бесконечные повторы. После смены загруженного ключа нужна полная перезагрузка страницы.

Сегменты рисуются раздельно в координатах `[longitude, latitude]`; маркеры обозначают начало/конец видимой части. Нативные логотип/авторство Яндекса не скрываются, чужая OSM-атрибуция не добавляется. Провайдер получает сетевые обращения браузера к подложке — это учитывается в политике приватности сайта.

## OSM, Referer и nginx

Для OSM сохраняется корректная атрибуция, обычное кеширование и запросы видимой области без bulk/offline-download. Условия поставщика: [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

Next и nginx должны разрешать origin в cross-origin Referer без полного приватного URL:

```nginx
add_header Referrer-Policy strict-origin-when-cross-origin always;
```

Обновление репозитория **не переписывает** `/etc/nginx/conf.d/colabike.conf`. Проверка установленного заголовка:

```bash
curl --max-time 10 -sI https://colabike.ru/ | grep -i referrer-policy
```

При старом `same-origin` измените host config, затем `sudo nginx -t && sudo systemctl reload nginx`. Не публикуйте конфиг целиком: в нём proxy key. При собственной CSP проверьте точные домены SDK/resources, не отключайте защиту целиком.

## Проверки

`node --test tests/map-settings.test.js tests/yandex-maps.test.js`; браузерные сценарии в [rides.spec.js](../../tests/e2e/rides.spec.js). Mock SDK подтверждает lifecycle, но живой ключ проверяется на разрешённом домене отдельно. Проверьте broken key/network, wheel, мобильный экран, переключение провайдера, SVG fallback и отсутствие восстановления privacy-разрывов.
