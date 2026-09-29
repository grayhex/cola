# Docker build и измерения

[CI/CD](ci-cd.md) · [Выкладка](deployment.md)

Web `runner` получает только dependency graph из Next standalone. Слой зависимостей
формируется перед изменяемыми `.next`/static/public. Сравнение digest этого слоя
после source-only изменения проверяет его повторное использование. Нужный серверу
tracing не заменяется вручную составленным списком npm-пакетов.

Target `ops` не зависит от Next build и содержит migrations/bootstrap/set-admin/
reset-password/audit/cleanup с полным production dependency graph. Этот набор оставлен
там ради совместимости операторских команд; web больше не несёт его целиком.
В Compose `migrate` — единственный build producer ops; `chat-sync` и `activity-sync` используют
его локальный project-scoped image с `pull_policy: never`. Дублирующего export
для workers нет. Бюджет VPS и процедура повторной выкладки описаны в [runbook](deployment.md#незавершённый-deploy-и-повторный-запуск).
Входные SQL и `public` копируются после компиляции. Docker web build hash включает
app/lib; миграции идентифицируются историей `schema_migrations`. Генерация MapLibre
worker/shared и двух Rive WASM вынесена в отдельный stage из locked dependencies.
CI сравнивает выдаваемые web bytes с пакетами ops и проверяет startup validator.

`.next/cache` — cache mount BuildKit, а не immutable RUN layer. На VPS постоянный
builder может его переиспользовать. GHA layer cache не переносит содержимое mount;
новый hosted runner компилирует с пустым compiler cache. Отдельный backend не вводится.
`load: true` остаётся для web, ops и Resolver в operations: все три запускаются
в disposable drill. Benchmark экспортирует OCI для измерения слоёв без load/push.

## Воспроизводимое сравнение

Workflow `Docker build measurements` запускается для PR с изменениями упаковки и
вручную с baseline ref. Baseline берётся из фактического base SHA PR, candidate —
из проверяемого merge SHA, каждый вариант на отдельном одинаковом hosted runner.
Скрипт `scripts/benchmark-docker.py` создаёт временный worktree и новый BuildKit daemon
для каждого прогона, поэтому warm означает реальный импорт GHA, а не оставшийся
локальный layer cache. Образы не запускаются и не публикуются.

Пять сценариев: cold+cache export; source-only+read/write cache; повтор той же ветки;
другая source-only правка с read-only cache; изменение public asset. Scope уникален
для workflow attempt и не перезаписывает рабочий cache. Артефакты содержат wall time,
compressed/uncompressed layer sizes, digest/command слоя, raw BuildKit progress и
время cache export и объём новых layer blobs. Размеры blobs берутся из GitHub cache
inventory по digest событий BuildKit `writing layer`; index и HTTP overhead не входят.
Bootstrap builder и decompression
для анализа находятся вне измеряемого интервала. Метрики не являются hard gate по
секундам или мегабайтам; обязательные тесты остаются в основном CI.

Результаты отдельных запусков хранятся в artifacts workflow и обсуждениях PR. Для текущего изменения снимайте новое парное измерение: прежние секунды, размеры и digest не являются бюджетом новой сборки.

## Политика CI cache

Web и ops читают GHA `cola-app`/`cola-ops`. `main` записывает `mode=max`, обычный PR
только читает: новая правка не оплачивает экспорт кеша ветки без явной необходимости. Для длинной ветки можно добавить PR label `ci:build-cache`:
следующий запуск CI будет также записывать кеш ветки. Это полезно при частых повторах
одной ревизии, но при изменении исходников export снова требует времени и места.
Label необязателен, настройки репозитория для стандартного пути менять не требуется.
GitHub ограничивает видимость кеша текущей/base/default ветками; cache PR не становится
кешем `main`. Resolver сохраняет прежнюю отдельную политику и scope.
