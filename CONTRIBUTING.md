# Разработка ColaBike

Начните с [оглавления документации](docs/README.md).

Первый маршрут чтения: [локальный запуск](docs/development/getting-started.md) → [архитектура](docs/architecture/overview.md) → [принципы разработки](docs/development/principles.md) → [нужный модуль](docs/README.md#модули-приложения). Для парсера: [Resolver](docs/resolver/architecture.md) и [добавление источника](docs/resolver/sources.md).

Работайте в отдельной ветке от актуального main и открывайте PR. Укажите пользовательский результат, риски/совместимость, выполненные проверки и то, что ещё не проверено. Не мержите и не запускайте production deploy без разрешения владельца. Для предварительной демонстрации используйте согласованный [staging workflow](docs/operations/ci-cd.md).

Не коммитьте secrets, production env, реальные приватные GPX и выгрузки базы. Изменения workflow, Dockerfile, миграций и root-owned wrappers требуют внимательного review: зелёный тест не является sandbox для недоверенного кода.

[Тестирование](docs/development/testing.md) · [Правила ведения документации](docs/development/documentation.md).
