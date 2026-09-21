# Мониторинг и поиск неисправностей

[Оглавление](../README.md)

## Сигналы здоровья

| Endpoint | Смысл | Ограничение |
| --- | --- | --- |
| `/api/health` | Процесс приложения отвечает | Не подтверждает состояние БД |
| `/api/ready` | БД приложения доступна | Не проверяет производителей или SDK карт |
| `/api/status` | Отдельные `database` и `resolver` | `ok` связан с БД: HTTP 200 ещё не означает `resolver:true` |
| `/api/versions` | Версии приложения и Resolver | Не подтверждает успешный парсинг конкретной модели |
| Resolver `/ready` | Cache storage сервиса | Не end-to-end проверка внешнего upstream |

Внешний monitor использует HTTPS и проверяет нужные поля JSON. Внутренний healthcheck Compose и внешняя доступность DNS/TLS — разные наблюдения.

## Базовая диагностика VPS

```bash
cd /opt/stacks/cola
docker compose --env-file .env.production -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 app bike-resolver
curl --fail --max-time 10 https://colabike.ru/api/ready
curl --fail --max-time 10 https://colabike.ru/api/status
curl --fail --max-time 10 https://colabike.ru/api/versions
df -h /
free -h
docker system df
sudo ss -lntp
```

Сопоставляйте `X-Request-ID` ответа со структурированными логами. Перед отправкой вывода удалите секреты, email и пользовательские данные. Не включайте полную выдачу `nginx -T`, rendered Compose, тела GPX или заголовки авторизации в публичный issue.

## Типовые развилки

- **Новый код не появился:** проверьте конкретный CI SHA, deploy job, `/var/lib/colabike/verified-sha` и версии. Появление commit в main не означает завершённую выкладку. Установленный wrapper обновляется отдельно.
- **403 на сохранении:** сверяйте Origin браузера с APP_ORIGIN, роль/владельца и nginx limits. Не отключайте CSRF ради несовпадающего URL.
- **Сайт работает, Resolver нет:** смотрите его контейнер/ready и [diagnostics](../resolver/diagnostics.md). Ручное заполнение должно оставаться доступным.
- **Карты не загружаются:** проверьте provider/key/Referer/CSP и console/network браузера. Метрики GPX от подложки не зависят. См. [карты](../integrations/maps.md).
- **Git fetch висит:** сначала установите точный transport и hostname: HTTPS checkout и SSH alias — разные подключения. Используйте ограниченные таймауты, `getent`, `dig`, `curl --connect-timeout 10 --max-time 15`. Разные DNS-ответы сами по себе не доказывают поломку DNS. Не фиксируйте случайный IP GitHub навсегда в hosts и не отключайте TLS validation.
- **Контейнер не healthy после миграции:** не удаляйте volumes. Сохраните лог, проверьте schema_migrations, credentials, место и версию image. План восстановления — [backup/restore](backup-restore.md).

## Файлы, квоты и обслуживание

Квоты одного пользователя не ограничивают весь диск при росте числа аккаунтов; графика администратора также расходует место. Контролируйте данные, Docker build cache/images, логи, backup volume и память. `docker system prune --volumes` не является штатным лечением занятого диска.

Периодический cleanup GPX и journal outbox:

```bash
cd /opt/stacks/cola
docker compose --env-file .env.production -f compose.prod.yaml exec -T app node scripts/cleanup-rides.js
```

Для тихой установки настройте расписание от оператора отдельно. Учитывайте пересечение с backup/deploy и не создавайте неконтролируемый дополнительный писатель во время snapshot.

Аудит файлов фотографий запускается отдельно через [audit-photo-files.js](../../scripts/audit-photo-files.js). `--prune-orphans` — явная операция удаления, только после backup и проверки текущей версии. [recalculate-photo-storage.js](../../scripts/recalculate-photo-storage.js) по умолчанию показывает изменения; `--apply` записывает метаданные размеров. Не запускайте старый prune-код над новой схемой/типами файлов.

## Что оператор должен настроить сам

Оповещения о недоступности, диске, возрасте backup, TLS и провале deploy; проверку off-host копий; обновление системы/runner; защиту main и reviews; продление сертификата с reload nginx. Наличие этих глав или успешный CI не означает, что мониторинг уже включён на сервере.
