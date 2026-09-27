# Motion policy

Первый срез #167 использует React View Transitions и Motion 13.4.4 на текущих
React 19.3.0 / Next.js 16.3.6. Версия Motion проверена через npm registry
27.09.2026, peer dependencies включают React 19. Обновление React/Next или
экспериментальный `viewTransition` flag не требуются.

## Границы

- `SharedView` в `app/ui/motion.jsx`: фото карточки велосипеда → основное фото,
  заголовок карточки журнала → заголовок записи, заголовок и SVG-превью
  покатушки → detail. Имена включают вид сущности и её ID; не назначать одно
  имя нескольким экземплярам на одной странице.
- Ссылки используют штатный `next/link`. Нет перехвата кликов, таймеров перед
  навигацией, собственного history/router или ручного `startViewTransition`.
  Back/forward и scroll restoration остаются у Next и существующего showcase
  scroll helper. В зависимости от браузера back через `popstate` может пройти
  без эффекта: корректное восстановление контекста важнее анимации.
- `MotionList` плавно обновляет результат фильтра/журнал через React
  `startTransition`. Карточки сохраняют ключи и независимые очереди лайков.
  Старый результат не очищается ради эффекта. Ошибки и loading status
  появляются сразу; анимация не означает успешное сохранение.
  Первичная загрузка витрины и данные кабинета остаются синхронными с
  loading state: восстановление scroll ждёт реальную высоту списка,
  а открытая форма не перемонтируется после отложенного обновления.
- `useMotionFeedback` лениво импортирует `motion/mini` для изменения лайка,
  сохранения записи и открытия меню. Двигается значок, а не hit target.
  Реальный ответ API/optimistic queue не зависит от animation promise.
  Поздняя (>200 ms) или неудачная загрузка chunk просто пропускает эффект.
- Карты: общий элемент — только SVG-превью с публичной geometry. Ссылки
  атрибуции остаются отдельно от ссылки открытия покатушки. Detail может
  отдать SVG на сервере и в первом commit клиентской навигации; оболочка карты
  доступна вместе со страницей, сам MapLibre/canvas по-прежнему загружается
  лениво. Для Yandex без подходящей пары остаётся переход заголовка.
  React сопоставляет только видимые элементы: заголовок за пределами viewport
  не должен искусственно прокручиваться ради эффекта.
  WebGL canvas не захватывается как shared element, приватные точки не добавляются.
- Корневой layout остаётся Server Component. Нет глобальной анимации страницы,
  переноса header или изменения дизайна. Rive, Replay и PWA вне этого среза.

## Общие правила

Использовать уже существующие tokens в `app/styles/tokens.css`:
`--duration-fast: 150ms` для feedback/exit, `--duration: 200ms` для раскрытия
и смены содержимого, `--duration-slow: 300ms` для shared geometry;
`--ease-out` для завершения движения. Motion читает эти значения из CSS.
Новые эффекты не должны вводить второй набор длительностей.

`prefers-reduced-motion` отслеживается и при изменении настройки на открытой
странице. Shared names/анимации отключаются, текущий Motion effect отменяется,
исходные inline styles восстанавливаются. Дополнительное CSS-правило обнуляет
длительности view-transition pseudo-elements, которых не покрывает обычный
`*::before`/`*::after` reset. Отсутствие browser API оставляет обычную навигацию.

Меню сохраняют Escape, возврат фокуса и native Tab; существующие dialog/sheet
используют те же tokens и reduced-motion reset. Не удерживать закрывающийся
dialog ради exit-анимации: закрытие и освобождение фокуса должны быть немедленными.
View-transition overlay не перехватывает pointer events; интерактивные кнопки
не получают shared names. Первичный SSR-контент никогда не скрывается
до скачивания библиотеки или завершения анимации.

## Проверки и воспроизводимый замер

`tests/e2e/motion.spec.js` проверяет реальные API-данные, нативные shared pairs,
навигацию без перезагрузки, back/forward/scroll, keyboard focus, обе темы,
превью без tiles, сохранение/лайк, reduced motion и отказ загрузки Motion.
Существующие gallery concurrency/rollback, a11y и bundle budgets остаются обязательными.

Локальная проверка после `pnpm build`:

```sh
node scripts/test-ui.js tests/e2e/motion.spec.js --project=chromium
node scripts/test-ui.js tests/e2e/motion.spec.js --project=webkit-mobile
```

Для одинаковой локальной production-сборки с одноразовой БД и одинаковыми
публичными bike/journal/ride fixtures:

```sh
TEST_ORIGIN=http://localhost:3100 node scripts/measure-route-payload.js \
  / /bikes /journal /rides /b/<handle> /j/<handle> /r/<handle>
```

Probe прогревает каждый route, снимает медиану TTFB пяти запросов и сумму
gzip-9 размеров уникальных eager JS из server HTML. Это сравнение SSR/первой
поставки JS, **не** замер INP/LCP или всех post-hydration chunks; browser
transfer budgets проверяются отдельно в CI. Не запускать против production.

Baseline — `main` `aed393b`, Node 24.19.0, без параллельных unit tests во время
замера. Повторный замер после исправлений CI 27.09.2026 (KiB = 1024 bytes):

| Маршрут       | Eager JS до, KiB | После, KiB | TTFB до, ms | После, ms |
| ------------- | ---------------: | ---------: | ----------: | --------: |
| `/`           |           213.44 |     214.37 |        22.6 |      24.8 |
| `/bikes`      |           241.80 |     242.64 |        21.3 |      19.9 |
| `/journal`    |           229.00 |     230.05 |        14.9 |      15.3 |
| `/rides`      |           209.88 |     210.68 |        15.5 |      13.6 |
| `/b/<handle>` |           241.80 |     242.64 |        26.8 |      31.5 |
| `/j/<handle>` |           212.28 |     213.03 |        26.3 |      26.8 |
| `/r/<handle>` |           213.96 |     217.85 |        31.3 |      32.8 |

Прирост eager JS менее 1.1 KiB на шести маршрутах и 3.89 KiB на detail
покатушки, где SVG-оболочка карты теперь доступна в первом commit. Отдельный Motion chunk —
5370 bytes gzip-9 (13 318 bytes raw), загружается при взаимодействии.
Небольшие колебания TTFB одноразовой PGlite БД не доказывают изменение
production latency. Браузерные результаты/окончательный SHA — в PR к #167;
после изменения сборки переснимать замер.

## Источники API

- [React ViewTransition](https://react.dev/reference/react/ViewTransition)
- [Next.js View Transitions](https://nextjs.org/docs/app/guides/view-transitions)
- [Motion animate, mini entry](https://motion.dev/docs/animate)
