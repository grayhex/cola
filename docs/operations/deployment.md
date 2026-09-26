# Развёртывание ColaBike

[Оглавление](../README.md)

## Окружения и предварительные условия

Локальная разработка описана в [первом запуске](../development/getting-started.md). Production — отдельный VPS, Docker Engine/Compose, PostgreSQL в Compose и Nginx на хосте. Checkout находится в `/opt/stacks/cola`, административный пользователь — `grayhex`, SSH-пользователь автоматической выкладки — `deploy`. Actions выполняются на GitHub-hosted runners; runner на VPS не нужен. Для другого сервера адаптируйте пути и пользователей явно.

До запуска настройте SSH по ключу, рабочий sudo и доступ через консоль провайдера. Запрет root/password SSH применяйте только после проверки новой сессии по ключу. Проверяйте effective `sshd -T`: порядок drop-in файлов влияет на фактически принятые значения. Firewall должен разрешать SSH и HTTP/HTTPS, не PostgreSQL или Resolver. Docker-публикация портов требует отдельной проверки, не полагайтесь только на список UFW.

Проверьте реальный объём диска, файловой системы и свободное место. Сборка выполняется на VPS, требует ресурсов и может использовать swap. Наличие тарифа «50 ГБ» не доказывает, что корневой раздел уже расширен. Не выполняйте изменение разделов без проверки `lsblk`, типа файловой системы и резервной копии.

## Репозиторий и конфигурация

Клонируйте репозиторий с отдельным read-only deploy key в `/opt/stacks/cola`. Ключ чтения GitHub у владельца checkout и ключ Actions для входа на VPS пользователем `deploy` — разные credentials. Git должен работать от владельца checkout. Пользователю `deploy` не нужны личный GitHub-ключ или Docker group.

Production использует **самостоятельный** [compose.prod.yaml](../../compose.prod.yaml). Не объединяйте его через несколько `-f` с локальным `compose.yaml`: настройки портов могут сложиться. Создайте `.env.production` из [примера](../../.env.production.example), только если файла ещё нет; не перегенерируйте значения для работающей БД.

Обязательные значения:

```dotenv
APP_ORIGIN=https://colabike.ru
COOKIE_SECURE=true
POSTGRES_PASSWORD=<отдельный случайный секрет>
TRUSTED_PROXY_KEY=<другой случайный секрет>
BIKE_RESOLVER_TOKEN=<ещё один случайный секрет>
```

