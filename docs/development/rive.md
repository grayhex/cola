# Rive на главной

Срез #171 после принятой motion-policy #167: два утверждённых владельцем
велосипедиста. Riding Bike расположен справа от поиска; Transparent Bike —
справа от заголовка. На телефоне большой stage остаётся скрыт по правилам
главной, маленький велосипедист виден. Текст, поиск и ссылки не зависят от canvas.

По умолчанию показываются локальные PNG первого кадра. «Оживить велосипеды»
загружает React runtime и запускает видимые сцены; «Остановить анимацию» возвращает
постеры и освобождает canvas. Выход за viewport, скрытая вкладка, unmount и
`prefers-reduced-motion` также освобождают экземпляры. Возвращение запускает
сцену с начала. Настройка reduced motion использует общий hook из `motion.jsx`.
Смена темы пересоздаёт только декоративную сцену с соответствующей палитрой.

Это осознанный запуск по запросу: runtime заметно больше оставшегося запаса
JS-бюджета главной. Нет таймера, который отложил бы загрузку до конца performance
теста. Без JS/reduced motion/Canvas2D/WASM либо при ошибке chunk/asset остаётся
постер. Неподдерживаемый WebGL не мешает выбранному Canvas2D renderer.

В админке «Дизайн → Главная страница → Графика главного блока» можно выбрать
«Свои изображения». Сохранённые `heroImageId`/SVG обеих тем остаются доступны;
режим по умолчанию `rive` использует выбранные владельцем assets. Новая настройка
не требует миграции БД. Возврат к своим изображениям — оперативный rollback.

## Assets, авторы и экспорт

| Файл                          | Происхождение                                                                                                                                                                                           | Контракт                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `riding-bike.source.riv`      | [Riding Bike](https://rive.app/marketplace/2008-3976-riding-bike/), rahiqueo, revision 3976                                                                                                             | artboard `sapiens.svg`, timeline `Animation 1`; state machine нет |
| `transparent-bike.source.riv` | [Transparent Bike Animation](https://rive.app/marketplace/9084-17312-transparent-bike-animation/), lorins, revision 17312; remix [Bike Icon](https://rive.app/marketplace/3256-6872-bike-icon/), JcToon | artboard `New Artboard`, timelines `Bike` + `SpeedEffectOn`       |

Обе страницы указывают [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
проверено 27.09.2026. Видимая атрибуция с ссылками и описанием изменений находится
под поиском («Авторы графики»). Оригинальные runtime exports сохранены в
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
смонтированном только после кнопки и IntersectionObserver. На остальных routes
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

Baseline — свежий `origin/main` `ea78d8073828d20769c46b51786898242ac93343`.
`scripts/measure-route-payload.js`, одинаковые fixtures, production build,
Node 24.19.0: eager JS главной **219511 → 220562 bytes gzip-9** (+1051 bytes).
Витрина **248474 → 248498 bytes**. Это server HTML/eager scripts, не Web Vitals;
фактические browser transfer budgets 220/250 KiB остаются прежними в CI.
Локальный warm TTFB главной: 23.2 → 25.6 ms; одиночные замеры не доказывают
регрессию или улучшение production latency.

| Ресурс                                                  |     Raw bytes | Gzip-9 bytes (оценка) |
| ------------------------------------------------------- | ------------: | --------------------: |
| Отложенный JS runtime chunk                             |        193673 |                 52705 |
| WASM primary                                            |        882456 |                364845 |
| WASM compatibility fallback (только при отказе primary) |        885386 |                366016 |
| Riding Bike `.riv`, light / dark                        | 49560 / 49560 |         24794 / 24800 |
| Transparent Bike `.riv`, light / dark                   |   5108 / 5108 |           2577 / 2580 |
| Riding Bike PNG, light / dark                           | 72707 / 71862 |         71600 / 70586 |
| Transparent Bike PNG, light / dark                      |   8969 / 8548 |           7812 / 7390 |

В baseline дефолтный hero не содержал внешней большой иллюстрации, а маленький
значок был inline SVG (0 дополнительных запросов). Размеры пользовательских
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
сохраняет все проверки обеих тем и явно выбирает новый режим `custom`.

Приёмка: открыть главную в обеих темах на desktop/mobile, запустить и остановить
велосипеды, сменить тему и reduced motion при воспроизведении; проверить поиск
и режим своих изображений в админке. CI результаты и ограничения среды — в PR.
Production-доступ, секреты и настройки Rive не нужны; deploy и production smoke
выполняет владелец после приёмки.
