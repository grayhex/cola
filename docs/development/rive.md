# Графика hero и архив Rive

После #270 главная использует статичное фоновое изображение, без stage,
Rive/canvas и отдельного поиска. В «Админка → Дизайн → Внешний вид» поле
«Фоновое изображение hero» сохраняет `heroBackgroundImageId`. Оно принимает
только растровые PNG/JPEG/WebP, загрузчик переводит их в WebP. Hero запрашивает
варианты 640/1280 px, использует responsive preload и `fetchPriority="high"`;
прочие фото главной загружаются лениво. Без изображения остаётся тёмный фон.

Миграция `046_home_redesign` назначает существующий raster asset с именем
`new_hero1.png`, если новое поле ещё не задано. Явное значение, включая null,
сохраняется. Если файла в медиатеке нет, его можно загрузить/выбрать в админке.
Стандартные старые тексты заменяются новыми отдельно; пользовательские сохраняются.

Прежние поля `heroAnimationsEnabled`, `heroTitleAnimation`, `heroStageAnimation`,
`heroStageDarkAnimation`, `heroImageId`, `heroStageImageId` сохраняются для
совместимости настроек и защиты назначенных файлов от удаления, но больше
не исполняются главной. Старые home-only компоненты и их CSS удалены.
Экспорт Rive, исходники, серверная проверка загружаемых файлов и атрибуция
сохранены. Наличие runtime в public не означает его загрузку браузером.

## Assets, авторы и экспорт

| Файл                          | Происхождение                                                                                                                                                                                           | Контракт                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `riding-bike.source.riv`      | [Riding Bike](https://rive.app/marketplace/2008-3976-riding-bike/), rahiqueo, revision 3976                                                                                                             | artboard `sapiens.svg`, timeline `Animation 1`; state machine нет |
| `transparent-bike.source.riv` | [Transparent Bike Animation](https://rive.app/marketplace/9084-17312-transparent-bike-animation/), lorins, revision 17312; remix [Bike Icon](https://rive.app/marketplace/3256-6872-bike-icon/), JcToon | artboard `New Artboard`, timelines `Bike` + `SpeedEffectOn`       |

Обе страницы указывают [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
проверено 27.09.2026. Эти сцены больше не показываются ни одним экраном сайта (главная v2 их не
запрашивает), поэтому из подвала удалены и подпись «Авторы графики», и блок
«Лицензии графики» (#366). Если встроенная сцена вернётся в интерфейс, её
атрибуция с ссылками и описанием изменений должна появиться в блоке «Лицензии»
страницы «О проекте». Оригинальные runtime exports сохранены в
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

Закреплённые Rive packages сохраняются для воспроизводимого экспорта и
проверок файлов. React-компонента `rive-canvas.tsx` после #270 больше нет;
клиентский граф импортов главной не включает Rive runtime. После #293 общий декоративный renderer `planning-rive.tsx` использует тот же pinned runtime только для явно открытого planning dialog с назначенным Rive asset. Reduced motion оставляет статичный fallback без JS/WASM; закрытие освобождает canvas.

`pnpm dev/build` копируют **оба** WASM файла из закреплённого npm package в
`public/rive/runtime/2.43.1/`. Docker builder выполняет тот же шаг и переносит
`public/` в runtime image. WASM не коммитится. Скрипт проверяет совпадение
версии с `lib/rive-assets.ts`; обновлять их вместе. Primary и fallback URL
локальные, Rive Asset CDN отключён. В источниках нет внешних file assets;
asset loader не разрешает незаявленную загрузку.

В `script-src` добавлено только `'wasm-unsafe-eval'`, необходимое для компиляции
WASM. `'unsafe-eval'` и `'unsafe-inline'` для JavaScript остаются запрещены;
nonce, strict-dynamic, connect-src и остальные ограничения сохранены. CSP-тесты
отдельно проверяют точные JavaScript-токены и разрешение WASM. Серверная
валидация загружаемых файлов сохранена. Главная больше не запускает Canvas2D.

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

Исторические размеры Rive до #270 (главная v2 эти файлы не запрашивает):

| Ресурс                                                  |     Raw bytes | Gzip-9 bytes (оценка) |
| ------------------------------------------------------- | ------------: | --------------------: |
| Отложенный JS runtime chunk                             |        193720 |                 52721 |
| WASM primary                                            |        882456 |                364845 |
| WASM compatibility fallback (только при отказе primary) |        885386 |                366016 |
| Riding Bike `.riv`, light / dark                        | 49560 / 49560 |         24794 / 24800 |
| Transparent Bike `.riv`, light / dark                   |   5108 / 5108 |           2577 / 2580 |
| Riding Bike PNG, light / dark                           | 72707 / 71862 |         71600 / 70586 |
| Transparent Bike PNG, light / dark                      |   8969 / 8548 |           7812 / 7390 |

Проверки статичной главной: `tests/e2e/static-hero.spec.js` (Light/Dark/System,
390/1920 px, preload без повторной загрузки, отсутствие `.riv`/WASM при старом
включённом флаге, поиск с клавиатуры), `community-design.spec.js` (геометрия,
axe, темы и reduced motion), `home-pulse.spec.js` (реальная авторизация и отзыв
видимости). Экспорт и валидация Rive остаются в unit/runtime-проверках.
