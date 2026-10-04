# Развёртывание ColaBike

[Оглавление](../README.md)

## Окружения и предварительные условия

Локальная разработка описана в [первом запуске](../development/getting-started.md). Production — отдельный VPS, Docker Engine/Compose, PostgreSQL в Compose и Nginx на хосте. Checkout находится в `/opt/stacks/cola`, административный пользователь — `grayhex`, SSH-пользователь автоматической выкладки — `deploy`. Actions выполняются на GitHub-hosted runners; runner на VPS не нужен. Для другого сервера адаптируйте пути и пользователей явно.

До запуска настройте SSH по ключу, рабочий sudo и доступ через консоль провайдера. Запрет root/password SSH применяйте только после проверки новой сессии по ключу. Проверяйте effective `sshd -T`: порядок drop-in файлов влияет на фактически принятые значения. Firewall должен разрешать SSH и HTTP/HTTPS, не PostgreSQL или Resolver. Docker-публикация портов требует отдельной проверки, не полагайтесь только на список UFW.

Проверьте реальный объём диска, файловой системы и свободное место. Автоматический deploy загружает готовые CI images; место нужно для ZIP, `images.tar.gz`, новых Docker layers и сохранённых прежних образов. VPS должен быть amd64, иметь Python 3 и HTTPS-доступ к `api.github.com`. Ручной bootstrap со сборкой дополнительно требует CPU/RAM и может использовать swap. Наличие тарифа «50 ГБ» не доказывает, что корневой раздел уже расширен. Не выполняйте изменение разделов без проверки `lsblk`, типа файловой системы и резервной копии.

## Репозиторий и конфигурация

Публичный репозиторий можно клонировать по HTTPS в `/opt/stacks/cola` без ключа GitHub. Если существующая установка использует read-only deploy key, его менять не требуется. Ключ чтения репозитория и ключ Actions для входа на VPS пользователем `deploy` — разные credentials. Git должен работать от владельца checkout; пользователю `deploy` не нужна Docker group.

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

Сессии нативных клиентов API v1 настраиваются необязательными `DEVICE_ACCESS_TOKEN_MINUTES` (15), `DEVICE_REFRESH_IDLE_DAYS` (60) и `DEVICE_REFRESH_ABSOLUTE_DAYS` (180); неверное значение заменяется значением по умолчанию, простой не превышает абсолютный срок. Миграция `050` аддитивна: существующие сессии остаются браузерными.

