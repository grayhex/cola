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

## Версии стека и обновление

Версии проверены 26.09.2026 по официальным релизам, npm registry и Docker Hub. Это версии исходников и образов, а не подтверждение того, что уже запущено на VPS.

| Компонент | Зафиксировано | Источник |
| --- | --- | --- |
| Node.js | `24.21.0-alpine` во всех stages обоих Dockerfile; `24.21.0` в CI; `engines` допускает 24.x | [LTS-релиз](https://nodejs.org/en/blog/release/v24.21.0), [Docker-тег](https://hub.docker.com/v2/repositories/library/node/tags/24.21.0-alpine) |
| Next.js / Next ESLint plugin | `16.3.6` | [Релиз](https://github.com/vercel/next.js/releases/tag/v16.3.6), [npm Next](https://registry.npmjs.org/next/16.3.6), [npm plugin](https://registry.npmjs.org/@next%2feslint-plugin-next/16.3.6) |
| React / React DOM | `19.3.0` | [Релиз](https://github.com/facebook/react/releases/tag/v19.3.0), [npm React DOM](https://registry.npmjs.org/react-dom/19.3.0) |
| PostgreSQL | `17.11-alpine` в обоих Compose и CI | [Релиз](https://www.postgresql.org/docs/17/release-17-11.html), [Docker-тег](https://hub.docker.com/v2/repositories/library/postgres/tags/17.11-alpine) |
| Менеджеры пакетов и типы | pnpm `11.19.0` в корне, npm у Resolver; `@types/node` `24.13.6` в обоих пакетах | [pnpm](https://registry.npmjs.org/pnpm/11.19.0), [Node types](https://registry.npmjs.org/@types%2fnode/24.13.6) |

Более новый `@types/node` 24.19.0 опубликован менее суток назад и отклонён действующей политикой `minimumReleaseAge` pnpm. Выбран проверенный 24.13.6 той же линии Node 24; исключения из политики не добавлены. Node 26 пока Current, поэтому выбран Node 24 LTS. React 19.3.0 уже был в lockfile до обновления; manifest приведён к нему. PostgreSQL остаётся на major 17. На дату проверки `postgres:17-alpine` и `postgres:17.11-alpine` указывали на один digest; установленный контейнер всё равно нужно проверить отдельно. Next 16.3.6 включает [исправление `next/og`](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j).

### До merge и выкладки: операторская проверка

Merge в `main` запускает CI и затем автоматическую production-выкладку. Поэтому инвентаризацию, сохранение прежних образов и backup выполните **до merge**, согласовав окно с владельцем и дождавшись завершения других deploy/backup.

Версии работающих контейнеров (команды только читают, секреты не печатают):

```bash
cd /opt/stacks/cola
sudo docker compose --env-file .env.production -f compose.prod.yaml exec -T app node -e 'console.log({node:process.version,next:require("next/package.json").version,react:require("react/package.json").version,reactDom:require("react-dom/package.json").version})'
sudo docker compose --env-file .env.production -f compose.prod.yaml exec -T bike-resolver node --version
sudo docker compose --env-file .env.production -f compose.prod.yaml exec -T db psql -U colabike -d colabike -Atc 'SHOW server_version;'
sudo docker compose --env-file .env.production -f compose.prod.yaml images
sudo cat /var/lib/colabike/verified-sha
```

Если реальные версии новее выбранных или PostgreSQL уже другого major, остановите выкладку и согласуйте версию PR; не понижайте их по старой таблице. Сохраните SHA, точные image IDs/digests приложения, Resolver и БД. До пересборки присвойте прежним app/Resolver images отдельные уникальные локальные теги через `docker image tag IMAGE_ID BACKUP_TAG`, при необходимости выгрузите их через `docker image save`. Не полагайтесь на переиспользуемое имя Compose image и не запускайте image prune до приёмки. Сохраните конфигурацию отдельно с ограниченным доступом.

Выполните [production backup](backup-restore.md#production-backup), `verify` и проверьте доступность копии вне VPS. Backup включает БД и пользовательские файлы; сам образ приложения в него не входит. Эта смена версий не добавляет миграций приложения, однако перед обновлением PostgreSQL backup всё равно обязателен.

### После разрешённой выкладки

Повторите чтение версий выше, `docker compose --env-file .env.production -f compose.prod.yaml ps` и проверки `/api/ready` и `/api/status` из первого запуска. Сверьте `verified-sha` с принятым main. Проверьте вход, публичный и приватный велосипед, загрузку фотографии, создание/редактирование записи, покатушку и работу ручного ввода при недоступном Resolver. Ошибки контейнеров просматривайте локально, не публикуя секреты или приватные данные. Существующий CI дополнительно проверяет оба браузера, HTTP, миграции и backup/restore в изолированной среде.

### Возврат приложения и восстановление БД

Обычный wrapper разрешает только текущий `origin/main`: передача старого SHA не является rollback. Предпочтительный путь исправления — отдельный проверенный PR. Если нужен срочный возврат, оператор сначала останавливает/согласует автоматическую выкладку и проверяет совместимость прежнего приложения с текущей схемой.

Для возврата только app/Resolver используйте сохранённые **точные прежние образы** через временный Compose override с `image` у этих двух сервисов, теми же env, Compose project и volumes. После проверки итоговой конфигурации `--quiet` пересоздайте только `app bike-resolver` с `up --no-build --no-deps -d --wait`, явно передав основной production-файл и override. БД при этом не пересоздаётся. Повторите readiness/smoke; зафиксируйте фактические image IDs и инцидент отдельно — ручной возврат не обновляет `verified-sha`. Учтите, что возврат Next ниже 16.3.6 возвращает известный риск `next/og`; он требует отдельного решения владельца и быстрого исправления.

**Возврат образа приложения не восстанавливает данные и не откатывает PostgreSQL.** Не подключайте прежний PostgreSQL binary к существующему volume наугад, не удаляйте volume и не запускайте restore поверх рабочей БД. При проблеме БД остановите запись, сохраните текущее состояние и восстановите проверенный backup в отдельные пустые БД и volumes по [runbook](backup-restore.md#восстановление-только-отдельная-пустая-цель). Используйте совместимую версию PostgreSQL 17, проверьте данные, файлы и приложение; переключение трафика выполняет оператор после приёмки с учётом записей, появившихся после backup.
