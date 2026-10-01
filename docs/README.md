# Документация ColaBike

[О проекте и возможностях](../README.md) · [Участие в разработке](../CONTRIBUTING.md) · [Инструкции агентам](../AGENTS.md)

Руководство описывает код этой ветки. Наличие интеграции в коде не подтверждает её настройку на production; планы и приоритеты находятся в [issues](https://github.com/grayhex/cola/issues/136).

## С чего начать

- **Разработчику:** [первый запуск](development/getting-started.md) → [архитектура](architecture/overview.md) → [принципы](development/principles.md) → нужный модуль.
- **Для UI:** [дизайн-система](development/design-system.md) → [интерфейс](development/ui.md) → [Motion](development/motion.md) / [Rive](development/rive.md).
- **Оператору:** [развёртывание](operations/deployment.md) → [CI/CD](operations/ci-cd.md) → [backup/restore](operations/backup-restore.md) → [мониторинг](operations/monitoring.md).
- **Для Resolver:** [архитектура сервиса](resolver/architecture.md) → [источники](resolver/sources.md) → [диагностика](resolver/diagnostics.md).

## Архитектура и разработка

| Глава                                                  | Содержание                                              |
| ------------------------------------------------------ | ------------------------------------------------------- |
| [Обзор архитектуры](architecture/overview.md)          | Сервисы, потоки запросов и карта кода                   |
| [Данные и миграции](architecture/data-model.md)        | Сущности, транзакции, очереди и файлы                   |
| [Безопасность и приватность](architecture/security.md) | Сессии, DTO, медиа, SSRF и границы доверия              |
| [Первый запуск](development/getting-started.md)        | Compose, первый администратор, разработка на хосте      |
| [Принципы разработки](development/principles.md)       | Изменения API, схемы, доменной логики и UI              |
| [Тестирование](development/testing.md)                 | Команды, PostgreSQL, HTTP, браузеры и Docker drill      |
| [Дизайн-система](development/design-system.md)         | Референсы Hugging Face, токены, типографика, компоненты |
| [Интерфейс](development/ui.md)                         | Темы, редактор, SSR, формы и адаптивность               |
| [Motion и View Transitions](development/motion.md)     | Переходы, обратная связь, reduced motion и измерения    |
| [Графика hero и Rive](development/rive.md)             | Статичный hero, архив сцен, исходники и экспорт         |
| [Ведение документации](development/documentation.md)   | Структура, источники истины и правила актуализации      |

## Модули приложения

| Глава                                                             | Содержание                                          |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| [Велосипеды и витрина](modules/bikes.md)                          | Гараж, карточка, мастер, фотографии и комплектация  |
| [Классификация](modules/bike-classification.md)                   | Категории, независимые признаки и фильтры           |
| [Заводская комплектация](modules/factory-components.md)           | Нормализация, происхождение данных и пересборка     |
| [Каталог компонентов](modules/component-catalog-ui.md)            | Модель детали, установки, навигация и карточка      |
| [Поиск фотографий компонентов](modules/component-photo-search.md) | Источники, импорт, права и ограничения              |
| [Аккаунт и профиль](modules/accounts.md)                          | Регистрация, сессии, почта и кабинет                |
| [Документы и согласия](modules/legal-documents.md)                | Версии документов, публикация и регистрация         |
| [Сообщество](modules/community.md)                                | Подписки, друзья, реакции, обсуждения и уведомления |
| [Журнал](modules/journal.md)                                      | Записи, снимки компонентов, вопросы и сохранённое   |
| [Покатушки](modules/rides.md)                                     | Импорт, анализ, карты, приватность, планы и RSVP    |
| [Барахолка](modules/market.md)                                    | Объявления, фотографии и связи с каталогом          |
| [Награды и рекорды](modules/gamification.md)                      | Метрики, правила, пересчёт и иллюстрации            |
| [Поиск и опыт](modules/discovery.md)                              | Главная сообщества, поиск и страницы моделей        |
| [Администрирование](modules/administration.md)                    | Настройки, справочники, модерация и аудит           |
| [Настройка сайта](modules/site-customization.md)                  | Оформление и управляемое содержимое                 |
| [Навигация и «О проекте»](modules/navigation-about.md)            | Шапка, подвал и информационная страница             |
| [Публичные адреса](modules/public-urls.md)                        | Ссылки, перенаправления, Open Graph и индексация    |

## Resolver и интеграции

| Глава                                                   | Содержание                                      |
| ------------------------------------------------------- | ----------------------------------------------- |
| [Архитектура Resolver](resolver/architecture.md)        | Discovery, matching, extraction, API и cache    |
| [Источники и расширение](resolver/sources.md)           | Адаптеры, профили сайтов и регрессии            |
| [Диагностика Resolver](resolver/diagnostics.md)         | NDJSON, inspector, ошибки и CLI                 |
| [Stream Chat](integrations/chat.md)                     | Поиск людей, диалоги, группы, права и lifecycle |
| [Ride with GPS](integrations/activity-sync.md)          | OAuth, webhook, импорт, worker и отключение     |
| [Карты](integrations/maps.md)                           | MapLibre/OSM, Яндекс, ключи и fallback          |
| [Изображения контента](integrations/content-artwork.md) | Медиатека, фоны, иллюстрации и безопасные SVG   |

## Эксплуатация

| Глава                                          | Содержание                                            |
| ---------------------------------------------- | ----------------------------------------------------- |
| [Развёртывание](operations/deployment.md)      | Production Compose, HTTPS, env и операторские команды |
| [CI/CD](operations/ci-cd.md)                   | Проверки PR/main, SSH deploy и кеши                   |
| [Docker build](operations/docker-build.md)     | Устройство образов и воспроизводимые измерения        |
| [Backup/restore](operations/backup-restore.md) | Согласованная копия БД/файлов и восстановление        |
| [Мониторинг](operations/monitoring.md)         | Healthchecks, метрики, логи и диагностика             |

Порядок всех глав задан в [book.json](book.json). Исторические отчёты и прежние версии доступны в Git и PR; в руководстве сохраняются действующие процедуры.
