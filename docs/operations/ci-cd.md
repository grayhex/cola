# CI/CD и production по SSH

[Оглавление](../README.md)

## Workflows

| Workflow                                                                                  | Событие                                         | Результат                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `CI · ColaBike` / [check.yml](../../.github/workflows/check.yml)                          | PR, push в main, manual/reusable                | Проверенный commit, без deploy                                       |
| `Deploy · Production` / [deploy.yml](../../.github/workflows/deploy.yml)                  | Успешный CI push в main или ручной recheck main | GitHub-hosted job → SSH → VPS, environment `production`              |
| `CI · Closed PR cleanup` / [ci-pr-cleanup.yml](../../.github/workflows/ci-pr-cleanup.yml) | Закрытие PR                                     | Отмена его оставшегося CI без ложного check                          |
| `CodeQL` / [codeql.yml](../../.github/workflows/codeql.yml)                               | PR и push в main, раз в неделю                  | Находки статического анализа безопасности в Security → Code scanning |

[Docker build measurements](../../.github/workflows/docker-benchmark.yml) запускает отдельные измерения для изменений упаковки и вручную; методика — [Docker build](docker-build.md).

Модель: feature/PR → локальные проверки и CI → review/merge → CI итогового main → production по SSH. Feature-ветка не отправляется на production обычным workflow. `Run workflow` из старого commit не обновляет workflow задним числом.

## Проверки и кеши

