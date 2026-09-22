# Архитектура Bike Resolver

[Оглавление](../README.md)

## Назначение и граница

Bike Resolver — дополнительный детерминированный сервис восстановления заводской комплектации. Он не использует LLM или headless browser и не записывает `bikes`/`components`. Приложение владеет пользователем, preview, текущей сборкой и импортом; Resolver — поиском источника, извлечением, нормализацией, cache и схемой `bike_resolver`.

Браузер → авторизованный API приложения → [bike-resolver-client.js](../../lib/bike-resolver-client.js) / [resolver-proxy.js](../../lib/resolver-proxy.js) → внутренний Fastify. Порт 8080 не должен публиковаться наружу. Приложение продолжает работать вручную при отказе сервиса.

## Основные части

| Код | Роль |
| --- | --- |
| [app.ts](../../services/bike-resolver/src/app.ts), `buildApp` | HTTP-контракты, выбор режима, settings, поток результата |
| [planner.ts](../../services/bike-resolver/src/planner.ts), `SourcePlanner.resolve` | Ограниченный план поставщиков, без смешивания спецификаций |
| [resolver.ts](../../services/bike-resolver/src/resolver.ts), `Resolver.resolve` | Официальный adapter, cache, matching, получение/разбор |
| [adapters](../../services/bike-resolver/src/adapters) | Discovery производителя и правила страницы |
| [matcher.ts](../../services/bike-resolver/src/matcher.ts), `match`, `scoreCandidate` | Ранжирование и неоднозначность модели/trim/года |
| [http.ts](../../services/bike-resolver/src/http.ts), `ManufacturerHttpClient` | DNS/IP/redirect validation, pinning, очередь и ограничения |
| [extract.ts](../../services/bike-resolver/src/extract.ts), [normalize.ts](../../services/bike-resolver/src/normalize.ts) | Сбор фактов и общая нормализация компонентов |
| [manual.ts](../../services/bike-resolver/src/manual.ts), `ManualSources` | Ручной URL, product photos, временные photo IDs |
| [retailer-search.ts](../../services/bike-resolver/src/retailer-search.ts), `RetailerSearch.resolve` | Ограниченный поиск товарной страницы магазина |
| [cache.ts](../../services/bike-resolver/src/cache.ts), [settings.ts](../../services/bike-resolver/src/settings.ts) | Хранилища cache/settings, TTL и версии |
| [context.ts](../../services/bike-resolver/src/context.ts) | Request context, отмена, trace, версии результата/extractor |

## Поток данных

1. Вход `{brand, model, trim, year}` валидируется; `candidateId` — непрозрачный ID из предыдущей выдачи, не произвольный URL.
2. Выбирается официальный адаптер, discovery получает кандидатов, matching определяет однозначность. Запрошенный год не считается доказательством года страницы.
3. Safe HTTP client получает документ. Контент не исполняется: анализируются HTML и инертные структурированные данные.
4. Несколько ограниченных extraction-стратегий формируют raw fields; общий collector нормализует типы, сохраняет provenance, unknown и конфликты.
5. Возвращается один результат источника. Приложение показывает его пользователю и создаёт owner-bound preview; сохранение/импорт выполняется отдельно.

## Режимы HTTP

`POST /v1/resolve` сначала использует official flow; необязательный `sourceUrl` может быть fallback. Явный `/v1/resolve-url` и stream с `sourceUrl` идут сразу к указанной странице. Когда нет URL/candidate, включённый `retailerSearch` может искать товарные страницы после неуспеха официального пути. Это не неограниченный веб-поиск и не гарантированная поддержка любой марки.

`POST /v1/resolve/stream` возвращает NDJSON: строки `{type:"event",...}` и итоговый `{type:"result",result:...}`. UI показывает реальные события и количества, не выдуманный процент. Отмена должна распространяться через app proxy до ожидания DNS/очереди/fetch.

Дополнительно: `/v1/brands`, `/v1/photos/search`, `/v1/photos/:id`, `/health`, `/ready`, `/version`. `/internal/settings`, `/internal/cache`, `/internal/diagnostics` доступны через административный gateway; при production token они требуют Bearer. Остальные маршруты сервиса не являются заменой пользовательской авторизации приложения — изоляция сети обязательна.

## Результат и качество

Статусы: `resolved`, `ambiguous`, `not_found`, `unsupported_brand`, `upstream_unavailable`, `parse_error`. `quality.level=partial` может сопровождать `resolved`: это полезность извлечения, а не доказательство совпадения модели. В текущем extractor меньше трёх распознанных компонентов — parse error; complete требует минимум восьми и покрытия не ниже 65%. Год, confidence, warnings и unknown fields оцениваются отдельно.

У компонента сохраняются исходные label/value, URL, стратегия и confidence. SourceYear может быть null. Противоречивые значения не склеиваются в выдуманный компонент. Цена магазина не импортируется как цена покупки владельца. Подсказки веса/цвета применяются явно, с сохранением источника.

## Cache и ограничения

Ключ official cache включает нормализованную идентичность, candidate, adapter version и версии extractor/schema. Кэшируются `resolved` и действительный `not_found`, но не сетевой отказ как отсутствие модели. Ручные URL читаются заново. Непотоковые совпадающие обращения могут объединяться; stream-запросы имеют собственный cancellation context.

Часть discovery, photo IDs и диагностики process-local. Перезапуск уничтожает временные photo IDs; `/ready` проверяет cache storage, не доступность всех производителей. Для расширения: [источники](sources.md); для ошибок: [диагностика](diagnostics.md).

## Запрос без модельного года

`querySchema.year` допускает `null` и по умолчанию не подставляет текущий год. Поиск с неизвестным годом возвращает варианты и требует явного выбора; архивный URL с `null`/выдуманным годом не строится. Указанный год остаётся строгим ограничением, отдельная комплектация не смешивается с соседней. После извлечения `sourceYear` заполняется только из источника. Если владелец на последнем шаге указывает другой год, сервер требует `identityConfirmed`; исходный preview/factory-снимок сохраняет первоначальный запрос и происхождение. Смена марки/модели/комплектации инвалидирует preview. Регрессия: `tests/unknown-year.test.ts`.