Вход через Яндекс ID необязателен: `YANDEX_ID_ENABLED=true`, `YANDEX_ID_CLIENT_ID`, `YANDEX_ID_CLIENT_SECRET`; Redirect URI приложения — `<APP_ORIGIN>/api/auth/yandex/callback`. Неполная настройка при `DEPLOYMENT_MODE=production` останавливает старт; без настройки сайт работает по почте и паролю. Нативный вход приложений через Яндекс ID включается необязательным `NATIVE_AUTH_RETURN_URL`: HTTPS-ссылка приложения (Universal Link / App Link; для разработки допустим `http://localhost`), без параметров и данных входа; пусто — выключен, сайт работает как раньше. Для Android-клиента production-значение — `https://colabike.ru/app/auth`, а `ANDROID_CERT_SHA256` (SHA-256 сертификата подписи, `AA:BB:…` или 64 hex; несколько — через запятую) публикуется в `/.well-known/assetlinks.json`; без отпечатка файл пуст, ссылка не подтверждена и Android откроет её в браузере. Отпечаток берётся из реальной подписи приложения (в том числе release-ключа для RuStore), в репозиторий не вносится и не угадывается; неверное значение останавливает старт. `ANDROID_APP_ID` задаётся, только если `applicationId` не `ru.colabike.app`. Файл должен отвечать по HTTPS без перенаправлений: проверьте `curl -i https://colabike.ru/.well-known/assetlinks.json` после выкладки. Миграция `052` аддитивна. Регистрация приложения и проверки перед включением — [в главе об аккаунте](../modules/accounts.md#вход-через-яндекс-id-151).

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

Ожидается только `127.0.0.1:3000` на хосте; db/resolver не имеют host ports. Runtime проверяет production-настройки, затем миграции выполняются до старта Next. Ошибка Resolver не должна выключать ручной ввод, но после `--wait` проверяйте `app`, `db`, `bike-resolver`, `chat-sync`, `activity-sync`, `notification-email`, `bike-week` и успешное завершение `migrate`. Workers не имеют HTTP-healthcheck: их работу дополнительно проверяют по логам и очередям интеграций.

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
docker compose --env-file .env.production -f compose.prod.yaml run --rm --no-deps migrate node scripts/set-admin.js your-email@example.com
```

Email — пример. Скрипт работает только с существующим пользователем и также снимает блокировку. Не открывайте регистрацию всей аудитории до smoke-проверок и backup. Настройте SSH-доступ ниже и сверьте [CI/CD](ci-cd.md). Первую production-выкладку точного прошедшего CI SHA выполняет оператор после согласования.

**После настройки обычные обновления идут через PR → main → CI → Deploy · Production по SSH**, а не через ручной `pull` произвольной новой версии. Сервисы обновляются на месте; автоматического rollback и гарантии zero-downtime нет. Перед рисковой миграцией нужен [backup](backup-restore.md).

## SSH-доступ для GitHub Actions

Это инструкция первоначальной настройки оператором. Изменение скриптов в `ops/` само по себе не обновляет установленные root-owned wrappers: их обновление выполняется оператором после review.

1. Подготовьте отдельного пользователя `deploy` с рабочей оболочкой для forced-command, без входа по паролю и без Docker group. У владельца `/opt/stacks/cola` должен работать read-only доступ к репозиторию; `deploy` не должен изменять checkout и `.env.production`.
2. Из проверенного checkout установите три root-owned скрипта (каталог назначения также не должен быть доступен `deploy` на запись):

   ```bash
   sudo install -o root -g root -m 0755 ops/deploy-cola /usr/local/sbin/deploy-cola
   sudo install -o root -g root -m 0755 ops/deploy-cola-ssh /usr/local/sbin/deploy-cola-ssh
   sudo install -o root -g root -m 0755 ops/deploy-cola-images.py /usr/local/sbin/deploy-cola-images.py
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

   | Имя                  | Назначение                                                                                          |
   | -------------------- | --------------------------------------------------------------------------------------------------- |
   | `DEPLOY_SSH_KEY`     | Приватная часть отдельного ключа Actions, соответствующая ограниченной строке выше                  |
   | `DEPLOY_KNOWN_HOSTS` | Проверенные записи host key VPS в формате `known_hosts`; для нестандартного порта — с `[host]:port` |
   | `DEPLOY_HOST`        | SSH-адрес VPS без имени пользователя; workflow использует `deploy`                                  |
   | `DEPLOY_PORT`        | SSH-порт; при отсутствии workflow использует 22                                                     |

   Host key сверяйте через доверенный канал (например, консоль провайдера); не считайте непроверенный результат `ssh-keyscan` подтверждением подлинности. Настройки защиты `main` и environment проверяются отдельно: файлы репозитория их не применяют.

Forced-command принимает только `SHA prebuilt RUN_ID ATTEMPT` либо прежний 40-символьный SHA для совместимости. `deploy-cola` требует текущий `origin/main` и чистоту tracked-файлов. В prebuilt-режиме сервер сверяет CI и digest архива через GitHub API, загружает три образа и запускает Compose с `--no-build`; ошибка не включает локальную сборку. Даже корректный запрос запускает реальную выкладку: не используйте его как безвредный тест SSH. При разрешённой оператором выкладке проверьте Actions, healthchecks и `/var/lib/colabike/verified-sha`; недоступную production-проверку отмечайте отдельно.

### Переход на готовые образы CI

После review, **до merge** workflow, оператор устанавливает все три файла из точного проверенного commit. Это изменение root-owned tooling; merge его не выполняет. Дождитесь завершения старого deploy и сохраните текущие wrappers для операторского возврата. Из checkout владельца репозитория:

```bash
bash <<'BASH'
set -euo pipefail
cd /opt/stacks/cola
reviewed_sha=REPLACE_WITH_REVIEWED_40_CHARACTER_SHA
[[ "$reviewed_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Подставьте полный SHA проверенного commit" >&2; exit 1; }
git fetch origin "$reviewed_sha"
deploy_tools=$(mktemp -d)
trap 'rm -rf -- "$deploy_tools"' EXIT
for file in deploy-cola deploy-cola-ssh deploy-cola-images.py; do
  git show "$reviewed_sha:ops/$file" > "$deploy_tools/$file" || exit 1
done
bash -n "$deploy_tools/deploy-cola" "$deploy_tools/deploy-cola-ssh"
python3 -m py_compile "$deploy_tools/deploy-cola-images.py"
sudo install -o root -g root -m 0755 "$deploy_tools/deploy-cola-images.py" /usr/local/sbin/deploy-cola-images.py
sudo install -o root -g root -m 0755 "$deploy_tools/deploy-cola" /usr/local/sbin/deploy-cola
sudo install -o root -g root -m 0755 "$deploy_tools/deploy-cola-ssh" /usr/local/sbin/deploy-cola-ssh
BASH
```

Команды не переключают production checkout и не запускают контейнеры. Sudoers, authorized_keys и secrets остаются прежними. После установки и разрешённого merge дождитесь CI итогового main и нового Deploy. Старый run без image artifact повторять бесполезно; если artifact истёк или выбран повтор только failed jobs без нового operations artifact, запустите полный ручной Deploy из main: он повторит весь CI. Не подменяйте SHA/run/attempt и не передавайте архивы из PR.

### Loaded image identity mismatch после перехода

В первоначальном helper из PR #295 поле Docker `Id` сравнивалось с SHA-256 конфигурации из доверенного архива. Это корректно для classic image store, но containerd image store возвращает digest manifest/index. Ошибка после `Loaded image` возникает до изменения production-тегов, запуска Compose и записи `verified-sha`; checkout при этом уже может быть обновлён.

Обновите root-owned helper из проверенного исправленного commit по инструкции выше. Исправление сохраняет проверку CI и SHA-256 ZIP. Если daemon ID отличается от config digest, helper экспортирует образ по неизменяемому daemon ID во временный TAR и проверяет точные байты конфигурации, включая ссылки на слои и параметры запуска. Только после проверки всех трёх образов production-теги назначаются их проверенным daemon IDs. Нужен дополнительный временный запас диска под один несжатый образ; TAR удаляется после проверки. Несовпадение конфигурации или ошибка экспорта останавливает выкладку.

Для подтверждения backend достаточно `sudo docker info --format '{{json .DriverStatus}}'`: containerd показывает `io.containerd.snapshotter.v1`. Проверку хэшей не отключайте и backend работающего Docker не переключайте ради обхода ошибки. После обновления helper можно повторить failed deploy job, если его target всё ещё текущий main, а CI artifact не истёк; иначе нужен полный ручной Deploy из main. Сам по себе retry прежнего helper ничего не исправляет.

### No space left on device в `/tmp`

Сверьте `df -hT / /tmp /var/lib/colabike`, `df -i / /tmp` и `findmnt -T /tmp`. В production обнаружен `/tmp` типа tmpfs с лимитом 822 МиБ при 28 ГБ свободного места на основном диске: ZIP и извлечённый gzip занимали около 486 МиБ, после чего несжатый экспорт ops переставал помещаться. Увеличение лимита tmpfs при 1,6 ГиБ RAM не устраняет потребление памяти.

Исправленный helper создаёт приватный каталог `colabike-images-*` внутри `/var/lib/colabike` (родитель уже создаётся wrapper), а все временные экспорты — внутри этого каталога. Default `TMPDIR` не используется. После проверки и распаковки ZIP удаляется до Docker load; временное дерево очищается и при обычном отказе. На этом разделе нужен запас под gzip и один несжатый образ, а Docker дополнительно хранит загруженные образы. После ошибки место в tmpfs уже может быть свободно из-за cleanup.

Обновите root-owned helper из проверенного commit по инструкции выше и повторите failed deploy при актуальном target/main и живом artifact. Очистка Docker volumes и перезапуск Docker для этого исправления не нужны. Не меняйте `/tmp` всего сервера: deploy использует свой каталог на диске.

## Одноразовые миграции и операторские команды

Обычный `compose up --build -d --wait` теперь собирает `app` (target `runner`) и
`migrate` (target `ops`). После готовности БД запускается один контейнер миграций;
зависимость `service_completed_successfully` разрешает запуск web только после
успеха. `restart app` не запускает SQL. История и транзакционная advisory-блокировка
миграций сохранены; повторный общий `up` безопасно проверяет ту же историю.
Автоматический prebuilt deploy загружает эти образы заранее и использует `up --no-build` с теми же зависимостями и healthchecks. Для перехода wrapper нужно обновить по инструкции выше.

`migrate` единожды собирает локальный образ `${COMPOSE_PROJECT_NAME}-ops:local`.
`chat-sync`, `activity-sync`, `notification-email`, `notification-push` и `bike-week` используют этот же образ без собственного build/export
и без pull из registry; имя изолировано именем Compose-проекта. Workers стартуют
только после успешной миграции. На чистом хосте запускайте обычный полный `up --build` либо
сначала `build migrate`: `up --no-build chat-sync` не создаст отсутствующий образ.
CI проверяет build graph, холодный `up --build` с отдельным локальным тегом и
совпадение image ID миграции/worker в runtime/restore drill.

При ошибке миграции Compose/deploy завершается ошибкой, новый web не запускается,
`verified-sha` не обновляется. Транзакция откатывается. Старый web может быть
остановлен Compose при пересоздании: это не атомарный deploy без простоя. Исправить
причину и повторить проверенную выкладку; автоматического отката схемы нет.
Для ручного возврата приложения применим описанный ниже образный rollback только
при совместимости схемы; иначе оператор восстанавливает согласованный backup.

Операторские команды выполняются через `run --rm --no-deps migrate node scripts/...`
с теми же env/project/volumes и уже работающей БД. Они больше не доступны через
`exec app`. После принятой выкладки отдельно проверить exit code `migrate`, readiness,
вход, загрузку фото, покатушку и версии. Production-проверку выполняет оператор.

## Незавершённый deploy и повторный запуск

Deploy `36930668668` остановился по лимиту 38 минут: зависимости были закешированы, ops и Resolver завершились, а Next оставался на `Creating an optimized production build` примерно 37,5 минуты. Лог не доказывает OOM; для причины зависания нужны метрики VPS. Новый путь убирает эту повторную компиляцию: передаёт уже проверенные CI images. Лимиты — 30 минут для job и 22 минуты для SSH-step; на сервере отдельно ограничены lock, загрузка и Compose. Актуальные значения — в [deploy.yml](../../.github/workflows/deploy.yml) и wrappers. Если выкладка не завершилась, проверьте сервер до повтора.

Отмена SSH-job не доказывает остановку удалённого BuildKit/Compose. Перед повтором
оператор проверяет состояние; lock-файл не удаляют и процессы не убивают вслепую:

```sh
cd /opt/stacks/cola
sudo lslocks --output PID,COMMAND,PATH
sudo docker compose --env-file .env.production -f compose.prod.yaml ps -a
sudo cat /var/lib/colabike/verified-sha
curl --fail --silent --show-error https://colabike.ru/api/ready
```

Если прежняя операция держит `/var/lock/colabike-deploy.lock`, дождитесь её
завершения и выясните состояние процесса до новой выкладки. Оператор запускает
штатный deploy актуального проверенного `main`. Re-run старого запуска использует
его workflow/commit; wrapper отклонит SHA, который уже не совпадает с `origin/main`.
Успех подтверждается зелёным deploy, readiness и ожидаемым `verified-sha`.

## Версии стека и обновление

Версии ниже взяты из файлов этой ветки; состояние запущенных контейнеров проверяется отдельно. При обновлении сверяйте manifests, lockfiles, Dockerfile и CI вместе.

| Компонент         | Линия / источник точной версии                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js           | 24.x; [Dockerfile](../../Dockerfile), [Resolver Dockerfile](../../services/bike-resolver/Dockerfile), [CI](../../.github/workflows/check.yml) |
| Next.js / React   | 16 / 19; [package.json](../../package.json) и [pnpm-lock.yaml](../../pnpm-lock.yaml)                                                          |
| PostgreSQL        | 17; [Compose](../../compose.prod.yaml) и CI                                                                                                   |
| Менеджеры пакетов | pnpm из `packageManager` корня; npm с отдельным [lockfile Resolver](../../services/bike-resolver/package-lock.json)                           |

Сохраняйте ограничения `engines`, политику `minimumReleaseAge` и проверку peers. Не обходите их ради самого нового пакета. Обновление major PostgreSQL требует отдельного плана переноса данных; смена тега не заменяет миграцию БД.

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

Если реальные версии расходятся с выбранным commit или PostgreSQL уже другого major, выясните причину до выкладки; не понижайте их по документации. Сохраните SHA, точные image IDs/digests приложения, ops, Resolver и БД. До пересборки присвойте прежним app/ops/Resolver images отдельные уникальные локальные теги через `docker image tag IMAGE_ID BACKUP_TAG`, при необходимости выгрузите их через `docker image save`. Не полагайтесь на переиспользуемое имя Compose image и не запускайте image prune до приёмки. Сохраните конфигурацию отдельно с ограниченным доступом.

Выполните [production backup](backup-restore.md#production-backup), `verify` и проверьте доступность копии вне VPS. Backup включает БД и пользовательские файлы; сам образ приложения в него не входит. Состав миграций проверяйте по diff выбранного обновления; перед обновлением PostgreSQL backup обязателен.

### После разрешённой выкладки

Повторите чтение версий выше, `docker compose --env-file .env.production -f compose.prod.yaml ps` и проверки `/api/ready` и `/api/status` из первого запуска. Сверьте `verified-sha` с принятым main. Проверьте вход, публичный и приватный велосипед, загрузку фотографии, создание/редактирование записи, покатушку и работу ручного ввода при недоступном Resolver. Ошибки контейнеров просматривайте локально, не публикуя секреты или приватные данные. Существующий CI дополнительно проверяет оба браузера, HTTP, миграции и backup/restore в изолированной среде.

### Возврат приложения и восстановление БД

Обычный wrapper разрешает только текущий `origin/main`: передача старого SHA не является rollback. Предпочтительный путь исправления — отдельный проверенный PR. Если нужен срочный возврат, оператор сначала останавливает/согласует автоматическую выкладку и проверяет совместимость прежнего приложения с текущей схемой.

Для возврата только app/Resolver используйте сохранённые **точные прежние образы** через временный Compose override с `image` у этих двух сервисов, теми же env, Compose project и volumes. После проверки итоговой конфигурации `--quiet` пересоздайте только `app bike-resolver` с `up --no-build --no-deps -d --wait`, явно передав основной production-файл и override. БД при этом не пересоздаётся. Повторите readiness/smoke; зафиксируйте фактические image IDs и инцидент отдельно — ручной возврат не обновляет `verified-sha`. Учтите, что возврат Next ниже 16.3.6 возвращает известный риск `next/og`; он требует отдельного решения владельца и быстрого исправления.

**Возврат образа приложения не восстанавливает данные и не откатывает PostgreSQL.** Не подключайте прежний PostgreSQL binary к существующему volume наугад, не удаляйте volume и не запускайте restore поверх рабочей БД. При проблеме БД остановите запись, сохраните текущее состояние и восстановите проверенный backup в отдельные пустые БД и volumes по [runbook](backup-restore.md#восстановление-только-отдельная-пустая-цель). Используйте совместимую версию PostgreSQL 17, проверьте данные, файлы и приложение; переключение трафика выполняет оператор после приёмки с учётом записей, появившихся после backup.

### CSP rollout

Compose передаёт `CSP_MODE` (по умолчанию `report-only`) и `CSP_MAP_ORIGINS` из env во время запуска. Значения не встраиваются в browser build. `enforce` включается только после матрицы совместимости и проверки живых карт; откат — `report-only`, аварийный baseline — `off`. Пересоздание app выполняет владелец стандартной процедурой deployment. Не добавляйте в nginx второй расширенный CSP, скрывающий заголовки приложения, и не кешируйте HTML с nonce. [Политика, источники, приёмник отчётов и приёмка](../architecture/security.md#content-security-policy).

### Worker велосипеда недели

`bike-week` использует общий ops image и стартует после миграций вместе с остальными сервисами Compose. Дополнительные env/cron не нужны. Проверка: `docker compose -f compose.prod.yaml --env-file .env.production logs --tail=20 bike-week`; штатный event — `bike_week_tick`, при ошибке — `bike_week_unavailable`. Одноразовый запуск из ops: `node scripts/bike-week.js --once`. Механика включается/настраивается в админке; worker не обращается к внешним провайдерам. После restore повторный запуск идемпотентен по неделе.
