<div align="center">

# ColaBike

**Публичная витрина велосипедов и личный кабинет для тех, кто любит собирать, настраивать и показывать свой байк.**

[![Version](https://img.shields.io/badge/version-0.3.1-111111?style=flat-square)](./package.json)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)

[![Checks](https://github.com/grayhex/cola/actions/workflows/check.yml/badge.svg)](https://github.com/grayhex/cola/actions/workflows/check.yml)
[![Deploy](https://github.com/grayhex/cola/actions/workflows/deploy.yml/badge.svg)](https://github.com/grayhex/cola/actions/workflows/deploy.yml)

</div>

ColaBike — это не просто «мой гараж». Главная страница работает как общая **выставка публичных велосипедов**: гости могут смотреть сборки, искать велосипеды, фильтровать их по типу и видеть рейтинг, заполненность и лайки. Владелец управляет своими велосипедами и персональным оформлением через отдельный **личный кабинет**.

> Публичность всегда управляется владельцем. Приватные велосипеды не попадают в витрину, их фотографии и карточки недоступны посторонним.

---

## Что уже умеет ColaBike

### Публичная витрина

- общая лента публичных велосипедов всех незаблокированных пользователей;
- доступ без регистрации;
- поиск по велосипеду и автору;
- фильтрация по типу велосипеда;
- постраничная выдача по 24 велосипеда;
- отдельная публичная карточка `/b/<uuid>`;
- ник автора рядом с велосипедом;
- лайки чужих публичных велосипедов для зарегистрированных пользователей;
- настраиваемая **прокаченность 0–100**;
- индикатор **заполненности карточки** по фотографиям и комплектации.

### Личный кабинет

Маршрут `/account` отделён от публичной витрины и предназначен для управления своими данными:

- список собственных велосипедов;
- создание, редактирование и удаление;
- публикация / снятие с публикации;
- изменение ника;
- персональная тема: светлая, тёмная или системная;
- персональный шрифт;
- свой акцентный цвет;
- компактный, сбалансированный или подробный вид карточки;
- индивидуальная настройка отображения пробега.

Почта аккаунта видна только владельцу.

### Карточка велосипеда

Для каждого велосипеда можно хранить:

- марку, модель, комплектацию, год и тип;
- название, цвет, размер, вес и пробег;
- описание и ссылку на производителя;
- стоимость велосипеда;
- актуальную комплектацию;
- аксессуары;
- ссылки и цены отдельных компонентов;
- заводскую спецификацию отдельно от текущей сборки;
- до **12 фотографий** с выбором обложки.

Цены велосипеда, компонентов и аксессуаров публикуются независимо друг от друга. По умолчанию они скрыты и не отдаются в публичный JSON.

Фотографии JPEG / PNG / WebP до 10 МБ декодируются сервером, уменьшаются максимум до 2400 px, очищаются от EXIF и сохраняются как WebP.

### Мастер добавления велосипеда

Новый велосипед создаётся в четырёх шагах:

1. **Идентификация** — тип, бренд, модель, год и версия комплектации.
2. **Поиск заводской сборки** — автоматический Bike Resolver, повторный поиск или импорт по URL.
3. **Комплектация** — проверка и редактирование найденных деталей либо ручное заполнение.
4. **Фото и параметры** — поиск фотографий, загрузка своих снимков, цвет, размер, цена, вес, пробег, описание и публичность.

До финального подтверждения запись велосипеда не создаётся. Сохранение велосипеда и компонентов выполняется транзакционно, а результат автоматического поиска берётся только из серверного preview, привязанного к пользователю.

### Bike Resolver

`services/bike-resolver` — отдельный внутренний сервис для поиска заводской комплектации и фотографий.

```text
ColaBike → Bike Resolver → официальный каталог / публичная товарная страница
```

Сейчас по умолчанию включены адаптеры:

- Specialized;
- Canyon;
- Giant.

Ещё семь адаптеров присутствуют, но отключены по умолчанию из-за недоступности источников или недостаточно надёжного определения модельного года. Их состояние и ограничения отображаются в админке.

Resolver умеет:

- искать точную заводскую спецификацию;
- отличать `resolved`, `ambiguous`, `not_found` и ошибки upstream;
- импортировать данные из публичной товарной страницы по URL;
- не перезаписывать уже существующую пользовательскую комплектацию;
- искать фотографии товара и отдавать временные безопасные кандидаты;
- кешировать результаты в PostgreSQL;
- ограничивать частоту запросов;
- блокировать локальные / служебные сети и проверять redirect/DNS для защиты от SSRF.

Подробности: [`services/bike-resolver/README.md`](services/bike-resolver/README.md).

### Админка

`/admin` доступна пользователям с ролью `admin`.

Основные разделы:

| Раздел | Возможности |
| --- | --- |
| **Обзор** | название сайта, регистрация, демонстрационный велосипед |
| **Оценка велосипедов** | база по типам, правила по компонентам, весу и цене, параметры заполненности |
| **Bike Resolver** | адаптеры, автопоиск, TTL, таймауты, интервалы, blocked domains, очистка кеша |
| **Оформление** | тема, шрифт, акцент, скругления, логотип, favicon, изображения категорий |
| **Блоки карточки** | порядок, видимость и варианты отображения содержимого |
| **Группы деталей** | группировка, иконки и порядок компонентов |
| **Тексты** | редактирование интерфейсных текстов без правки кода |
| **Справочники** | марки, модели, производители, категории и модели компонентов |
| **Пользователи** | роли, блокировка, завершение сессий, редактирование и удаление |
| **Медиа** | изображения сайта с серверной обработкой |
| **Журнал** | последние административные действия |

Оценка велосипеда — настраиваемая механика сообщества, а не техническая экспертиза совместимости. Аксессуары в неё не входят; скрытая стоимость также не влияет на публичный score.

---

## Архитектура

```mermaid
flowchart LR
    U[Browser] -->|HTTPS| P[Reverse proxy]
    P --> A[Next.js / ColaBike :3000]
    A --> DB[(PostgreSQL 17)]
    A --> PH[(photos volume)]
    A --> R[Bike Resolver :8080]
    R --> DB
    R --> WEB[Manufacturer / retailer pages]
```

Bike Resolver не публикует порт `8080` наружу: в Compose он доступен только внутри сети проекта. Его internal API не должен проксироваться в интернет.

### Стек

| Слой | Технологии |
| --- | --- |
| Web | Next.js 16, React 19, App Router |
| API | Next.js route handlers, Node.js 22 |
| Database | PostgreSQL 17 |
| Validation | Zod |
| Images | Sharp |
| UI icons | Lucide React + собственные SVG-иконки компонентов |
| Resolver | Node.js / TypeScript / Fastify / PostgreSQL |
| Containers | Docker Compose |
| CI/CD | GitHub Actions + self-hosted production runner |

---

## Быстрый локальный запуск

Нужны Docker Engine / Docker Desktop и Docker Compose.

```bash
git clone https://github.com/grayhex/cola.git
cd cola
docker compose up --build -d
```

Откройте:

```text
http://localhost:3000
```

Проверить состояние контейнеров и логи:

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f bike-resolver
```

Миграции основной БД выполняются автоматически перед запуском приложения. Resolver мигрирует свою схему при собственном старте.

Остановить проект:

```bash
docker compose down
```

Обычный `docker compose down` **не удаляет данные**. PostgreSQL и пользовательские фотографии находятся в именованных volumes `database` и `photos`.

> Не используйте `docker compose down -v`, если данные нужно сохранить.

---

## Конфигурация

Для Docker Compose `.env` необязателен при локальном запуске, но рекомендуется для любой постоянной установки.

```bash
cp .env.example .env
```

Основные переменные:

| Переменная | Назначение |
| --- | --- |
| `POSTGRES_PASSWORD` | пароль PostgreSQL |
| `APP_ORIGIN` | точный внешний origin без завершающего `/` |
| `COOKIE_SECURE` | `true` для HTTPS |
| `DATABASE_URL` | используется при локальном запуске Node вне Compose |
| `UPLOAD_DIR` | каталог фото при запуске вне Compose |
| `BIKE_RESOLVER_URL` | адрес resolver при запуске вне Compose |

Для production минимум:

```dotenv
POSTGRES_PASSWORD=use-a-long-url-safe-random-password
APP_ORIGIN=https://bike.example.com
COOKIE_SECURE=true
```

В Compose `DATABASE_URL`, `UPLOAD_DIR` и внутренний адрес Bike Resolver уже задаются контейнеру автоматически.

Если сайт открывается с другого устройства по HTTP в локальной сети, `APP_ORIGIN` должен точно совпадать с адресом в браузере, например:

```dotenv
APP_ORIGIN=http://192.168.1.20:3000
COOKIE_SECURE=false
```

---

# Production deployment

Текущий production deployment рассчитан на **Docker Compose + self-hosted GitHub Actions runner**.

Push в `main` запускает `.github/workflows/deploy.yml`, а runner выполняет:

```bash
sudo -n /usr/local/sbin/deploy-cola
```

## 1. Рабочая копия на сервере

Production-копия репозитория находится в:

```text
/opt/stacks/cola
```

Если сервер разворачивается с нуля, создайте рабочую копию в этом каталоге выбранным способом аутентификации GitHub — например SSH deploy key или уже настроенные credentials:

```bash
sudo mkdir -p /opt/stacks
sudo git clone git@github.com:grayhex/cola.git /opt/stacks/cola
cd /opt/stacks/cola
```

Этот раздел описывает существующую staging VM. Для публичного VDS используйте отдельный [production runbook](docs/OPERATIONS.md#migration-from-staging-vm-to-production-vds) и `compose.prod.yaml`. На staging **до первого запуска БД** задайте постоянный `POSTGRES_PASSWORD`.

```bash
sudo nano /opt/stacks/cola/.env
```

Пример:

```dotenv
POSTGRES_PASSWORD=replace-with-a-long-random-password
APP_ORIGIN=https://bike.example.com
COOKIE_SECURE=true
```

Первый запуск:

```bash
cd /opt/stacks/cola
sudo docker compose up -d --build --remove-orphans --wait --wait-timeout 120
sudo docker compose ps
```

## 2. Deploy script

Скрипт теперь хранится в `ops/deploy-cola`. Он выкатывает точный проверенный
commit, переданный CI, а не новый непроверенный HEAD main. Перед первым deploy
после обновления установите его на VM:

```bash
sudo install -o root -g root -m 755 ops/deploy-cola /usr/local/sbin/deploy-cola
```

Обычный вызов без аргумента повторно выкатывает последний успешно проверенный
commit. Для нового main используйте автоматический pipeline или ручной запуск
workflow. Полная инструкция: [Beta operations](docs/OPERATIONS.md).

## 3. Sudo для GitHub runner

Runner работает от пользователя `github-runner`. Ему разрешён безпарольный запуск только deploy-скрипта.

Создайте отдельное правило:

```bash
sudo visudo -f /etc/sudoers.d/cola-deploy
```

Содержимое:

```text
github-runner ALL=(root) NOPASSWD: /usr/local/sbin/deploy-cola
```

Проверка:

```bash
sudo visudo -cf /etc/sudoers.d/cola-deploy
```

## 4. Self-hosted runner

Workflow ожидает runner с label `self-hosted`.

На текущем сервере systemd-service называется:

```text
actions.runner.grayhex-cola.docker.service
```

Проверить его:

```bash
systemctl status actions.runner.grayhex-cola.docker.service
```

После push/merge в `main` GitHub Actions автоматически вызывает deploy-скрипт. Workflow использует `concurrency: cola-production`, поэтому production-деплои не выполняются параллельно.

## 5. Reverse proxy и HTTPS

Перед `:3000` должен стоять reverse proxy с HTTPS.

Рекомендуемые требования:

- внешний адрес должен совпадать с `APP_ORIGIN`;
- для HTTPS обязательно `COOKIE_SECURE=true`;
- разрешённый размер request body — не меньше **11 МБ**;
- порт Bike Resolver `8080` нельзя публиковать наружу;
- `/internal/*` resolver нельзя отдавать через reverse proxy;
- доступ к `:3000` желательно ограничить firewall'ом или сетью reverse proxy.

## 6. Первый администратор

Сначала зарегистрируйте обычный аккаунт через сайт, затем назначьте ему роль администратора.

**Команду нужно запускать из каталога проекта**, а не из `/home/github-runner/actions-runner`:

```bash
cd /opt/stacks/cola
docker compose exec app node scripts/set-admin.js you@example.com
```

Эквивалентный вариант из любого каталога:

```bash
docker compose -f /opt/stacks/cola/compose.yaml \
  --env-file /opt/stacks/cola/.env \
  exec app node scripts/set-admin.js you@example.com
```

Скрипт не создаёт аккаунт и пароль — он только назначает роль `admin` уже существующему пользователю.

---

## Обновление без GitHub Actions

Для ручного обновления production используйте тот же deploy-скрипт:

```bash
sudo /usr/local/sbin/deploy-cola
```

Для обычной локальной установки достаточно:

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans --wait
```

Миграции применятся автоматически.

---

## Резервное копирование

Сохранять нужно **оба типа данных одновременно**:

1. PostgreSQL;
2. volume `photos`.

Пример дампа БД:

```bash
cd /opt/stacks/cola
docker compose exec -T db \
  pg_dump -U colabike -d colabike -Fc > colabike-$(date +%F).dump
```

Фотографии находятся в Docker volume `photos`. Их резервную копию следует делать вместе с дампом БД, поскольку записи фотографий и файлы должны соответствовать друг другу.

Смена `POSTGRES_PASSWORD` в `.env` **не меняет пароль внутри уже созданного PostgreSQL volume**.

---

## Разработка без Docker

Требования:

- Node.js 22+;
- pnpm 11.19.0;
- доступный PostgreSQL.

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

Для локального Next.js удобно использовать `.env.local`.

Миграции вручную:

```bash
node --env-file=.env.local scripts/migrate.js
```

Или через package script, если окружение уже экспортировано:

```bash
pnpm db:migrate
```

### Bike Resolver

```bash
cd services/bike-resolver
npm ci
npm run typecheck
npm test
npm run build
```

Полная интеграционная проверка из корня проекта:

```bash
pnpm test:integration
```

Она использует временное тестовое окружение и не должна направляться на production-базу.

---

## CI

Pull request запускает `.github/workflows/check.yml`:

```text
pnpm install
  → pnpm test
  → pnpm build
  → resolver npm test + npm run build
  → pnpm test:integration
```

Deploy на self-hosted runner выполняется после успешного `check` того же commit через `needs`. CI также проверяет Chromium, mobile WebKit, Compose и восстановление backup. Ручной workflow повторяет проверки перед deploy.

---

## Безопасность

В проекте уже реализованы:

- scrypt для паролей;
- случайные сессии, которые хранятся в БД в виде SHA-256 digest;
- `HttpOnly` / `SameSite` cookies;
- `Secure` cookies в production;
- PostgreSQL-backed rate limits для auth, resolver, photo search и лайков;
- проверка `Origin` для изменяющих запросов;
- серверная Zod-валидация;
- параметризованные SQL-запросы;
- изоляция данных владельцев;
- отзыв публичной ссылки с ротацией UUID;
- запрет чтения приватных фотографий посторонними;
- re-encode пользовательских изображений вместо хранения исходного файла;
- SSRF-защита Bike Resolver.

При снятии публикации публичный URL перестаёт работать. Старый UUID не становится активным снова после повторной публикации.

---

## Ограничения текущей версии

- подтверждение email ещё не реализовано;
- восстановление пароля по email ещё не реализовано;
- OAuth нет;
- пользовательские фото хранятся локально в Docker volume, S3/object storage пока нет;
- live-доступность каталогов производителей зависит от региона, даты и антибот-защиты;
- CUBE и несколько других адаптеров присутствуют в resolver, но сейчас отключены по умолчанию из-за ненадёжного live-разрешения.

---

## Структура репозитория

```text
app/                    Next.js UI и API
lib/                    доменная логика приложения
 db/                    SQL-миграции основной БД
public/                 статические ресурсы
scripts/                миграции, admin/helper scripts, интеграционные runner'ы
services/
  bike-resolver/        отдельный сервис поиска спецификаций и фото
.github/workflows/      CI и production deploy
compose.yaml            app + PostgreSQL + Bike Resolver
Dockerfile              production image ColaBike
```

---

<div align="center">

**ColaBike** — собери байк, покажи сборку, сравнивай идеи и продолжай прокачивать велосипед.

</div>

## Подготовка публичной beta

[Эксплуатация, квоты, backup/restore и переезд на colabike.ru](docs/OPERATIONS.md).
[Аудит безопасности и оставшиеся ограничения](docs/BETA_AUDIT.md).
