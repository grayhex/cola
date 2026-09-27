# Docker build и измерения (#194)

[CI/CD](ci-cd.md) · [Выкладка](deployment.md)

Web `runner` получает только dependency graph из Next standalone. Слой зависимостей
формируется перед изменяемыми `.next`/static/public. Сравнение digest этого слоя
после source-only изменения проверяет его повторное использование. Нужный серверу
tracing не заменяется вручную составленным списком npm-пакетов.

Target `ops` не зависит от Next build и содержит migrations/bootstrap/set-admin/
reset-password/audit/cleanup с полным production dependency graph. Этот набор оставлен
там ради совместимости операторских команд; web больше не несёт его целиком.
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
время/объём cache export, который сообщил BuildKit. Bootstrap builder и decompression
для анализа находятся вне измеряемого интервала. Метрики не являются hard gate по
секундам или мегабайтам; обязательные тесты остаются в основном CI.

Замеры и выбранная политика записи GHA будут зафиксированы после выполнения CI.
