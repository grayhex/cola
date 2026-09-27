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
время cache export и объём новых layer blobs. Размеры blobs берутся из GitHub cache
inventory по digest событий BuildKit `writing layer`; index и HTTP overhead не входят.
Bootstrap builder и decompression
для анализа находятся вне измеряемого интервала. Метрики не являются hard gate по
секундам или мегабайтам; обязательные тесты остаются в основном CI.

## Результат 27 сентября 2026

[CI run 36321307186](https://github.com/grayhex/cola/actions/runs/36321307186):
baseline `ec7087535dd65ee5a2a3aad1429cdbac9bcc6829`, candidate merge
`40379c3588ec3075dc35918fe35987d3e00e1496` (head `6d56acf`).
Это единичный парный замер на hosted runners, не обещание длительности VPS deploy.
Cold означает пустой локальный builder и отсутствие cache import; удалённый GHA
backend может дедуплицировать уже известные blobs между scopes.

| Сценарий                                |  До, с | После, с |
| --------------------------------------- | -----: | -------: |
| Cold + запись кеша                      | 160.44 |    90.05 |
| Изменение JSX + чтение/запись кеша      | 118.78 |    58.55 |
| Повтор без изменений + чтение/запись    |  12.78 |     8.58 |
| Другое изменение JSX + только чтение    |  80.17 |    42.42 |
| Изменение только public + только чтение |  81.09 |    22.11 |

| Размер / cache export                       |     До |  После |
| ------------------------------------------- | -----: | -----: |
| Web OCI: сумма compressed layers, MiB       | 171.93 |  78.16 |
| Web: сумма uncompressed layer tar, MiB      | 635.17 | 231.70 |
| Runtime dependencies: compressed layer, MiB | 106.03 |  12.44 |
| Изменяемый build/cache blob, MiB            | 142.29 |  34.37 |
| Cold: новые GHA layer blobs, MiB            | 595.22 | 248.13 |
| Изменение JSX: новые GHA layer blobs, MiB   | 256.42 |  41.79 |
| Cold: GHA export, с                         |  99.04 |  51.39 |
| Изменение JSX: GHA export, с                |  38.89 |  15.91 |
| Точный повтор: GHA export, с                |   2.61 |   2.50 |

На точном повторе новых layer uploads нет. В read-only сценариях записи нет по
определению. В baseline runtime dependency step повторялся при изменении JSX/public;
теперь он `CACHED`, digest во всех пяти прогонах одинаков:
`sha256:7b3b4baf0e34da4ee7ff843c72f812889c50f9f2f838a77df994eee6822ae431`.
В public-only прогоне Next build также `CACHED`. Полный install layer остаётся
в build cache для компиляции, но не попадает в web image. Ops image собирается и
запускается отдельно в обязательном runtime/backup drill; таблица относится к web.

## Политика CI cache

Web и ops читают GHA `cola-app`/`cola-ops`. `main` записывает `mode=max`, обычный PR
только читает: при новой правке это убирает примерно 16 секунд export и 42 MiB новых
blobs в данном замере. Для длинной ветки можно добавить PR label `ci:build-cache`:
следующий запуск CI будет также записывать кеш ветки. Это полезно при частых повторах
одной ревизии (8.58 с), но обычная разработка меняет source и платит за export снова.
Label необязателен, настройки репозитория для стандартного пути менять не требуется.
GitHub ограничивает видимость кеша текущей/base/default ветками; cache PR не становится
кешем `main`. Resolver сохраняет прежнюю отдельную политику и scope.
