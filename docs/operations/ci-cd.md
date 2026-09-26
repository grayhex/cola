# CI/CD и production по SSH

[Оглавление](../README.md)

## Workflows

| Workflow | Событие | Результат |
| --- | --- | --- |
| `CI · ColaBike` / [check.yml](../../.github/workflows/check.yml) | PR, push в main, manual/reusable | Проверенный commit, без deploy |
| `Deploy · Production` / [deploy.yml](../../.github/workflows/deploy.yml) | Успешный CI push в main или ручной recheck main | GitHub-hosted job → SSH → VPS, environment `production` |
| `CI · Closed PR cleanup` / [ci-pr-cleanup.yml](../../.github/workflows/ci-pr-cleanup.yml) | Закрытие PR | Отмена его оставшегося CI без ложного check |
| `CodeQL` / [codeql.yml](../../.github/workflows/codeql.yml) | PR и push в main, раз в неделю | Находки статического анализа безопасности в Security → Code scanning |

Модель: feature/PR → локальные проверки и CI → review/merge → CI итогового main → production по SSH. Feature-ветка не отправляется на production обычным workflow. `Run workflow` из старого commit не обновляет workflow задним числом.

Staging выведен из эксплуатации 26.09.2026; workflow, скрипт и инструкции запуска удалены.

## Проверки и кеши

`prepare` один раз фиксирует SHA. Далее параллельны Application/Resolver/HTTP (первыми шагами — `pnpm lint` и `pnpm typecheck`), Chromium, WebKit mobile и Docker/backup. Браузеры имеют отдельные базы и runners, внутри каждого один worker. `check` требует `success` от всех обязательных групп, не трактует skip/cancel как успех. Изменения приложения, схемы, зависимостей и runtime-упаковки проходят полный набор; проверки не отключаются ради ускорения.

pnpm store кешируется по платформе, Node и lock/workspace-файлам; npm download cache Resolver — по его `package-lock.json`. Кеш не заменяет установку с зафиксированным lock. Docker использует отдельные BuildKit layer caches для приложения и Resolver. Operations собирает оба конечных образа один раз, затем передаёт их в drill без повторной сборки. Локальный drill без готовых образов собирает их сам.

Явные входы Docker исключают документацию, отчёты, тесты, локальные данные и кеши. Изменение Markdown не меняет слой исходников приложения. В runner копируются только команды запуска/миграций/обслуживания; host-side backup/restore и тестовые harness-файлы остаются в checkout. Проверки drill подаются в контейнер через stdin, а не встраиваются в production-образ.

Drill проверяет чистую установку без демонстрационного контента, повтор миграций, сохранение исторической записи выведенной версии, запуск non-root и readiness, доступность операторских зависимостей, MapLibre worker и файловые права. Затем выполняет обычное восстановление БД, фото, аватаров и GPX в отдельный Compose project, проверяет отказ перезаписать БД и выявление повреждённого backup.

Новый commit отменяет предыдущий автоматический CI того же PR/main. Разные PR и ручные/reusable проверки не должны отменять друг друга. Deploy сериализован своей concurrency group с `cancel-in-progress:false` и серверным lock. Переименование CI требует синхронно обновить production trigger и cleanup concurrency key.

Сборка не должна выдавать предупреждений Turbopack «Dynamic filesystem access causes tracing of the whole project». Пути к данным, которые задаются при запуске (`UPLOAD_DIR`, `RIDES_DIR`, `MEDIA_CACHE_DIR`), помечаются `/*turbopackIgnore: true*/` в `path.resolve`/`path.join` и в вызове `fs`, иначе в standalone-вывод попадает весь проект. Раньше, без `node_modules`, standalone занимал 33 МБ и 1461 файл, в Docker туда дублировались исходники и `public`; теперь это 13 МБ и 794 файла.

Dependabot ([dependabot.yml](../../.github/dependabot.yml)) раз в месяц предлагает обновления npm для приложения и Resolver, GitHub Actions и базовых Docker-образов, по одному PR на экосистему. Каждый PR проходит весь CI (около получаса работы раннеров), поэтому мажорные версии npm и образа `node` автоматически не предлагаются: их берут вручную, прочитав changelog. Закреплены осознанно: `eslint-plugin-react-hooks` на 5.x (7.x через `@babel/core` добавляет 37 пакетов в production-установку), `@types/node` на мажоре Node.js в образах (22), образ `node` на LTS-линии (нечётные мажоры не LTS; в Node 25 нет `corepack`), `marked` на мажоре, который требует `@tiptap/markdown` (иначе в бандле две копии). `@types/node` в корне нужен проверке типов, но pnpm привязывает его к необязательному peer у `sharp`, поэтому в production-установку попадают два пакета деклараций (`@types/node` и `undici-types`, около 3 МБ). Код они не меняют.

