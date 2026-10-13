# Проверка дизайна: Impeccable

[Оглавление](../README.md) · [Дизайн-код](design-system.md) · [Тестирование](testing.md)

Impeccable — дополнительное ревью существующего UI. Первоисточник —
`app/styles/tokens.css`, [дизайн-код](design-system.md) и [UI](ui.md).
[PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md) и
`.impeccable/design.json` — производный контекст. Сначала исправляется
подтверждённый дефект или принимается решение, затем обновляются документы.
Баги и личные предпочтения scanner не становятся нормой.

## Установка

Закреплены skill/CLI **4.5.2**, engine **0.1.14** и официальный submodule
`d631a8827f99414d2b6daba4ef08b7f8701751d7` (тег `cli-v4.5.2` / `skill-v4.5.2`).
Лицензия — Apache-2.0, в submodule `LICENSE`. CLI хранится в отдельном
`tools/design-qa/package.json` и npm lockfile. Root pnpm, web/ops Docker,
production VDS и runtime-зависимости не меняются: Docker использует allowlist.

Из корня checkout, Node 24:

```bash
git submodule update --init .impeccable/vendor
npm ci --prefix tools/design-qa --ignore-scripts
node tools/design-qa/node_modules/impeccable/cli/bin/cli.js link --source=.impeccable/vendor --providers=codex,claude -y
node tools/design-qa/impeccable.mjs engine-probe
export IMPECCABLE_BIN="$(node tools/design-qa/impeccable.mjs --engine-path)"
```

Последняя переменная позволяет штатному skill launcher использовать
установленный и проверенный npm engine вместо загрузки в пользовательский
cache. Wrapper требует platform package из lockfile и не подменяет его
`latest`. Поддерживаются официальные platform packages; отсутствие подходящего
binary — ошибка установки, а не чистый scan.

`link` создаёт относительные `.agents/skills/impeccable` и
`.claude/skills/impeccable`, сохраняя прочие skills и настройки. Не использовать
`--force` для неизвестных существующих каталогов. Для Windows разрешить
Git symlinks до checkout; иначе проверить штатный project-install отдельно,
не считать текстовый файл symlink рабочим skill.

## Команды и границы проверки

В новом сеансе Codex вызвать `$impeccable audit <экран>`; в Claude Code —
`/impeccable audit <экран>`. `critique`, `adapt`, `polish`, `init` и `document`
— агентские playbooks, а не самостоятельные CLI-подкоманды. Их проверенные
описания лежат в `reference/` связанного skill. Первое `context` выполняется
один раз на сеанс. Применять playbooks к явной задаче, сохраняя исходный brief.

Механический detector доступен без LLM-сеанса:

```bash
node tools/design-qa/impeccable.mjs detect --json app/ > /tmp/cola-source-design.json
node tools/design-qa/impeccable.mjs detect --json --viewport 390x844 http://localhost:3100 > /tmp/cola-mobile-design.json
node tools/design-qa/impeccable.mjs detect --json --viewport 1440x900 http://localhost:3100 > /tmp/cola-desktop-design.json
```

Для URL нужен установленный Chromium/Chrome/Edge; при необходимости задать
`IMPECCABLE_BROWSER` на его executable. Страница должна реально работать
в локальной изолированной сборке. Не отключать проверку TLS для обхода
проблем среды. Нельзя передавать scanner приватные production-сессии.

Код `0` — scan выполнен без основных находок (advisory возможны); `2` —
scan выполнен, основные находки есть; `1` — хотя бы одна цель не просканирована.
JSON массива находок идёт в stdout, диагностика — stderr. Пустой JSON с кодом
`1` не означает отсутствие дефектов. Сохранять оба потока и код выхода.

Detector не заменяет Playwright/axe, анализ bounding boxes, функциональные
сценарии, бюджеты JS/изображений и реальную клавиатуру. Подтверждать находки
на нужных ширинах/темах; отделять согласованные решения и ложные срабатывания.
Не выключать массово правила ради нулевого счётчика.

Отдельный workflow `Design QA · report only` сканирует исходники при изменениях
UI/контекста и публикует JSON, stderr, код выхода и summary в artifact
`impeccable-source-report` (14 дней). Находки `2` сохраняются как данные;
ошибка `1` делает шаг красным, но необязательный job не блокирует merge.
Он не повторяет тяжёлые browser/e2e jobs и не является rendered-аудитом.

Локально проверены установка CLI из lockfile, provider symlinks и playbooks,
engine probe, source scan и обработка кодов `0`/`2`/`1`. Codex использует
проектный skill. Claude Code в текущей cloud-среде отсутствует: payload
установлен, но вызов в настоящем Claude-сеансе остаётся отдельной проверкой;
наличие файлов само по себе её не подтверждает.

## Hooks

Выбран **ручной/report-only режим**: `link` не устанавливает project hooks,
`PostToolUse` не считается активным и consent не коммитится. В #408 допускается
этот режим; проверка автоматического сообщения относится только к включённым
hooks. Обычная UI-правка сама по себе detector не запускает — выполнить команду
вручную в конце прохода.

Если позже принят режим hooks, отдельно проверить сценарий в каждом harness:
изучить scripts, `/impeccable hooks on`, доверие `/hooks` и feature hooks в
Codex, пробная UI-правка и фактическое сообщение detector. Наличие manifest
не доказывает исполнение. Настройки Claude, local consent, caches и логи
остаются локальными. Отключение — `/impeccable hooks off`; диагностика —
`/impeccable hooks status`. Не менять существующие чужие hooks.

## Обновление и отключение

Обновление — отдельный PR: проверить новый официальный commit, лицензию,
launcher и engine; явно обновить gitlink, CLI version и lockfile, повторить
`link`, probe, source/rendered scan и provider-проверки. Не запускать
`update`/`submodule update --remote` в CI: это выбирает непроверенную версию.
Не форматировать и не редактировать upstream payload; project scripts,
контекст и исключения проверяются обычными gates.

Для отключения убрать только две ссылки Impeccable из provider-каталогов;
остальные навыки и настройки сохранить. CLI можно оставить для ручного scan.

## Аудит и приёмка

Порядок #408: интеграция → baseline mobile/desktop → ограниченные исправления
по реестру → повторная проверка. До/после и JSON — artifacts, не изображения
в Git. Реестр указывает экран, тему/размер, шаги, причину, риск, P0/P1/P2 и
статус. Использовать синтетические fixtures и существующие проверки #399/#406.
Реальные iPhone/Android с клавиатурой остаются открытой ручной приёмкой,
если устройства недоступны. Merge/deploy требуют отдельного разрешения
владельца по #408.

Первичные инструкции: [Install](https://impeccable.style/tutorials/getting-started/),
[Hooks](https://impeccable.style/docs/hooks/), [Detector](https://impeccable.style/docs/detector/),
[Design system](https://impeccable.style/docs/design-system/). Проверенный
[официальный исходник 4.5.2](https://github.com/pbakaus/impeccable/tree/d631a8827f99414d2b6daba4ef08b7f8701751d7)
содержит CLI contract, provider payload и playbooks; при недоступности сайта
сверять поведение с ним и фактическим `--help` установленного engine.
