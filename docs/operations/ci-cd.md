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

**`verified-sha` — журнал успешной выкладки, не свободный rollback target.** Старый SHA-only режим оставлен для совместимости установленного workflow и операторского bootstrap: он собирает на VPS с лимитом 35 минут и по-прежнему доверяет переданному workflow SHA. Запуск без аргумента берёт `verified-sha`, но требует совпадения с текущим main. Новый workflow всегда использует проверяемый prebuilt-режим. Автоматического rollback и атомарной выкладки без простоя нет.

## Обслуживание и ограничения

Merge файла `ops/...` **не обновляет установленную копию** в `/usr/local/sbin`. Перед включением prebuilt workflow оператор устанавливает все три файла из проверенного commit по [runbook](deployment.md#переход-на-готовые-образы-ci). Старая установленная версия отвергнет новый протокол сразу; она не начнёт долгую сборку. Пользователь `deploy` не должен иметь права менять wrappers.

Перед ручным вмешательством отмените или дождитесь активного deploy и согласуйте backup lock. Не используйте `git reset --hard` как обычное обновление: wrapper намеренно сохраняет tracked edits. Branch protection, review и secrets настраиваются отдельно от исходного кода.

Для восстановления используйте [backup runbook](backup-restore.md), для первого сервера — [deployment](deployment.md). Локальные и тестовые Compose-конфигурации сохраняются; они не участвуют в SSH-передаче production SHA.
