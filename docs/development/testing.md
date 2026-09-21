# Проверки и тестовые окружения

[Оглавление](../README.md)

## Команды

Выполняются из корня репозитория после установки обеих групп зависимостей:

```bash
pnpm test
pnpm build
(cd services/bike-resolver && npm run typecheck && npm test && npm run build)
pnpm test:integration
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
python3 scripts/test-compose.py
bash scripts/test-backup-drill.sh
```

Команды — перечень уровней, не требование запускать тяжёлый полный drill после каждой правки текста. CI проверяет полный набор согласно [workflow](../../.github/workflows/check.yml). Узкую регрессию сначала запускайте адресно: `node --test tests/map-settings.test.js` или нужный Resolver fixture.

Для UI без изменений Resolver после production build можно запустить `node scripts/test-ui.js`. Harness поднимает disposable PGlite и Next на 3100, выполняет `gallery-interactions.spec.js` в Chromium и завершает процессы. Браузер должен быть установлен Playwright. Можно передать другие spec-файлы, `--project` и обычные параметры Playwright. Пример: `node scripts/test-ui.js tests/e2e/design.spec.js tests/e2e/navigation.spec.js tests/e2e/garage-polish.spec.js tests/e2e/gallery-interactions.spec.js`. Ни production БД, ни внешний парсер не используются. Unit-регрессии очереди реакций, URL и контраста: `node --test tests/gallery-interactions.test.js`.

Опциональный `COMMUNITY_ARTWORK_DIR` указывает на локальную папку с `bike-1.webp`…`bike-3.webp` для визуального сравнения с реальными публичными ресурсами. Без него тесты создают нейтральные локальные изображения. Это входные данные теста, не новая система управления графикой сайта.

## Что означает каждый уровень

| Уровень | Что доказывает | Чего не доказывает |
| --- | --- | --- |
| `tests/*.test.js` | Чистые функции, схемы, доменная логика, PGlite-сценарии | Работу production сети и реальную конкуренцию PostgreSQL |
| Resolver `npm test` | Matching, extraction, transport checks, fixtures, cache | Текущую доступность каждого производителя |
| `pnpm build` | Сборку Next и границы импорта | Успешную миграцию production БД |
| `pnpm test:integration` | HTTP, auth/Origin/DTO, цепочку app → fixture Resolver | Доступность публичного upstream |
| Playwright | Реальный UI и взаимодействия Chromium/WebKit mobile | Все особенности физического iPhone и реальных загруженных изображений |
| Compose + backup drill | Runtime-упаковку, disposable backup/restore | Наличие операторского off-host backup и его расписания |

## База и изоляция

[Integration harness](../../scripts/test-resolver-integration.js) создаёт собственные временные БД/каталоги и запускает fixture Resolver. При `TEST_DATABASE_URL` используется отдельный PostgreSQL с правами создания тестовой БД. **Не передавайте production connection string.** Без этой переменной локальный harness может использовать одно соединение disposable PGlite; concurrency-тесты требуют настоящий PostgreSQL.

Браузерные тесты меняют настройки сайта, поэтому `workers:1` и отсутствие внутреннего fullyParallel — часть изоляции. CI распараллеливает браузеры по **разным** runners и БД, а не по общей базе. Артефакты разных браузеров/attempt имеют разные имена.

Backup drill создаёт собственные Compose projects и удаляет только их. Это не команда для проверки восстановления поверх рабочего проекта `cola`.

## Минимальная матрица новой функции

Проверьте гостя, владельца, другого участника и заблокированного пользователя; для админского API — отсутствие роли и неверный Origin. Проверьте public → private, удаление родителя, повторный запрос, неправильный ID, пустой результат и сбой зависимости. Для файлов добавьте размер/формат, квоту, rollback/cleanup и запрет прямого доступа после скрытия.

Для карт тестируйте mock SDK и отсутствие лишних запросов, отдельно принимайте настоящую карту на разрешённом домене. Для достижений — размеры больших/сломанных изображений, редактирование текста, legacy PUT, приватность лидера и защиту связанных assets от удаления.

## CI и отчётность

`prepare` фиксирует SHA; Application/Resolver/HTTP, Chromium, WebKit mobile и Docker/backup проходят независимо. Итоговый `check` требует успеха каждой группы. Детали отмены и deploy находятся в [CI/CD](../operations/ci-cd.md).

В PR разделяйте: выполнено локально; выполнено CI с номером запуска; проверено вручную; пока не проверено. Для документационного PR достаточно отдельно проверить ссылки/структуру и назвать состояние автоматического CI, не выдавая чтение кода за runtime-тест.
