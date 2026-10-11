<p align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="Логотип ColaBike" />
</p>

<h1 align="center">ColaBike</h1>

<p align="center"><strong>Люди. Велосипеды. Истории.</strong></p>

<p align="center">
  Личный гараж и сообщество для тех, кто ездит, собирает и меняет свои велосипеды.
</p>

[Открыть сайт](https://colabike.ru) · [Android](https://github.com/grayhex/colabike-android) · [Документация](docs/README.md) · [План развития](https://github.com/grayhex/cola/issues/136)

[![CI](https://github.com/grayhex/cola/actions/workflows/check.yml/badge.svg)](https://github.com/grayhex/cola/actions/workflows/check.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](package.json)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](package.json)

[Возможности](#возможности) · [Быстрый старт](#быстрый-старт) · [Структура](#структура-репозитория) · [Разработка](#разработка) · [Эксплуатация](#эксплуатация)

## Возможности

Сохраните комплектацию, расскажите об опыте, найдите интересные сборки и запланируйте покатушку с компанией.

| Возможность             | Что внутри                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Гараж и витрина**     | Велосипеды, фотографии, заводская и текущая комплектация, вес, стоимость и пробег. Автозаполнение через Bike Resolver и ручной ввод. |
| **Каталог компонентов** | Детали и аксессуары, описания и фотографии, обсуждения, установки на велосипеды и связанные объявления.                              |
| **Журнал и статьи**     | Обслуживание, апгрейды и истории поездок. Подписки на авторов и велосипеды, комментарии, реакции и сохранённые записи.               |
| **Покатушки**           | Импорт GPX, TCX, FIT и Garmin CSV, маршрут и метрики. Планы поездок, приглашения и ответы участников.                                |
| **Хочу кататься**       | Свободные окна, район и формат поездки без создания мероприятия. Личные предпочтения и публичные намерения.                          |
| **Сообщество**          | Профили, уведомления, объявления, достижения, рекорды и велосипед недели. При включённом Stream Chat — личные сообщения и группы.    |

Главная знакомит с сообществом; полная витрина находится на [странице велосипедов](https://colabike.ru/bikes). Интерфейс поддерживает светлую и тёмную темы, мобильные экраны и уменьшение движения.

**Приватность — часть модели данных.** Сервер проверяет доступ при каждом чтении: знание ссылки не открывает скрытый велосипед, черновик или оригинал трека. Владелец управляет видимостью поездки, метрик и зон около старта и финиша.

> **Внешние сервисы необязательны.** Stream Chat, синхронизация Ride with GPS и вход через Яндекс ID требуют настройки оператором. Без них доступны основной сайт, вход по паролю и ручное заполнение велосипеда. Автоматической синхронизации Garmin/Strava и GPX Replay пока нет; импорт Garmin CSV работает.

## Быстрый старт

Нужны **Git, Docker и Docker Compose**. Node на хосте для этого способа не требуется.

```bash
git clone https://github.com/grayhex/cola.git
cd cola
if [ ! -e .env ]; then cp .env.example .env; fi
docker compose up --build -d --wait --wait-timeout 180
docker compose ps
```

Откройте `http://localhost:3000`. Новая установка создаёт схему без демонстрационных аккаунтов и велосипедов; база и файлы сохраняются в Docker volumes.

**Первый вход:** создайте администратора через CLI, войдите и опубликуйте соглашение и политику сайта. До этого регистрация закрыта. Команды и порядок действий — в [инструкции первого запуска](docs/development/getting-started.md#первый-администратор).

Локальный Compose публикует порт 3000 на всех интерфейсах. Для доступа с другого устройства задайте точный адрес в `APP_ORIGIN`. Обычный `docker compose down` сохраняет volumes; `down -v` удаляет данные.

## Структура репозитория

Приложение использует **Next.js 16, React 19 и PostgreSQL 17**. Весь production-код `app/`, `lib/` и `proxy.ts` — strict TypeScript/TSX; исключение — генерируемый модуль версии. Resolver — отдельный сервис на TypeScript, Fastify, Cheerio и Zod. Скрипты и конфигурация используют JS, Python и shell там, где это удобно. Точные версии — в [package.json](package.json), lock-файлах и [Dockerfile](Dockerfile).

| Путь                                                 | Назначение                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [`app/`](app/)                                       | Страницы Next, HTTP API, компоненты интерфейса и CSS                    |
| [`lib/`](lib/)                                       | Доменная логика, SQL, права доступа, DTO и интеграции                   |
| [`db/`](db/)                                         | Версионированные миграции приложения                                    |
| [`services/bike-resolver/`](services/bike-resolver/) | Поиск заводских спецификаций, парсинг и собственные тесты               |
| [`data/component-catalog/`](data/component-catalog/) | Проверенные пакеты наполнения каталога, описания и лицензированные фото |
| [`public/`](public/) · [`assets/`](assets/)          | Ресурсы интерфейса, локальные шрифты и исходники Rive                   |
| [`scripts/`](scripts/)                               | Сборка, миграции, обслуживание, тестовые harness и проверки             |
| [`ops/`](ops/)                                       | Nginx и серверные wrappers для выкладки                                 |
| [`tests/`](tests/)                                   | Unit, HTTP, браузерные тесты и изолированные fixtures                   |
| [`docs/`](docs/README.md)                            | Архитектура, продуктовые модули, разработка и эксплуатация              |
| [`.github/workflows/`](.github/workflows/)           | CI, сборка образов и автоматическая выкладка                            |

Compose запускает `app`, `db`, `bike-resolver` и пять workers: `chat-sync`, `activity-sync`, `notification-email`, `notification-push`, `bike-week`. Одноразовый `migrate` применяет схему перед стартом приложения и workers. Все workers используют общий образ `ops`; файлы и данные хранятся отдельно от образов. Подробнее — в [архитектуре](docs/architecture/overview.md).

## Android и API

Нативный клиент на Kotlin / Jetpack Compose развивается в **[grayhex/colabike-android](https://github.com/grayhex/colabike-android)**. Этот репозиторий отвечает за доменную логику, права доступа и [API v1](docs/modules/api-v1.md), включая сессии устройств по Bearer-токенам и [конфигурацию мобильного приложения](docs/modules/mobile-app.md).

Android хранит закреплённый OpenAPI snapshot и проверяет изменения контракта. Новые endpoints сначала реализуются здесь, затем подключаются в клиенте.

## Разработка

Для работы на хосте нужны **Node.js 24.x** и закреплённый **pnpm 11.19.0**. В корне используется pnpm, у Resolver — отдельный npm lockfile:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
(cd services/bike-resolver && npm ci)
```

Для `pnpm dev` нужна доступная с хоста БД, настроенное окружение и применённые миграции. Compose не публикует порт PostgreSQL на хост. Полная инструкция — в [руководстве разработчика](docs/development/getting-started.md#работа-с-исходниками).

| Задача                         | С чего начать                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Внести изменение               | [CONTRIBUTING.md](CONTRIBUTING.md), [принципы разработки](docs/development/principles.md), [AGENTS.md](AGENTS.md)                                         |
| Изменить интерфейс             | [Дизайн-система](docs/development/design-system.md), [UI](docs/development/ui.md), [Motion](docs/development/motion.md), [Rive](docs/development/rive.md) |
| Добавить источник спецификаций | [Архитектура Resolver](docs/resolver/architecture.md), [источники](docs/resolver/sources.md)                                                              |
| Проверить изменение            | [Команды и тестовые окружения](docs/development/testing.md)                                                                                               |

Начните с адресных проверок. CI выполняет проверки типов, unit и HTTP-тесты с PostgreSQL, Chromium и mobile WebKit, сборку Docker-образов и восстановление из backup. Тесты используют изолированные данные.

Локальные env-файлы, логи, build output и скриншоты прогонов остаются вне Git. Рабочая графика, лицензии и функциональные fixtures входят в исходники. Правила — в [руководстве по документации](docs/development/documentation.md#файлы-и-артефакты).

## Эксплуатация

[Развёртывание](docs/operations/deployment.md) · [CI/CD](docs/operations/ci-cd.md) · [Docker build](docs/operations/docker-build.md) · [Backup/restore](docs/operations/backup-restore.md) · [Мониторинг](docs/operations/monitoring.md)

Production использует [compose.prod.yaml](compose.prod.yaml), HTTPS и проверенный commit из `main`. После успешного CI выкладка получает готовые образы, собранные из того же commit. Изменения проходят через PR; merge и production deploy требуют разрешения владельца.

Для навигации по всем модулям — **[оглавление документации](docs/README.md)**. Приоритеты и предложения ведём в [issues](https://github.com/grayhex/cola/issues).
