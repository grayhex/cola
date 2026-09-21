# Bike Resolver

Дополнительный детерминированный сервис заводской комплектации ColaBike: TypeScript, Fastify, Cheerio, Zod и PostgreSQL. Браузер обращается к нему через API приложения; порт сервиса не публикуется наружу. Ручной ввод в приложении не должен зависеть от доступности Resolver.

## Документация

Основная документация теперь входит в общий комплект ColaBike:

- [Архитектура, API и поток данных](../../docs/resolver/architecture.md).
- [Источники, адаптеры и стратегии извлечения](../../docs/resolver/sources.md).
- [Inspector, ошибки, cache и diagnose](../../docs/resolver/diagnostics.md).
- [Мастер создания и сохранение заводской комплектации](../../docs/modules/bikes.md).
- [Разработка и тесты](../../docs/development/testing.md).
- [CI/CD и установленные deploy wrappers](../../docs/operations/ci-cd.md).

## Локальная работа

Из этого каталога:

```bash
npm ci
npm run typecheck
npm test
npm run build
# DATABASE_URL должен быть передан отдельно и указывать на тестовую БД.
npm start
```

Для запуска всего приложения используйте Compose из корня репозитория; см. [первый запуск](../../docs/development/getting-started.md). Обычный Compose не публикует 8080/5432 на хост.

Тесты источников используют fixtures. Доступность адаптера в коде, его включение в настройках, успешный offline parsing и работа upstream из сети сервера — разные проверки. Текущие flags/limitations смотрите в `/v1/brands` и settings, не в исторической таблице брендов.

[Оглавление документации](../../docs/README.md).
