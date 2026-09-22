# Развёртывание ColaBike

[Оглавление](../README.md)

## Окружения и предварительные условия

Локальная разработка описана в [первом запуске](../development/getting-started.md). Production — отдельный VPS, Docker Engine/Compose, PostgreSQL в Compose и Nginx на хосте. В текущей установке checkout находится в `/opt/stacks/cola`, административный пользователь — `grayhex`, отдельный runner — `github-runner`. Для другого сервера адаптируйте пути и пользователей явно.

До запуска настройте SSH по ключу, рабочий sudo и доступ через консоль провайдера. Запрет root/password SSH применяйте только после проверки новой сессии по ключу. Проверяйте effective `sshd -T`: порядок drop-in файлов влияет на фактически принятые значения. Firewall должен разрешать SSH и HTTP/HTTPS, не PostgreSQL или Resolver. Docker-публикация портов требует отдельной проверки, не полагайтесь только на список UFW.

Проверьте реальный объём диска, файловой системы и свободное место. Сборка выполняется на VPS, требует ресурсов и может использовать swap. Наличие тарифа «50 ГБ» не доказывает, что корневой раздел уже расширен. Не выполняйте изменение разделов без проверки `lsblk`, типа файловой системы и резервной копии.

## Репозиторий и конфигурация

Клонируйте репозиторий с отдельным read-only deploy key в `/opt/stacks/cola`. Ключ GitHub, SSH-ключ входа на сервер и registration token Actions runner — разные credentials. Git должен работать от владельца checkout. Не передавайте личный GitHub-ключ runner и не добавляйте его в Docker group.

Production использует **самостоятельный** [compose.prod.yaml](../../compose.prod.yaml). Не объединяйте его через несколько `-f` с локальным `compose.yaml`: настройки портов могут сложиться. Создайте `.env.production` из [примера](../../.env.production.example), только если файла ещё нет; не перегенерируйте значения для работающей БД.

Обязательные значения:

```dotenv
APP_ORIGIN=https://colabike.ru
COOKIE_SECURE=true
POSTGRES_PASSWORD=<отдельный случайный секрет>
TRUSTED_PROXY_KEY=<другой случайный секрет>
BIKE_RESOLVER_TOKEN=<ещё один случайный секрет>
```

Для каждого секрета независимо используйте `openssl rand -hex 32`; храните файл с правами 600 и не коммитьте его. Hex-пароль не требует дополнительного URL-экранирования в DATABASE_URL. Изменение `POSTGRES_PASSWORD` в env **не меняет пароль уже созданного PostgreSQL volume** — ротация требует согласованных действий в БД и конфигурации.

Compose явно передаёт нужные переменные сервисам. Произвольная строка в `.env.production` не означает, что она появилась в контейнере: для новой настройки нужен соответствующий `environment`/`env_file` в Compose. Настройки UI/ключ карт и server secrets имеют разные границы публичности.

## Первый запуск

На чистом окружении или после review и резервного копирования:

```bash
cd /opt/stacks/cola
docker compose --env-file .env.production -f compose.prod.yaml config --quiet
docker compose --env-file .env.production -f compose.prod.yaml up --build -d --wait --wait-timeout 180
docker compose --env-file .env.production -f compose.prod.yaml ps
curl --fail --max-time 10 http://127.0.0.1:3000/api/ready
curl --fail --max-time 10 http://127.0.0.1:3000/api/status
sudo ss -lntp | grep -E ':(3000|5432|8080)\b'
```

Ожидается только `127.0.0.1:3000` на хосте; db/resolver не имеют host ports. Runtime проверяет production-настройки, затем миграции выполняются до старта Next. Ошибка Resolver не должна выключать ручной ввод, но после `--wait` проверяйте состояние всех трёх сервисов.

Не печатайте `docker compose config` без `--quiet` в общедоступный лог: он раскрывает секреты. Стабильное имя Compose project определяет имена volumes; сохраните существующее имя при обновлении. Не запускайте `down -v` для исправления сборки.

## DNS, TLS и Nginx

Настройте A-запись домена на VPS; AAAA публикуйте только при рабочем публичном IPv6. Сверьте authoritative и используемый сервером DNS. Успешный `curl` на loopback не доказывает внешнюю доступность HTTP-01 challenge.

Для webroot-сертификата сначала отдайте на HTTP `/.well-known/acme-challenge/` из `/var/www/acme`, с доступными nginx правами и исключением из запретов dot-path. Проверьте тестовый файл с внешней машины. Только затем выполните `certbot certonly --webroot -w /var/www/acme -d colabike.ru`. Процедура предполагает уже установленный Certbot/Nginx и согласованное окно настройки; на работающем сайте не заменяйте конфиг временной заглушкой без необходимости.

После выпуска установите [nginx-colabike.conf](../../ops/nginx-colabike.conf), подставив точный `TRUSTED_PROXY_KEY` из env. Не отправляйте секрет в чат и не публикуйте конфиг целиком. Применение: `sudo nginx -t && sudo systemctl reload nginx`. Приложение остаётся на loopback, TLS завершается в nginx.

Проверьте HTTPS, редирект HTTP, Secure cookies и `Referrer-Policy: strict-origin-when-cross-origin` для внешних карт. Таймер Certbot и deploy hook, выполняющий `nginx -t` и reload после успешного renew, настраиваются на сервере. `certbot renew --dry-run` проверяет возможность продления; наличие/выполнение hook проверяется отдельно. Обновление репозитория не обновляет nginx или Certbot автоматически.

## Администратор и переход к автоматическому deploy

После обновления войдите существующим администратором и опубликуйте оба документа в **Система → Документы**. На совершенно новой установке создайте первого владельца через `scripts/bootstrap-admin.js` по [инструкции первого запуска](../development/getting-started.md#первый-администратор), используя `--env-file .env.production -f compose.prod.yaml` вместо локального Compose. Пароль передавайте по stdin; регистрацию без документов не открывайте.

Для повышения уже существующего аккаунта:

```bash
cd /opt/stacks/cola
docker compose --env-file .env.production -f compose.prod.yaml exec app node scripts/set-admin.js your-email@example.com
```

Email — пример. Скрипт работает только с существующим пользователем и также снимает блокировку. Не открывайте регистрацию всей аудитории до smoke-проверок и backup. Установите root-owned wrapper и repository-scoped runner по [CI/CD](ci-cd.md), затем проверьте тестовую выкладку точного прошедшего CI SHA.

**После настройки обычные обновления идут через PR → main → CI → Deploy · Production**, а не через ручной `pull` произвольной новой версии. Сервисы обновляются на месте; автоматического rollback, гарантии zero-downtime и переноса данных со staging нет. Перед рисковой миграцией нужен [backup](backup-restore.md).