CodeQL ([codeql.yml](../../.github/workflows/codeql.yml)) анализирует JavaScript и TypeScript приложения и Resolver без сборки. Тесты и их HTML-фикстуры исключены ([codeql-config.yml](../../.github/codeql/codeql-config.yml)): в них намеренные атакующие строки, тестовые пароли и сохранённые чужие страницы. Для публичного репозитория code scanning бесплатен. PR, который добавляет ошибку или уязвимость высокой либо критической важности, получает красную проверку `CodeQL` (порог по умолчанию, меняется в настройках code scanning). Уже существующие находки разбирают в Security → Code scanning: исправляют или закрывают с объяснением, почему это не уязвимость.

Browser artifacts разделены по проекту/attempt и хранятся 7 дней. Fixture/live-ограничения — в [тестировании](../development/testing.md). Успех прежнего feature-run не считается результатом итогового PR; недоступные проверки перечисляются явно. Ускорение и размеры образов публикуются только после измерения.

## Production

`deploy` из [deploy.yml](../../.github/workflows/deploy.yml) работает на `ubuntu-latest`, без runner на VPS. Автоматический путь принимает только успешный `CI · ColaBike` для события `push` в `main` этого репозитория. Ручной запуск доступен для `main` и сначала повторяет тот же CI через `verify-manual`. Deploy-job сам не делает checkout или сборку: он передаёт `TARGET_SHA` по SSH.

Job использует environment `production` и его secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_PORT` (если не задан — порт 22). Соединение идёт пользователем `deploy` с `StrictHostKeyChecking=yes`; значения секретов в репозитории не хранятся. Ограничение environment веткой `main` настраивается отдельно в GitHub. Установка и назначение каждого секрета — в [deployment](deployment.md#ssh-доступ-для-github-actions).

Оператор устанавливает [ops/deploy-cola-ssh](../../ops/deploy-cola-ssh) и [ops/deploy-cola](../../ops/deploy-cola) в `/usr/local/sbin` с root ownership. Forced-command из `authorized_keys` проверяет полный SHA из `SSH_ORIGINAL_COMMAND` и вызывает `sudo -n /usr/local/sbin/deploy-cola`. Git выполняется от владельца `/opt/stacks/cola` с read-only SSH deploy key, сборка образов и Docker — wrapper от root на VPS. Concurrency group `cola-production` сериализует выкладки; это имя группы, не label runner.

Wrapper принимает 40-символьный SHA, fetch-ит main, требует точное равенство текущему remote main, отказывается от tracked edits, переключает checkout, проверяет Compose и ждёт healthchecks. При `.env.production` выбирает отдельный production file. После успеха сохраняет SHA в `/var/lib/colabike/verified-sha`. Специальных действий по созданию или проверке демонстрационных профилей нет.

**`verified-sha` — журнал успешной выкладки, не свободный rollback target.** Запуск без аргумента берёт этот SHA, но всё равно требует совпадения с текущим main. Устаревший SHA завершается ошибкой; автоматического rollback и атомарной выкладки без простоя нет. Wrapper сам не получает CI-attestation: доверенная передача SHA — ответственность workflow.

## Обслуживание и ограничения

Merge файла `ops/...` **не обновляет установленную копию** в `/usr/local/sbin`. Если содержимое wrapper изменилось, после review оператор устанавливает её отдельно. Пользователь `deploy` не должен иметь права менять wrappers. Перенос исходника `deploy-cola-ssh` в `ops/` не меняет его содержимое или установленный путь: сам по себе он не требует переустановки на VPS.

Перед ручным вмешательством отмените или дождитесь активного deploy и согласуйте backup lock. Не используйте `git reset --hard` как обычное обновление: wrapper намеренно сохраняет tracked edits. Branch protection, review и secrets настраиваются отдельно от исходного кода.

Для восстановления используйте [backup runbook](backup-restore.md), для первого сервера — [deployment](deployment.md). Локальные и тестовые Compose-конфигурации сохраняются; они не участвуют в SSH-передаче production SHA.
