# Резервное копирование и восстановление

[Оглавление](../README.md)

## Что сохраняется

[scripts/backup.py](../../scripts/backup.py) и shell wrappers создают согласованный набор: `database.dump`, `photos.tar.gz`, `rides.tar.gz` и `manifest.json` с контрольными суммами. Полный dump включает public и данные Resolver в той же БД. Photos volume содержит фото байков, аватары, изображения журнала и графику сайта; rides — приватные GPX.

Текущий формат — v2, восстановление понимает и старый v1 без rides archive. Архив не содержит `.env.production`, SSH credentials, nginx/Certbot-конфигурацию или экспорт Docker-образа. Эти данные сохраняйте отдельно защищённым способом, вместе с информацией о commit/image и порядке восстановления. Не публикуйте backup: в нём приватные данные.

## Production backup

Запускайте от оператора с Docker-доступом. Укажите **тот же project/env/Compose**, что у работающей установки. Скрипт меняет каталог на корень своего checkout; абсолютные пути устраняют неоднозначность scheduler.

```bash
sudo env \
  COLA_COMPOSE_FILES=/opt/stacks/cola/compose.prod.yaml \
  COLA_ENV_FILE=/opt/stacks/cola/.env.production \
  python3 /opt/stacks/cola/scripts/backup.py backup \
  --destination /srv/colabike-backups --keep 7
```

Если работающий стек использует явный `COMPOSE_PROJECT_NAME`, передайте такое же значение через `sudo env`. Не угадывайте новое имя проекта. Для staging после feature deploy нужна topology, соответствующая использованной доверенной версии main; обычный `compose.yaml` выбранной feature-ветки может отличаться. Сохранённый `staging-compose-main-sha` помогает восстановить эту конфигурацию до backup.

`COLA_ENV_FILE` и `COLA_COMPOSE_FILES` переданы после sudo намеренно: экспорт в интерактивной сессии может быть очищен sudo. Обычный local Compose по умолчанию — **не production fallback**.

## Что происходит во время backup

Скрипт берёт общий `/var/lock/colabike-deploy.lock`, запоминает запущенные app/resolver, останавливает этих писателей, оставляет БД для `pg_dump` и архивирует volumes через текущий app image. Нужен ровно один app container для `volumes-from`. Другие внешние писатели должны быть остановлены оператором.

После проверки checksums временный приватный каталог публикуется атомарным переименованием. При ошибке частичный backup не считается успешным. Ранее работавшие сервисы возобновляются в finally. Retention удаляет только валидные каталоги собственного формата сверх `--keep`.

Это **плановый перерыв в записи/работе приложения**, а не online backup без простоя. Продолжительность зависит от объёма. Записанный manifest полезен, но не заменяет фактическое хранение нужного образа и исходников.

Проверка конкретного полученного каталога:

```bash
sudo python3 /opt/stacks/cola/scripts/backup.py verify \
  --backup /srv/colabike-backups/colabike-TIMESTAMP-ID
```

Замените путь на реально созданный. Успешный verify подтверждает формат и байты, не работоспособность восстановленного приложения. Копируйте успешные backups **за пределы VPS**, шифруйте и ограничивайте доступ; проверьте доступ к копии независимо от основного сервера.

## Восстановление: только отдельная пустая цель

**Не запускайте restore против рабочего production даже «для проверки отказа».** Скрипт останавливает выбранные app/resolver до проверки пустоты назначения. Ошибка настройки project может прервать рабочую установку.

Подготовьте отдельный сервер или изолированный Compose project/checkout с совместимой версией кода, своими credentials и без конфликтующих портов. Целевая БД и оба файловых volume должны быть пустыми. Не стартуйте обычный app до restore: его миграции заполнят пустую БД.

Пример для заранее подготовленного отдельного `/opt/restore/cola`:

```bash
sudo env \
  COMPOSE_PROJECT_NAME=cola-restored \
  COLA_COMPOSE_FILES=/opt/restore/cola/compose.prod.yaml \
  COLA_ENV_FILE=/opt/restore/cola/.env.production \
  python3 /opt/restore/cola/scripts/backup.py restore \
  --backup /srv/restore-input/colabike-TIMESTAMP-ID --yes
```

Пути и имя — пример, не команда для существующего проекта `cola`. Restore сначала проверяет архив, запускает db, проверяет пустоту public/bike_resolver, создаёт app container без запуска и проверяет пустоту файловых volumes. Затем выполняет `pg_restore` и распаковку. App/resolver остаются остановленными.

Запустите цель с **теми же** env/project/files, проверьте ready/status, вход, известные байки, приватность фото/GPX, journal media и назначения иконок/наград. Только после приёмки меняйте трафик. После неуспешного restore сохраняйте оригинальный backup, диагностируйте новую цель; никогда не удаляйте production volume ради прохождения emptiness check.

## Расписание и учения

Репозиторий предоставляет скрипты, но не гарантирует настроенные cron/systemd timers, off-host доставку или alarms. Контролируйте возраст последнего успешного backup, свободное место и доступность копии.

`bash scripts/test-backup-drill.sh` создаёт свои одноразовые проекты и проверяет backup/restore с маркерами БД/файлов и отказами на повреждение/перезапись. Он не заменяет периодическое восстановление вашего настоящего backup в изолированную среду.