Почта нужна для восстановления пароля и подтверждения адреса: `SMTP_URL=smtps://user:password@smtp.example.com:465` (или `smtp://…:587`, STARTTLS обязателен) и `MAIL_FROM="ColaBike <noreply@colabike.ru>"`. Подойдёт SMTP почтового сервиса домена или транзакционного провайдера; настройте SPF/DKIM для домена отправителя. Без `SMTP_URL` сайт запускается, в журнале старта будет `"mail":"disabled"`, а восстановление пароля отвечает 503 — тогда владелец использует `scripts/reset-password.js` ([аккаунт](../modules/accounts.md#восстановление-пароля-и-подтверждение-почты)). `MAIL_CAPTURE_DIR` предназначен только для тестов и в production отклоняется.

Необязательные `ERROR_TRACKER_DSN` (HTTPS DSN Sentry или GlitchTip) и `SLOW_REQUEST_MS` описаны в [мониторинге](monitoring.md#журнал-ошибок-и-трекер).

Необязательная `PUBLIC_SITE_URL` задаёт адрес для `canonical` и превью ссылок в мессенджерах, если он отличается от `APP_ORIGIN`. Это должен быть публичный HTTPS-адрес без пути, например `https://colabike.ru`, иначе приложение не стартует. Без неё используется `APP_ORIGIN` ([публичные адреса](../modules/public-urls.md)).

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

После выпуска установите [nginx-colabike.conf](../../ops/nginx-colabike.conf), подставив точный `TRUSTED_PROXY_KEY` из env. Изображения (`/api/photos`, `/api/avatars`, `/api/assets`, медиа журнала и рынка) вынесены в отдельную зону `cola_media` с более мягким лимитом: одна страница запрашивает десятки картинок. При обновлении существующей установки перенесите в конфиг сервера новую зону и `location`. Не отправляйте секрет в чат и не публикуйте конфиг целиком. Применение: `sudo nginx -t && sudo systemctl reload nginx`. Приложение остаётся на loopback, TLS завершается в nginx.

Проверьте HTTPS, редирект HTTP, Secure cookies и `Referrer-Policy: strict-origin-when-cross-origin` для внешних карт. Таймер Certbot и deploy hook, выполняющий `nginx -t` и reload после успешного renew, настраиваются на сервере. `certbot renew --dry-run` проверяет возможность продления; наличие/выполнение hook проверяется отдельно. Обновление репозитория не обновляет nginx или Certbot автоматически.

## Администратор и переход к автоматическому deploy

После обновления войдите существующим администратором и опубликуйте оба документа в **Система → Документы**. На совершенно новой установке создайте первого владельца через `scripts/bootstrap-admin.js` по [инструкции первого запуска](../development/getting-started.md#первый-администратор), используя `--env-file .env.production -f compose.prod.yaml` вместо локального Compose. Пароль передавайте по stdin; регистрацию без документов не открывайте.

Для повышения уже существующего аккаунта:

```bash
cd /opt/stacks/cola
docker compose --env-file .env.production -f compose.prod.yaml exec app node scripts/set-admin.js your-email@example.com
```

Email — пример. Скрипт работает только с существующим пользователем и также снимает блокировку. Не открывайте регистрацию всей аудитории до smoke-проверок и backup. Настройте SSH-доступ ниже и сверьте [CI/CD](ci-cd.md). Первую production-выкладку точного прошедшего CI SHA выполняет оператор после согласования.

**После настройки обычные обновления идут через PR → main → CI → Deploy · Production по SSH**, а не через ручной `pull` произвольной новой версии. Сервисы обновляются на месте; автоматического rollback и гарантии zero-downtime нет. Перед рисковой миграцией нужен [backup](backup-restore.md).

## SSH-доступ для GitHub Actions

Это инструкция первоначальной настройки оператором. Перенос исходника `deploy-cola-ssh` в `ops/` не меняет его байты, установленный путь или `authorized_keys`; для уже работающей SSH-выкладки переустановка из-за одного переноса не требуется.

1. Подготовьте отдельного пользователя `deploy` с рабочей оболочкой для forced-command, без входа по паролю и без Docker group. У владельца `/opt/stacks/cola` должен работать read-only доступ к репозиторию; `deploy` не должен изменять checkout и `.env.production`.
2. Из проверенного checkout установите оба root-owned скрипта (каталог назначения также не должен быть доступен `deploy` на запись):

   ```bash
   sudo install -o root -g root -m 0755 ops/deploy-cola /usr/local/sbin/deploy-cola
   sudo install -o root -g root -m 0755 ops/deploy-cola-ssh /usr/local/sbin/deploy-cola-ssh
   ```

3. Через `sudo visudo -f /etc/sudoers.d/cola-deploy` разрешите единственную команду и проверьте файл:

   ```sudoers
   deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-cola
   ```

   ```bash
   sudo chown root:root /etc/sudoers.d/cola-deploy
   sudo chmod 0440 /etc/sudoers.d/cola-deploy
   sudo visudo -cf /etc/sudoers.d/cola-deploy
   ```

4. Для отдельного ключа Actions добавьте в `~deploy/.ssh/authorized_keys` строку с ограничениями. Ниже шаблон: замените `PUBLIC_KEY_BASE64` публичной частью этого ключа; приватную часть на VPS не копируйте. Права каталога `.ssh` — 700, файла — 600; сохраните чужие действующие ключи.

   ```text
   restrict,command="/usr/local/sbin/deploy-cola-ssh" ssh-ed25519 PUBLIC_KEY_BASE64 gha-deploy
   ```

5. В Settings → Environments → `production` ограничьте deployment branches веткой `main` и добавьте environment secrets:

   | Имя | Назначение |
   | --- | --- |
   | `DEPLOY_SSH_KEY` | Приватная часть отдельного ключа Actions, соответствующая ограниченной строке выше |
   | `DEPLOY_KNOWN_HOSTS` | Проверенные записи host key VPS в формате `known_hosts`; для нестандартного порта — с `[host]:port` |
   | `DEPLOY_HOST` | SSH-адрес VPS без имени пользователя; workflow использует `deploy` |
   | `DEPLOY_PORT` | SSH-порт; при отсутствии workflow использует 22 |

   Host key сверяйте через доверенный канал (например, консоль провайдера); не считайте непроверенный результат `ssh-keyscan` подтверждением подлинности. Настройки защиты `main` и environment проверяются отдельно: файлы репозитория их не применяют.

Forced-command отклоняет всё, кроме 40-символьного SHA. Затем `deploy-cola` требует, чтобы SHA совпадал с текущим `origin/main`, проверяет чистоту tracked-файлов, собирает Compose и ждёт healthchecks. Даже корректный SHA запускает реальную выкладку: не используйте его как безвредный тест SSH. При разрешённой оператором выкладке проверьте Actions, healthchecks и `/var/lib/colabike/verified-sha`; недоступную production-проверку отмечайте отдельно.