`prepare` один раз фиксирует SHA. Далее параллельны Application/Resolver/HTTP (форматирование, lint, typecheck production и тестов, unit, build и HTTP), **четыре браузерных шарда** (Chromium 1/2 и 2/2, WebKit mobile 1/2 и 2/2), сводка шардов и Docker/backup. Каждый шард — отдельный runner с собственными PostgreSQL, базой, app, Resolver fixture, activity worker и каталогами данных, внутри один worker (тесты меняют глобальные настройки сайта, поэтому общая база или больше workers недопустимы). Тесты проекта режет сам Playwright (`--shard=I/N` через `COLA_CI_PLAYWRIGHT_SHARD` в [harness](../../scripts/test-resolver-integration.js); запуск и повтор шарда локально — в [тестировании](../development/testing.md#шарды-браузерных-тестов-386)). В матрице нет `max-parallel`, поэтому все четыре шарда стартуют вместе; `fail-fast: false` сохранён.

Задание `Browser shards · summary` скачивает доказательства всех шардов (manifest и JSON-отчёт каждого) и проверяет, что шардов ровно по два на проект, что вместе они дают весь список без потерь и повторов, что у каждого теста есть результат и ни один не упал и не был повторён; пишет в job summary таблицу по шардам, десять самых долгих тестов и файлов и время каждого задания по частям (очередь, подготовка, тесты, артефакты). `check` требует `success` от `prepare`, Application/Resolver/HTTP, всех шардов, сводки и Docker/backup, не трактует skip/cancel как успех: потерянный, красный или недостающий шард не делает CI зелёным. Изменения приложения, схемы, зависимостей и runtime-упаковки проходят полный набор; проверки не отключаются ради ускорения.

pnpm store кешируется по платформе, Node и lock/workspace-файлам; npm download cache Resolver — по его `package-lock.json`. Кеш не заменяет установку с зафиксированным lock. Docker использует отдельные BuildKit layer caches для web, ops и Resolver. Operations собирает три конечных образа один раз, затем передаёт их в drill без повторной сборки. Локальный drill без готовых образов собирает их сам.

Явные входы Docker исключают документацию, отчёты, тесты, локальные данные и кеши. Изменение Markdown не меняет слой исходников приложения. В runner остаётся только startup validator и Next standalone. Миграции и обслуживание находятся в target `ops`; host-side backup/restore и тестовые harness-файлы остаются в checkout. Проверки drill подаются в контейнер через stdin, а не встраиваются в production-образ.

Drill проверяет чистую установку без демонстрационного контента, повтор миграций, сохранение исторической записи выведенной версии, запуск non-root и readiness, доступность операторских зависимостей, MapLibre worker и файловые права. Затем выполняет обычное восстановление БД, фото, аватаров и GPX в отдельный Compose project, проверяет отказ перезаписать БД и выявление повреждённого backup.

Новый commit отменяет предыдущий автоматический CI того же PR/main. Разные PR и ручные/reusable проверки не должны отменять друг друга. Deploy сериализован своей concurrency group с `cancel-in-progress:false` и серверным lock. Переименование CI требует синхронно обновить production trigger и cleanup concurrency key.

Сборка не должна выдавать предупреждений Turbopack «Dynamic filesystem access causes tracing of the whole project». Пути к данным, которые задаются при запуске (`UPLOAD_DIR`, `RIDES_DIR`, `MEDIA_CACHE_DIR`), помечаются `/*turbopackIgnore: true*/` в `path.resolve`/`path.join` и в вызове `fs`, иначе в standalone-вывод попадает весь проект. Фактические размеры и состав слоёв проверяет [Docker benchmark](docker-build.md); исторические числа не являются текущим baseline.

Dependabot ([dependabot.yml](../../.github/dependabot.yml)) раз в месяц предлагает обновления npm для приложения и Resolver, GitHub Actions и базовых Docker-образов, по одному PR на экосистему. Каждый PR проходит весь CI (около получаса работы раннеров), поэтому мажорные версии npm и образа `node` автоматически не предлагаются: их берут вручную, прочитав changelog. Закреплены осознанно: `eslint-plugin-react-hooks` на 7.1.1 (совместим с ESLint 10; прежний 5.x такой peer не поддерживал), `@types/node` на мажоре Node.js в образах (24), образ `node` на LTS-линии (нечётные мажоры не LTS; в Node 25 нет `corepack`), `marked` на мажоре, который требует `@tiptap/markdown` (иначе в бандле две копии). `@types/node` в корне нужен проверке типов, но pnpm привязывает его к необязательному peer у `sharp`, поэтому в production-установку попадают два пакета деклараций (`@types/node` и `undici-types`, около 3 МБ). Код они не меняют. Строгая проверка peer dependencies включена в `pnpm-workspace.yaml`; wildcard-зависимость `@types/pg` разрешается в те же Node 24 types, что и корень. Hooks 7.x также добавляет Babel, который pnpm связывает с optional peer `styled-jsx` в production-графе; это цена совместимости с текущим ESLint, не причина отключать проверку peers.

CodeQL ([codeql.yml](../../.github/workflows/codeql.yml)) анализирует JavaScript и TypeScript приложения и Resolver без сборки. Тесты и их HTML-фикстуры исключены ([codeql-config.yml](../../.github/codeql/codeql-config.yml)): в них намеренные атакующие строки, тестовые пароли и сохранённые чужие страницы. Для публичного репозитория code scanning бесплатен. PR, который добавляет ошибку или уязвимость высокой либо критической важности, получает красную проверку `CodeQL` (порог по умолчанию, меняется в настройках code scanning). Уже существующие находки разбирают в Security → Code scanning: исправляют или закрывают с объяснением, почему это не уязвимость.

Browser artifacts разделены по проекту, шарду и attempt (`browser-review-<проект>-<I>of<N>-<attempt>`, `component-review-…`, `e2e-evidence-…`) и хранятся 7 дней; снимки каталога компонентов лежат только в `component-review`, остальное — в `browser-review`. Fixture/live-ограничения — в [тестировании](../development/testing.md). Успех прежнего feature-run не считается результатом итогового PR; недоступные проверки перечисляются явно. Ускорение и размеры образов публикуются только после измерения.

Скачивание образов CI использует публичное зеркало Docker Hub `mirror.gcr.io`:
PostgreSQL services получают образ непосредственно оттуда, bootstrap BuildKit —
через `driver-opts`, а Node и Dockerfile frontend — через настройку зеркала
BuildKit. Перед backup drill образ PostgreSQL из `compose.yaml` скачивается с
зеркала и получает исходный локальный тег; Compose и production используют
прежние версии и имена. Отдельный workflow Docker benchmark этой правкой не меняется.
Зеркало кеширует популярные публичные образы: при отсутствии образа BuildKit
может обратиться к Docker Hub, поэтому это не гарантия работы при любом отказе
реестра. Доступность новых тегов на зеркале нужно проверять при обновлении версий.

Ошибки `auth.docker.io/token: 504 Gateway Timeout`, `context deadline exceeded`
и `unauthenticated pull rate limit` на `Initialize containers` или загрузке
Dockerfile frontend означают сбой скачивания образов до запуска тестов.
Увеличение `timeout-minutes` тестов его не исправляет. Обычный `docker login` в
steps выполняется уже после создания services; если используется Docker Hub
с авторизацией, credentials нужно задавать также непосредственно у services.
После исправления доступа повторяют CI на нужном SHA; отсутствие тестовых
артефактов при таком отказе не считается успешной проверкой.

### Замеры ускорения полного CI (#386)

Сравнение до и после шардирования, время в минутах. «До» — три успешных прогона `CI · ColaBike` на том же дереве приложения ([37994198857](https://github.com/grayhex/cola/actions/runs/37994198857), [37997148989](https://github.com/grayhex/cola/actions/runs/37997148989), [37997294283](https://github.com/grayhex/cola/actions/runs/37997294283)); «после» — три успешных прогона одного коммита `4533518` ([38000466201](https://github.com/grayhex/cola/actions/runs/38000466201), [38000515948](https://github.com/grayhex/cola/actions/runs/38000515948), [38000518560](https://github.com/grayhex/cola/actions/runs/38000518560)): PR-прогон и два ручных `workflow_dispatch`, запущенные одновременно. Одновременный запуск мог чуть удлинить очередь, но она не больше 37 с. Размер артефактов — без образов для production.

| Показатель                                                                                                          | До, медиана (разброс) | После, медиана (разброс) |
| ------------------------------------------------------------------------------------------------------------------- | --------------------: | -----------------------: |
| Время от старта до `check`                                                                                          |      30,1 (25,1–31,2) |         15,9 (13,9–16,8) |
| Самое долгое браузерное задание                                                                                     |      29,8 (24,8–30,9) |         15,5 (13,4–16,4) |
| Разрыв между браузерными заданиями: Chromium и WebKit (до), самый долгий и самый короткий из четырёх шардов (после) |       11,0 (5,4–12,1) |            4,5 (2,5–6,5) |
| `Application, Resolver and HTTP`                                                                                    |       10,5 (8,2–12,4) |         11,8 (10,0–12,5) |
| Время раннеров, суммарно                                                                                            |      67,3 (61,3–69,0) |         69,9 (69,5–71,8) |
| Артефакты, МБ                                                                                                       |   264,5 (264,2–264,8) |      239,3 (238,3–239,4) |
| Самое долгое ожидание в очереди, с                                                                                  |                     2 |                     2–37 |

Выводы:

- Цель 14–16 минут достигнута по медиане (15,9), но у верхней границы: один из трёх прогонов уложился в 13,9, два других — в 16,0 и 16,8.
- Время раннеров не уменьшилось, а выросло на 4 % (67,3 → 69,9): тот же объём тестов теперь идёт на четырёх машинах, и у каждой своя подготовка (сборка, браузер и системные пакеты, 1,3–2 минуты). Ускорение — от параллельности, а не от меньшей работы; выигрыш от сокращённых повторов в `activity-sync`, `product-ui`, `static-hero` и `ride-passport` отдельно не измерен.
- Измеренное узкое место теперь — WebKit: его шарды 12,3–16,4 минуты (включая около двух минут подготовки), Chromium — 9,9–13,2; в каждом из трёх прогонов самое долгое задание — WebKit. Шарды Playwright режет по числу тестов, а не по времени, поэтому WebKit 1/2 обычно тяжелее соседа. Нижняя граница всего прогона — `Application, Resolver and HTTP` (10,0–12,5): быстрее неё `check` не станет, пока не ускорено и оно. Его разброс «до» (8,2–12,4) перекрывает «после»; задание теперь выполняет и HTTP-проверку паспорта заезда, перенесённую из браузерного набора.
- Артефакты меньше на 10 % (264,5 → 239,3); в этом же изменении убрана двойная выгрузка снимков каталога компонентов.
- Отказы при сборе замеров (запуски, не вошедшие в таблицу): два красных прогона из-за сбоев тестов, не связанных с шардированием (WebKit, `bike-discussion-panel`: клик по вкладке до гидратации страницы; потерянное из-за `socket hang up` восстановление настроек в `refinements.spec.js`, которое уронило ещё шесть тестов с картами), и три прогона (с одним перезапуском), остановленных лимитом скачивания Docker Hub до старта тестов. Автоматических повторов Playwright нет (`retries` не включены).

Это три наблюдения на hosted runners, а не гарантия верхней границы времени.

## Production

`deploy` из [deploy.yml](../../.github/workflows/deploy.yml) работает на `ubuntu-latest`, без runner на VPS. Автоматический путь принимает только успешный `CI · ColaBike` для события `push` в `main` этого репозитория. Ручной запуск доступен для `main` и сначала повторяет тот же CI через `verify-manual`. Operations после runtime/restore drill сохраняет те же три образа в `production-images-SHA-ATTEMPT` на 3 дня. Deploy-job скачивает исходный ZIP через GitHub API и передаёт его по SSH stdin вместе с `SHA prebuilt RUN_ID ATTEMPT`. На VPS нет повторной компиляции Next или установки зависимостей.

Бюджет deploy-job — 30 минут, скачивания — 5 минут, SSH-step — 22 минуты. Сервер
ждёт lock до 60 секунд, ограничивает проверку/приём/загрузку образов 14 минутами,
Compose — 5 минутами (healthchecks до 180 секунд). Истёкший или отсутствующий
artifact требует полного CI заново; fallback на сборку VPS отсутствует.
Причина изменения и действия после timeout описаны в
[runbook](deployment.md#незавершённый-deploy-и-повторный-запуск).

Job использует environment `production` и его secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_PORT` (если не задан — порт 22). Соединение идёт пользователем `deploy` с `StrictHostKeyChecking=yes`; значения секретов в репозитории не хранятся. Ограничение environment веткой `main` настраивается отдельно в GitHub. Установка и назначение каждого секрета — в [deployment](deployment.md#ssh-доступ-для-github-actions).

Оператор устанавливает [ops/deploy-cola-ssh](../../ops/deploy-cola-ssh), [ops/deploy-cola](../../ops/deploy-cola) и [ops/deploy-cola-images.py](../../ops/deploy-cola-images.py) в `/usr/local/sbin` с root ownership. Forced-command проверяет строгий формат SHA/run/attempt и вызывает единственную разрешённую sudo-команду `deploy-cola`. Git выполняется от владельца `/opt/stacks/cola`, Docker — wrapper от root. Нужны Python 3, исходящий HTTPS к публичному GitHub API и Docker amd64; дополнительный PAT, registry и новые secrets не нужны. Concurrency group `cola-production` сериализует выкладки; это имя группы, не label runner.

Wrapper fetch-ит main, требует точное равенство SHA текущему remote main, отказывается от tracked edits и проверяет Compose. По GitHub API сервер независимо проверяет repository, workflow, событие, SHA, attempt и успешный CI. Для ручной выкладки проверяется `verify-manual / check` того же attempt. Затем проверяются размер и SHA-256 всего ZIP из доверенных metadata GitHub; до этого Docker не вызывается. При ошибке API или несовпадении проверка закрывается отказом. Проверяются три image tag, revision label, платформа и image IDs; образы получают реальные project-scoped теги Compose. `up --no-build` выполняет миграции и healthchecks. При `.env.production` выбирается отдельный production file. Только после успеха сохраняется `/var/lib/colabike/verified-sha`.

После успешного prebuilt deploy wrapper удаляет временные SHA-теги `cola-ci-app:*`, `cola-ci-ops:*` и `cola-ci-resolver:*`, включая оставшиеся от предыдущих выкладок. Рабочие Compose aliases и контейнеры при этом сохраняются; удаление является best-effort и не превращает успешную выкладку в ошибку. Глобальные `docker system prune`, `image prune`, очистка volumes и BuildKit cache в CD намеренно не выполняются. Обычный prebuilt deploy на VPS не строит образы и новый build cache не создаёт; cache от legacy/operator `--build` обслуживается отдельно.

**`verified-sha` — журнал успешной выкладки, не свободный rollback target.** Старый SHA-only режим оставлен для совместимости установленного workflow и операторского bootstrap: он собирает на VPS с лимитом 35 минут и по-прежнему доверяет переданному workflow SHA. Запуск без аргумента берёт `verified-sha`, но требует совпадения с текущим main. Новый workflow всегда использует проверяемый prebuilt-режим. Автоматического rollback и атомарной выкладки без простоя нет.

## Обслуживание и ограничения

Merge файла `ops/...` **не обновляет установленную копию** в `/usr/local/sbin`. Перед включением prebuilt workflow оператор устанавливает все три файла из проверенного commit по [runbook](deployment.md#переход-на-готовые-образы-ci). Старая установленная версия отвергнет новый протокол сразу; она не начнёт долгую сборку. Пользователь `deploy` не должен иметь права менять wrappers.

Перед ручным вмешательством отмените или дождитесь активного deploy и согласуйте backup lock. Не используйте `git reset --hard` как обычное обновление: wrapper намеренно сохраняет tracked edits. Branch protection, review и secrets настраиваются отдельно от исходного кода.

Для восстановления используйте [backup runbook](backup-restore.md), для первого сервера — [deployment](deployment.md). Локальные и тестовые Compose-конфигурации сохраняются; они не участвуют в SSH-передаче production SHA.
