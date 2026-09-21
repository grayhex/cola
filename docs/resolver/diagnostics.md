# Диагностика парсера

[Оглавление](../README.md)

## Начинайте с уровня отказа

| Наблюдение | Следующая проверка |
| --- | --- |
| `/api/ready` не готов | База приложения; не лечить CSS parser |
| `/api/status` показывает `resolver:false` | Контейнер Resolver, сеть Compose, его `/ready` и storage |
| `unsupported_brand` | Доступность адаптера и флаги enabled; ручной URL — отдельный путь |
| `dns_failed`, `timeout`, `connection_failed` | DNS/egress именно среды Resolver |
| `http_403`, `access_challenge`, `http_429` | Ограничение upstream; не обходить защиту и не кэшировать как not_found |
| `js_shell`, `spec_fields_not_found`, `labels_unrecognized` | Получен ли содержательный документ, layout/labels/charset |
| `ambiguous`, `identity_mismatch` | Источник модели, trim и года; пользовательское подтверждение |
| `resolved` + partial/unknown | Качество извлечения; полезные поля можно предложить на review |

Успешный браузер на ноутбуке не доказывает, что серверный transport на VPS видит тот же ответ. Доступный `api.github.com` также не доказывает достижимость `github.com:443`: разные сетевые назначения проверяются отдельно.

## Inspector и trace

Админский `POST /api/admin/resolver/inspect` использует тот же pipeline, показывает raw/normalized/unknown, warnings, источник и время, но не создаёт пользовательский preview. `/api/admin/resolver/diagnostics` проксирует token-protected `/internal/diagnostics`.

NDJSON события содержат ограниченные поля: имя события, elapsed, hostname, counts, strategy, enum reason. App proxy валидирует строки и ограничивает поток. Не добавляйте HTML, headers, stack trace, приватный IP или полный URL с query в публичный progress.

Диагностика последних успехов/ошибок живёт с момента старта процесса и очищается при рестарте. Это не долговременная система метрик.

## Проверка на VPS

```bash
cd /opt/stacks/cola
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 bike-resolver
curl --fail --max-time 10 https://colabike.ru/api/status
curl --fail --max-time 10 https://colabike.ru/api/versions
```

`/api/versions` агрегирует версии app и Resolver; у самого Resolver endpoint — `/version`. HTTP `/ready` подтверждает storage readiness, а не точность комплектации и не доступность внешнего магазина.

Для локальной диагностики URL из **source checkout сервиса с dev dependencies**:

```bash
cd services/bike-resolver
npm ci
node --import tsx scripts/diagnose.ts 'https://manufacturer.example/product'
```

Адрес — placeholder. Скрипт использует safe transport и показывает признаки получения/разбора. Не предполагайте наличие `tsx`, исходников и diagnose.ts внутри минимального production image. Для проверки реальной контейнерной сети используйте inspector работающего приложения или отдельно подготовленную среду диагностики с теми же условиями egress.

## Cache и повторная проверка

Настройки TTL действуют на новые записи. Очистка persistent cache и перезапуск процесса — разные действия: in-memory discovery может пережить первое, а photo IDs не переживают второе. Ручной URL не должен скрывать проблему за старым успешным результатом. После рестарта повторите поиск фотографий, а не используйте старый opaque ID.

При добавлении регрессии сохраните источник, дату, минимальный fixture, входную идентичность, ожидаемые raw/normalized поля и отдельный статус live-получения. Не прикладывайте секреты и весь production лог. Подробнее: [источники](sources.md), [мониторинг приложения](../operations/monitoring.md).
