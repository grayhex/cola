# Диагностика парсера

[Оглавление](../README.md)

## Начинайте с уровня отказа

| Наблюдение                                                  | Следующая проверка                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/api/ready` не готов                                       | База приложения; не лечить CSS parser                                  |
| `/api/status` показывает `resolver:false`                   | Контейнер Resolver, сеть Compose, его `/ready` и storage               |
| `unsupported_brand`                                         | Доступность адаптера и флаги enabled; ручной URL — отдельный путь      |
| `dns_failed`, `timeout`, `connection_failed`                | DNS/egress именно среды Resolver                                       |
| `http_403`, `access_challenge`, `http_429`                  | Ограничение upstream; не обходить защиту и не кэшировать как not_found |
| `js_shell`, `spec_fields_not_found`, `labels_unrecognized`  | Получен ли содержательный документ, layout/labels/charset              |
| `ambiguous`, `identity_mismatch`                            | Источник модели, trim и года; пользовательское подтверждение           |
| `not_complete_bike`                                         | Страница — рама, деталь или аксессуар; другой вариант или ручной ввод  |
| `multiple_builds`                                           | На странице несколько сборок, взята первая; выберите сборку из списка  |
| `candidate_expired`                                         | Рестарт или срок реестра кандидатов; повторить поиск и выбрать заново  |
| Магазин `blocked`, `timeout`, `unavailable` в отчёте поиска | Сеть именно Resolver; защиту сайта не обходить (см. ниже)              |
| `resolved` + partial/unknown                                | Качество извлечения; полезные поля можно предложить на review          |

Успешный браузер на ноутбуке не доказывает, что серверный transport на VPS видит тот же ответ. Доступный `api.github.com` также не доказывает достижимость `github.com:443`: разные сетевые назначения проверяются отдельно.

## Отчёт поиска по источникам

Ответ `ambiguous`, `not_found` и `upstream_unavailable` содержит `search.sources`: на каждый источник — `status` и `reason`. `ok` — страницы проверены, `empty` — подходящих страниц нет, `blocked` — `http_403`, `access_challenge`, `http_429` или адрес заблокирован настройками, `timeout` — бюджет источника исчерпан, `unavailable` — сеть или 5xx, `skipped` — у магазина нет поиска по каталогу, `disabled` — выключен флагом. Один недоступный источник не скрывает варианты других; пустая выдача при недоступных источниках — `upstream_unavailable`. `/internal/diagnostics` хранит по строке на источник (`store` — по id магазина, `archive`, `web`) с последним успехом/отказом и причиной с момента старта процесса.

Если магазин стабильно `blocked` из сети сервера, это ограничение сайта, а не ошибка парсера: не меняйте User-Agent, не используйте чужие cookies, прокси для обхода проверки и headless-браузер. Проверьте адрес в админском inspector и `scripts/diagnose.ts` из той же сети, при необходимости отключите магазин флагом, чтобы не тратить на него запросы, и укажите оператору сайта, что клиент — `ColaBikeResolver` с низкой частотой запросов. Успешный разбор записанной страницы не доказывает доступность сайта.

## Inspector и trace

Админский `POST /api/admin/resolver/inspect` использует тот же pipeline, показывает raw/normalized/unknown, warnings, источник и время, но не создаёт пользовательский preview. `/api/admin/resolver/diagnostics` проксирует token-protected `/internal/diagnostics`.

NDJSON события содержат ограниченные поля: имя события, elapsed, hostname, counts, strategy, enum reason. Проверка страниц вариантов идёт без событий; о каждом магазине сообщает одно `store_checked` (хост, найдено/проверено), об отказе — `source_failed` с причиной. Потолок потока — 240 событий на запрос. App proxy валидирует строки и ограничивает поток. Не добавляйте HTML, headers, stack trace, приватный IP или полный URL с query в публичный progress.

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

## Контрольный набор Reddit 10 и живой прогон

Записи и ожидания — `tests/fixtures/reddit10/` (см. [источники](sources.md)). Тот же набор на настоящих сайтах из сети, которую нужно проверить, даёт скрипт; он ничего не пишет в репозиторий:

```bash
cd services/bike-resolver
node --import tsx scripts/benchmark-reddit10.ts [--only N] [--stores all] [--twice] [--cancel MS] [--json FILE] [--record DIR]
```

Для каждого запроса — статус поиска, число вариантов, выбор страницы из манифеста и число извлечённых деталей, вставленная ссылка, число сетевых запросов, килобайты и время. `--twice` повторяет запросы («тёплое» время и запросы), `--cancel MS` до остального бросает поток первого запроса через MS и считает запросы, начатые после этого (должно быть 0), `--stores all` спрашивает и магазины, выключенные по умолчанию (у Alltricks и BIKE24 поиска нет — `skipped`), `--record DIR` сохраняет сырые ответы для новых записей. Уровень журнала сервиса по умолчанию `silent` (`LOG_LEVEL` управляет и журналом запросов Fastify).

Отчёт прогона датирован и относится к конкретной сети: в репозиторий он не коммитится, а попадает в описание PR или комментарий к задаче. Нерешённые случаи перечисляются, а не усредняются: ни «10 из 10», ни «успех» для `ambiguous` без выбора и разбора. Чтобы обновить записи, сохраните ответы `--record`, сократите их `capture-fixture.ts --raw FILE --origin FILE.json` и запишите, что ответил каждый путь: `REDDIT10_DUMP=файл.json npx vitest run tests/reddit10.test.ts`; расхождение с манифестом разбирается вручную, а не подгоняется.

## Cache и повторная проверка

Настройки TTL действуют на новые записи. Очистка persistent cache и перезапуск процесса — разные действия: in-memory discovery может пережить первое, а photo IDs не переживают второе. Ручной URL не должен скрывать проблему за старым успешным результатом. После рестарта повторите поиск фотографий, а не используйте старый opaque ID.

При добавлении регрессии сохраните источник, дату, минимальный fixture, входную идентичность, ожидаемые raw/normalized поля и отдельный статус live-получения. Не прикладывайте секреты и весь production лог. Подробнее: [источники](sources.md), [мониторинг приложения](../operations/monitoring.md).
