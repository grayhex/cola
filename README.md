# ColaBike

**Люди. Велосипеды. Истории.**

Личный гараж и сообщество для тех, кто ездит, собирает и меняет свои велосипеды.
Сохраните комплектацию, расскажите об опыте, найдите интересные сборки и запланируйте покатушку с компанией.

[Открыть ColaBike](https://colabike.ru) · [Android](https://github.com/grayhex/colabike-android) · [О проекте](https://colabike.ru/about) · [Документация](docs/README.md) · [План развития](https://github.com/grayhex/cola/issues/136)

[![CI](https://github.com/grayhex/cola/actions/workflows/check.yml/badge.svg)](https://github.com/grayhex/cola/actions/workflows/check.yml)

## Что уже умеет ColaBike

| Возможность                     | Что можно делать                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Личный гараж**                | Хранить велосипеды, фотографии, текущую и заводскую комплектацию, вес, размер, стоимость и пробег. Выбирать, чем делиться публично.                                    |
| **Автозаполнение сборки**       | Найти модель через Bike Resolver, проверить предложенную комплектацию и сохранить её. При необходимости заполнить всё вручную.                                         |
| **Каталог компонентов**         | Искать модели деталей, смотреть фотографии, обсуждения, установки на велосипеды и связанные объявления.                                                                |
| **Журнал и статьи**             | Писать об обслуживании, апгрейдах и поездках, задавать вопросы, публиковать статьи. Подписываться на авторов и велосипеды, сохранять записи.                           |
| **Покатушки**                   | Импортировать GPX, TCX, FIT и Garmin CSV, смотреть маршрут и графики метрик. Планировать поездки, приглашать участников и собирать ответы «Иду / Может быть / Не иду». |
| **Хочу кататься**               | Отметить свободные окна, район и формат поездки без создания мероприятия и велосипеда в гараже. Сохранить личные предпочтения или явно открыть намерение сообществу.   |
| **Синхронизация Ride with GPS** | Подключить аккаунт и импортировать свои велоактивности с обновлениями. Интеграция требует настройки оператором.                                                        |
| **Сообщество и сообщения**      | Обсуждать публикации, ставить реакции, получать уведомления. При включённом Stream Chat — находить собеседников, писать лично и создавать небольшие группы.            |
| **Рынок, награды и рекорды**    | Размещать объявления, связывать их с каталогом, следить за рекордами и достижениями по реальным данным.                                                                |

Главная знакомит с сообществом и популярными велосипедами; полная витрина находится на `/bikes`.
Светлая и тёмная темы используют общий дизайн-код в духе Hugging Face. Motion, View Transitions и Rive дополняют интерфейс с учётом настройки уменьшения движения.

Приватность проверяется сервером: скрытый велосипед, черновик или оригинал трека не становятся публичными из-за знания ссылки. Владелец управляет видимостью поездки, метрик и зон около старта и финиша.

> **Границы текущей версии.** Stream Chat и Ride with GPS по умолчанию выключены и требуют ключей и настройки. Импорт Garmin CSV уже работает; автоматической синхронизации Garmin/Strava, OAuth-входа в ColaBike и GPX Replay пока нет. Следующие шаги ведём в [issues](https://github.com/grayhex/cola/issues).

## Нативный Android-клиент

Отдельный репозиторий **[grayhex/colabike-android](https://github.com/grayhex/colabike-android)** содержит нативное приложение ColaBike для Android 17 на Kotlin / Jetpack Compose.

Android — не отдельный продуктовый backend: он использует этот репозиторий как **источник истины для доменной логики, прав доступа и API v1**.

```text
ColaBike Android
      │
      │ HTTPS / API v1 / Bearer
      ▼
grayhex/cola
      │
      ├─ PostgreSQL
      ├─ media
      ├─ notifications
      ├─ Stream Chat bridge
      └─ mobile app-config / admin
```

Контракт клиента публикуется через [API v1](docs/modules/api-v1.md), а Android хранит закреплённый OpenAPI snapshot и автоматически проверяет drift. Если мобильному сценарию не хватает endpoint, он сначала проектируется и реализуется здесь, затем подключается в Android.

[Android README](https://github.com/grayhex/colabike-android#readme) · [Android roadmap](https://github.com/grayhex/colabike-android/issues/2) · [Mobile Admin / app-config #338](https://github.com/grayhex/cola/issues/338)

## Запустить локально

Нужны Git, Docker и Docker Compose:

```bash
git clone https://github.com/grayhex/cola.git
cd cola
cp .env.example .env
docker compose up --build -d --wait --wait-timeout 180
```

Откройте **[localhost:3000](http://localhost:3000)**. Это новая локальная установка без демонстрационных пользователей и велосипедов. База и файлы сохраняются в Docker volumes.

На первом запуске создайте администратора через CLI и опубликуйте документы сайта — [пошаговая инструкция](docs/development/getting-started.md#первый-администратор). Если `.env` уже существует, сохраните его значения. Локальный Compose публикует порт 3000 на всех интерфейсах; для доступа с другого устройства задайте точный `APP_ORIGIN`.

Для работы с кодом на хосте нужны **Node.js 24.x и pnpm из `packageManager`**. У Resolver отдельный npm lockfile. Настройка БД, переменных окружения и команды — в [руководстве разработчика](docs/development/getting-started.md).

## Как устроен проект

Приложение на **Next.js 16 / React 19**, новый код — strict TypeScript/TSX. Существующий JavaScript с JSDoc сохраняет проверку типов и постепенно мигрирует по [#256](https://github.com/grayhex/cola/issues/256). **PostgreSQL 17** хранит данные и очереди фоновых задач. **Bike Resolver** — отдельный детерминированный сервис на TypeScript, Fastify, Cheerio и Zod. Точные версии закреплены в package/lock-файлах и Dockerfile.

| Каталог                                                       | Назначение                                       |
| ------------------------------------------------------------- | ------------------------------------------------ |
| [`app/`](app/)                                                | Страницы, HTTP API, интерфейс и CSS              |
| [`lib/`](lib/)                                                | Доменная логика, SQL, права доступа и интеграции |
| [`db/`](db/)                                                  | Миграции приложения                              |
| [`services/bike-resolver/`](services/bike-resolver/)          | Поиск и разбор заводских спецификаций            |
| [`public/`](public/) · [`assets/`](assets/)                   | Публичные ресурсы и исходники Rive               |
| [`scripts/`](scripts/) · [`ops/`](ops/)                       | Миграции, обслуживание, проверки и развёртывание |
| [`tests/`](tests/)                                            | Unit, HTTP и браузерные проверки                 |
| [`docs/`](docs/README.md)                                     | Устройство проекта, разработка и эксплуатация    |
| [Android client](https://github.com/grayhex/colabike-android) | Нативный Kotlin/Compose-клиент API v1            |

Compose запускает приложение, БД, Resolver и фоновые сервисы `chat-sync` / `activity-sync`. Одноразовый `migrate` применяет схему до старта приложения и workers. Фотографии и оригиналы треков хранятся в отдельных volumes; переписка и вложения чата — в Stream.

## Разработка и эксплуатация

- **Внести изменение:** [CONTRIBUTING.md](CONTRIBUTING.md) и короткий [AGENTS.md](AGENTS.md) для AI-агентов.
- **Изменить интерфейс:** [дизайн-система](docs/development/design-system.md), [UI](docs/development/ui.md), [Motion](docs/development/motion.md) и [Rive](docs/development/rive.md).
- **Проверить результат:** [команды и тестовые окружения](docs/development/testing.md). CI проверяет код, PostgreSQL/HTTP, Chromium и mobile WebKit, Docker-образы и восстановление из backup.
- **Поднять сервер:** [production](docs/operations/deployment.md), [CI/CD](docs/operations/ci-cd.md), [backup/restore](docs/operations/backup-restore.md) и [мониторинг](docs/operations/monitoring.md).

Production использует отдельный `compose.prod.yaml`, HTTPS и проверенный commit из `main`. Merge запускает CI и последующую автоматическую выкладку; изменения проходят через PR и review владельца.
