# CI/CD и выбор окружения

[Оглавление](../README.md)

## Workflows

| Workflow | Событие | Результат |
| --- | --- | --- |
| `CI · ColaBike` / [check.yml](../../.github/workflows/check.yml) | PR, push в main, manual/reusable | Проверенный commit, без deploy |
| `Deploy · Staging` / [deploy-staging.yml](../../.github/workflows/deploy-staging.yml) | Ручной запуск из main с ref | Проверка SHA → VM с label `cola-staging` |
| `Deploy · Production` / [deploy.yml](../../.github/workflows/deploy.yml) | Успешный CI push в main или ручной recheck main | VPS с label `cola-production` |
| `CI · Closed PR cleanup` / [ci-pr-cleanup.yml](../../.github/workflows/ci-pr-cleanup.yml) | Закрытие PR | Отмена его оставшегося CI без ложного check |

Основная модель: feature/PR → тесты → при необходимости ручной staging → review/merge → CI итогового main → production. Ветка feature не отправляется на production обычным deploy workflow. `Run workflow` из старого commit не обновляет workflow задним числом.

## Проверки и отмена

`prepare` один раз фиксирует SHA. Далее параллельны Application/Resolver/HTTP, Chromium, WebKit mobile и Docker/backup. Браузеры имеют отдельные базы и runners, внутри каждого один worker. `check` требует `success` от всех обязательных групп, не трактует skip/cancel как успех.

Новый commit отменяет предыдущий автоматический CI того же PR/main. Разные PR и ручные/reusable проверки не должны отменять друг друга. Активный deploy сериализован своей concurrency group с `cancel-in-progress:false` и серверным lock. Переименование CI требует синхронно обновить имя в production trigger и cleanup concurrency key.

Browser artifacts разделены по проекту/attempt и хранятся 7 дней. Fixture/live-ограничения описаны в [тестировании](../development/testing.md). Уведомление о Node runtime action не означает смену версии Node приложения; версии `uses:` проверяйте в workflow и upstream release notes, не подавляйте warning вместо совместимого обновления.

## Production

[ops/deploy-cola](../../ops/deploy-cola) устанавливается оператором в `/usr/local/sbin/deploy-cola` с root ownership. Self-hosted job **не выполняет `actions/checkout` или setup-node**: передаёт `TARGET_SHA` wrapper. Git выполняется от владельца `/opt/stacks/cola` с его read-only SSH deploy key, Docker — wrapper от root.

Wrapper принимает 40-символьный SHA, fetch-ит main, требует точное равенство текущему remote main, отказывается от tracked edits, переключает checkout, проверяет Compose и ждёт healthchecks. При `.env.production` выбирает отдельный production file. После успеха сохраняет SHA в `/var/lib/colabike/verified-sha`; marker `[hagsy-demo]` вызывает специальную проверку внутри app container.

**`verified-sha` — журнал успешной выкладки, не свободный rollback target.** Запуск без аргумента берёт этот SHA, но всё равно требует совпадения с текущим main. Устаревший SHA завершается ошибкой; автоматического rollback и атомарной выкладки без простоя нет. Wrapper сам не получает attestation CI: доверенная передача SHA — ответственность workflow.

## Staging

[ops/deploy-cola-staging](../../ops/deploy-cola-staging) принимает проверенный SHA, fetch-ит его отдельно и берёт `compose.yaml` из текущего main в временный файл. Исходники выбранной ветки разворачиваются в локальную `staging-deploy`; записываются `staging-sha` и `staging-compose-main-sha`. Это позволяет тестировать feature-код без его Compose topology.

На VM нужен label `cola-staging`, на VPS — `cola-production`. Labels назначаются в GitHub для конкретного runner; это не пакеты, которые нужно установить на VM. Каждому runner разрешается только его wrapper через sudo; Docker group не требуется. Такая схема не является изоляцией от враждебного кода: см. [security](../architecture/security.md).

## Обслуживание и ограничения

Merge файла `ops/...` **не обновляет установленную копию** в `/usr/local/sbin`. После review оператор устанавливает её отдельно. Не давайте runner право устанавливать произвольный wrapper из собственного workspace.

Перед ручным вмешательством отмените/дождитесь активного deploy и согласуйте backup lock. Не используйте `git reset --hard` как обычное обновление: wrapper намеренно не уничтожает tracked edits. GitHub branch protection/review/секреты настраиваются отдельно; этот docs PR их не включает.

Для веток с чувствительными данными staging должен оставаться изолированным и без production secrets. Для восстановления используйте [backup runbook](backup-restore.md), для первого сервера — [deployment](deployment.md).
