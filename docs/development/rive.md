# Rive на главной

Два встроенных велосипедиста: Riding Bike справа от поиска, Transparent Bike
слева от заголовка (#184–#187). На телефоне большая сцена скрыта, маленькая
остаётся видимой. Текст, поиск и ссылки не зависят от canvas.

В **Админка → Дизайн → Внешний вид** общий переключатель «Анимации главной
для всех посетителей» включает автоматическое воспроизведение. По умолчанию
он выключен: сохраняется прежний статический первый визит. Публичной кнопки
запуска больше нет. Изменение применяется на следующей загрузке страницы;
открытые вкладки не получают push-обновление настроек.

В каждой области независимо выбираются изображение (PNG/JPEG/WebP) и анимация
(встроенная сцена, загруженный `.riv` или безопасный SVG). Изображение служит
постером при отключении/ошибке анимации. У встроенных сцен есть собственные
постеры обеих тем; без изображения и анимации показывается нейтральный велосипед.
Для большой пользовательской сцены можно выбрать отдельный файл тёмной темы.
Встроенные сцены автоматически меняют палитру. Переключателя «своя/ColaBike» нет.

`heroAnimationsEnabled`, `heroTitleAnimation`, `heroStageAnimation`,
`heroStageDarkAnimation`, `heroImageId`, `heroStageImageId` хранятся в JSON
настроек. `getSite` однократно преобразует старые режимы/ID SVG при чтении;
сохранение записывает новый контракт. SQL-миграция не нужна. Назначенные файлы
защищены от удаления даже при выключенных анимациях и в несохранённом черновике.

Rive загружается только для видимой сцены при включённой администратором
анимации. Выход за viewport, скрытая вкладка, unmount и `prefers-reduced-motion`
освобождают canvas; возвращение запускает сцену с начала. Без JS, Canvas2D,
WASM или при ошибке chunk/asset остаётся постер. WebGL не требуется. Reduced
motion имеет приоритет над общим переключателем и выключает также SVG.

Загружаемые `.riv`: runtime export до 1 МиБ, проверяется бинарная сигнатура RIVE
и размер. Это не полный серверный разбор файла; ошибочный экспорт оставит постер
после отказа/таймаута runtime. Canvas lite поддерживает векторные сцены без
текста/аудио/внешних ресурсов; запускается стандартная timeline первого artboard,
настройка inputs state machine не предусмотрена. Для других эффектов используйте
самодостаточный SVG. SVG проходит существующую XML-санитизацию, внешние ссылки
и скрипты запрещены. Все загрузки доступны только администратору, файлы публичны.

## Assets, авторы и экспорт

| Файл                          | Происхождение                                                                                                                                                                                           | Контракт                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `riding-bike.source.riv`      | [Riding Bike](https://rive.app/marketplace/2008-3976-riding-bike/), rahiqueo, revision 3976                                                                                                             | artboard `sapiens.svg`, timeline `Animation 1`; state machine нет |
| `transparent-bike.source.riv` | [Transparent Bike Animation](https://rive.app/marketplace/9084-17312-transparent-bike-animation/), lorins, revision 17312; remix [Bike Icon](https://rive.app/marketplace/3256-6872-bike-icon/), JcToon | artboard `New Artboard`, timelines `Bike` + `SpeedEffectOn`       |

Обе страницы указывают [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
проверено 27.09.2026. Видимая атрибуция с ссылками и описанием изменений находится
справа в подвале рядом с версиями («Авторы графики»). Оригинальные runtime exports сохранены в
`assets/rive/`, вместе с SHA-256 и manifest. Это `.riv`, не резервные `.rev`
проекты редактора. Для переработки геометрии исходная marketplace-страница
остаётся источником; production и воспроизводимый цветовой экспорт редактора
или аккаунта Rive не требуют.

Изменения: красно-розовый заменён жёлтым ColaBike `#f3b51b`, вспомогательные
цвета — нейтральной шкалой сайта. Во второй сцене убрана исходная фиолетовая
подложка. Светлая и тёмная версии имеют разные контрастные детали; цвет кожи
в первой сцене сохранён. Это фиксированная палитра бренд-графики: изменение
акцента в админке меняет UI, а для новой палитры иллюстраций нужен экспорт.

У второго файла также есть `State Machine 1` с единственным числовым входом
`numRotation`. Он не задаёт idle/hover/active/success и в этом срезе не используется.
Пользователь выбрал эти конкретные assets; не выдумывать отсутствующие inputs
и не связывать бизнес-события с декоративными таймлайнами.

```sh
pnpm install --frozen-lockfile
pnpm rive:export
git diff -- public/rive
```

Экспорт полностью офлайн: `scripts/export-rive.js`, закреплённые
`@rive-app/canvas-advanced-lite` 2.43.1 и `@napi-rs/canvas` 1.0.9. PNG снимается
реальным Rive renderer с нулевого кадра, canvas освобождается после каждого
файла. Нет растровой перерисовки поверх анимации.

Manifest перечисляет проверенные смещения сериализованных цветов
SolidColor (18/37), GradientStop (19/38), KeyFrameColor (37/88), согласно
[официальной схеме runtime](https://github.com/rive-app/rive-runtime/tree/main/include/rive/generated).
Экспорт проверяет SHA всего исходника и прежнее значение каждого поля перед
изменением; не ищет произвольные совпадения байтов. Геометрия, таймлайны и
структура файла сохраняются. Замена исходника требует заново проверить manifest,
не просто обновить hash. Опубликованы две `.riv` и две PNG версии каждого asset.

## Runtime и CSP

React package `@rive-app/react-canvas-lite` 4.35.0 (проверен npm registry
27.09.2026) использует Canvas lite 2.43.1: без текста, аудио и WebGL. React 19
входит в peer range. Import находится в отдельном chunk `rive-canvas.jsx`,
смонтированном только при включённой настройке и видимости через IntersectionObserver. На остальных routes
runtime не загружается.

`pnpm dev/build` копируют **оба** WASM файла из закреплённого npm package в
`public/rive/runtime/2.43.1/`. Docker builder выполняет тот же шаг и переносит
`public/` в runtime image. WASM не коммитится. Скрипт проверяет совпадение
версии с `lib/rive-assets.js`; обновлять их вместе. Primary и fallback URL
локальные, Rive Asset CDN отключён. В источниках нет внешних file assets;
asset loader не разрешает незаявленную загрузку.

В `script-src` добавлено только `'wasm-unsafe-eval'`, необходимое для компиляции
WASM. `'unsafe-eval'` и `'unsafe-inline'` для JavaScript остаются запрещены;
nonce, strict-dynamic, connect-src и остальные ограничения сохранены. CSP-тесты
отдельно проверяют точные JavaScript-токены и разрешение WASM. Полная E2E матрица
работает с `CSP_MODE=enforce`, включая Canvas2D без WebGL и отсутствие CSP reports.

Источники API: [React](https://rive.app/docs/runtimes/react/react),
[self-hosted WASM](https://rive.app/docs/runtimes/web/preloading-wasm),
[MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src).

## Вес и проверки

Для #184–#192 исходный `origin/main` —
`d7bf690e33dbbfa2510c02bd40ca5c176e9c2d64`. Его Git tree
`d43402650998fbf1608fe1512b6ce1c776c2e51c` совпадает с проверенной сборкой #183:
главная 220563, витрина 248498 bytes gzip-9. После изменения: главная около
223 КБ, витрина около 250 КБ; точные результаты финальной сборки указаны в PR.
Измерение `scripts/measure-route-payload.js` учитывает eager scripts production
HTML, а не Web Vitals. Browser transfer budgets 220/250 КиБ сохранены.

Включение Rive администратором добавляет посетителям runtime/WASM/сцены из
таблицы ниже. Этот режим тяжелее статического; CI отдельно проверяет его
работоспособность и reduced motion. Нет таймера для обхода performance-проверки.

| Ресурс                                                  |     Raw bytes | Gzip-9 bytes (оценка) |
| ------------------------------------------------------- | ------------: | --------------------: |
| Отложенный JS runtime chunk                             |        193720 |                 52721 |
| WASM primary                                            |        882456 |                364845 |
| WASM compatibility fallback (только при отказе primary) |        885386 |                366016 |
| Riding Bike `.riv`, light / dark                        | 49560 / 49560 |         24794 / 24800 |
| Transparent Bike `.riv`, light / dark                   |   5108 / 5108 |           2577 / 2580 |
| Riding Bike PNG, light / dark                           | 72707 / 71862 |         71600 / 70586 |
| Transparent Bike PNG, light / dark                      |   8969 / 8548 |           7812 / 7390 |

Исторически до #171 hero использовал только маленький inline SVG. Размеры пользовательских
SVG из production БД неизвестны и не подменяются этими числами. Теперь обе PNG
темы могут загружаться браузером; фактический transfer зависит от viewport и
HTTP-сжатия. При запуске нужны один общий runtime/WASM и только видимые `.riv`
текущей темы. Gzip таблица — оценка, не обещание серверного Content-Encoding.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
CSP_MODE=enforce node scripts/test-ui.js tests/e2e/rive-hero.spec.js --project=chromium
CSP_MODE=enforce node scripts/test-ui.js tests/e2e/rive-hero.spec.js --project=webkit-mobile
```

E2E проверяет обе темы, реальные изменяющиеся пиксели, палитру, стабильность
поискового блока, отсутствие ранних/внешних загрузок, mobile/offscreen cleanup,
reduced motion и отказы canvas/WASM/asset/runtime. Существующий тест custom SVG
сохраняет проверки обеих тем и назначает SVG в новых полях.

Приёмка: в админке включить и выключить общий запуск, загрузить изображение
и Rive/SVG, проверить главную на desktop/mobile в обеих темах, сменить reduced
motion при воспроизведении. Проверить поиск, атрибуцию в подвале и сохранение
изображения при ошибке анимации. Production-доступ, секреты и аккаунт Rive
не нужны; deploy и production smoke выполняет владелец после приёмки.
