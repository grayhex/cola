# CI/CD и выбор окружения

[Оглавление](../README.md)

## Workflows

| Workflow | Событие | Результат |
| --- | --- | --- |
| `CI · ColaBike` / [check.yml](../../.github/workflows/check.yml) | PR, push в main, manual/reusable | Проверенный commit, без deploy |
| `Deploy · Staging` / [deploy-staging.yml](../../.github/workflows/deploy-staging.yml) | Ручной запуск из main с ref | Проверка SHA → VM с label `cola-staging` |
| `Deploy · Production` / [deploy.yml](../../.github/workflows/deploy.yml) | Успешный CI push в main или ручной recheck main | VPS с label `cola-production` |
| `CI · Closed PR cleanup` / [ci-pr-cleanup.yml](../../.github/workflows/ci-pr-cleanup.yml) | Закрытие PR | Отмена его оставшегося CI без ложного check |

Модель: feature/PR → тесты → при необходимости ручной staging → review/merge → CI итогового main → production. Feature-ветка не отправляется на production обычным workflow. `Run workflow` из старого commit не обновляет workflow задним числом.

## Проверки и кеши

`prepare` один раз фиксирует SHA. Далее параллельны Application/Resolver/HTTP (первым шагом — `pnpm lint`), Chromium, WebKit mobile и Docker/backup. Браузеры имеют отдельные базы и runners, внутри каждого один worker. `check` требует `success` от всех обязательных групп, не трактует skip/cancel как успех. Изменения приложения, схемы, зависимостей и runtime-упаковки проходят полный набор; проверки не отключаются ради ускорения.

pnpm store кешируется по платформе, Node и lock/workspace-файлам; npm download cache Resolver — по его `package-lock.json`. Кеш не заменяет установку с зафиксированным lock. Docker использует отдельные BuildKit layer caches для приложения и Resolver. Operations собирает оба конечных образа один раз, затем передаёт их в drill без повторной сборки. Локальный drill без готовых образов собирает их сам.

Явные входы Docker исключают документацию, отчёты, тесты, локальные данные и кеши. Изменение Markdown не меняет слой исходников приложения. В runner копируются только команды запуска/миграций/обслуживания; host-side backup/restore и тестовые harness-файлы остаются в checkout. Проверки drill подаются в контейнер через stdin, а не встраиваются в production-образ.

Drill проверяет чистую установку без демонстрационного контента, повтор миграций, сохранение исторической записи выведенной версии, запуск non-root и readiness, доступность операторских зависимостей, MapLibre worker и файловые права. Затем выполняет обычное восстановление БД, фото, аватаров и GPX в отдельный Compose project, проверяет отказ перезаписать БД и выявление повреждённого backup.

Новый commit отменяет предыдущий автоматический CI того же PR/main. Разные PR и ручные/reusable проверки не должны отменять друг друга. Deploy сериализован своей concurrency group с `cancel-in-progress:false` и серверным lock. Переименование CI требует синхронно обновить production trigger и cleanup concurrency key.

Сборка не должна выдавать предупреждений Turbopack «Dynamic filesystem access causes tracing of the whole project». Пути к данным, которые задаются при запуске (`UPLOAD_DIR`, `RIDES_DIR`, `MEDIA_CACHE_DIR`), помечаются `/*turbopackIgnore: true*/` в `path.resolve`/`path.join` и в вызове `fs`, иначе в standalone-вывод попадает весь проект. Раньше, без `node_modules`, standalone занимал 33 МБ и 1461 файл, в Docker туда дублировались исходники и `public`; теперь это 13 МБ и 794 файла.

Dependabot ([dependabot.yml](../../.github/dependabot.yml)) раз в неделю предлагает обновления npm для приложения и Resolver, GitHub Actions и базовых Docker-образов. Минорные и патч-версии приходят одним PR на экосистему. CodeQL не подключён: для приватного репозитория загрузка результатов требует GitHub Advanced Security.

Browser artifacts разделены по проекту/attempt и хранятся 7 дней. Fixture/live-ограничения — в [тестировании](../development/testing.md). Успех прежнего feature-run не считается результатом итогового PR; недоступные проверки перечисляются явно. Ускорение и размеры образов публикуются только после измерения.

## Production

[ops/deploy-cola](../../ops/deploy-cola) устанавливается оператором в `/usr/local/sbin/deploy-cola` с root ownership. Self-hosted job **не выполняет `actions/checkout` или setup-node**: передаёт `TARGET_SHA` wrapper. Git выполняется от владельца `/opt/stacks/cola` с read-only SSH deploy key, Docker — wrapper от root.

Wrapper принимает 40-символьный SHA, fetch-ит main, требует точное равенство текущему remote main, отказывается от tracked edits, переключает checkout, проверяет Compose и ждёт healthchecks. При `.env.production` выбирает отдельный production file. После успеха сохраняет SHA в `/var/lib/colabike/verified-sha`. Специальных действий по созданию или проверке демонстрационных профилей нет.

**`verified-sha` — журнал успешной выкладки, не свободный rollback target.** Запуск без аргумента берёт этот SHA, но всё равно требует совпадения с текущим main. Устаревший SHA завершается ошибкой; автоматического rollback и атомарной выкладки без простоя нет. Wrapper сам не получает CI-attestation: доверенная передача SHA — ответственность workflow.

## Staging

[ops/deploy-cola-staging](../../ops/deploy-cola-staging) принимает проверенный SHA, fetch-ит его отдельно и берёт `compose.yaml` из текущего main во временный файл. Исходники выбранной ветки разворачиваются в локальную `staging-deploy`; записываются `staging-sha` и `staging-compose-main-sha`. Это позволяет проверять feature-код без его Compose topology.

На VM нужен label `cola-staging`, на VPS — `cola-production`. Labels назначаются в GitHub для конкретного runner; это не пакеты на VM. Каждому runner разрешается только его wrapper через sudo; Docker group не требуется. Это не изоляция от враждебного кода: см. [security](../architecture/security.md).

## Обслуживание и ограничения

Merge файла `ops/...` **не обновляет установленную копию** в `/usr/local/sbin`. После review оператор устанавливает её отдельно. Не давайте runner право устанавливать произвольный wrapper из workspace.

Перед ручным вмешательством отмените или дождитесь активного deploy и согласуйте backup lock. Не используйте `git reset --hard` как обычное обновление: wrapper намеренно сохраняет tracked edits. Branch protection, review и secrets настраиваются отдельно от исходного кода.

Staging с чувствительными данными должен оставаться изолированным и без production secrets. Для восстановления используйте [backup runbook](backup-restore.md), для первого сервера — [deployment](deployment.md).
