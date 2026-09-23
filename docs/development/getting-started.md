# Первый день в проекте

[Оглавление](../README.md)

## Запуск без настройки Node на хосте

Нужны доступ к приватному `grayhex/cola`, Git и Docker Engine/Desktop с Compose. Используйте собственную GitHub-аутентификацию; production deploy key и `.env.production` разработчику не нужны.

```bash
git clone git@github.com:grayhex/cola.git
cd cola
# Не перезаписывает существующий локальный конфиг.
if [ ! -e .env ]; then cp .env.example .env; fi
docker compose -f compose.yaml up --build -d --wait --wait-timeout 180
docker compose -f compose.yaml ps
curl --fail --max-time 10 http://localhost:3000/api/ready
curl --fail --max-time 10 http://localhost:3000/api/status
```

Откройте `http://localhost:3000`. Для открытия с другого компьютера измените `APP_ORIGIN` в `.env` на **точный адрес браузера**, например `http://192.168.1.200:3000`, и пересоздайте `app` через Compose. Иначе POST/PATCH/PUT могут получить 403 по Origin. В обычном Compose HTTP и пароль БД по умолчанию предназначены только для локального окружения; порт 3000 опубликован не только на loopback.

`db` и Resolver не публикуют свои порты на хост. Поэтому пример `DATABASE_URL=...@localhost:5432` для host-side Node не заработает без отдельно доступной тестовой БД. Для первого знакомства используйте полный Compose.

## Первый администратор

На новой установке публичная регистрация закрыта до публикации обоих юридических документов. Владелец сервера создаёт первого администратора через CLI; пароль передаётся только по stdin, не в аргументах процесса:

```bash
read -rsp 'Пароль первого администратора (10–128 символов): ' OWNER_PASSWORD; echo
printf '%s' "$OWNER_PASSWORD" | docker compose -f compose.yaml exec -T app node scripts/bootstrap-admin.js developer@example.test "Владелец"
unset OWNER_PASSWORD
```

Команда откажет, если администратор уже есть. Войдите на `/login`, откройте **Система → Документы** и опубликуйте собственные соглашение и политику. CLI не создаёт фиктивных согласий. При обновлении существующего сайта используйте уже имеющийся административный аккаунт.

Для повышения существующего пользователя сохраняется прежняя команда:

```bash
docker compose -f compose.yaml exec app node scripts/set-admin.js developer@example.test
```

Скрипт повышает **существующего** пользователя и снимает его блокировку; он не создаёт аккаунт. Email выше — пример. Обновите страницу и откройте `/admin`. На production необходимо явно использовать `.env.production` и `compose.prod.yaml`; см. [развёртывание](../operations/deployment.md).

## Что посмотреть руками

Создайте публичный велосипед, добавьте компонент и фото. Откройте его из гостевой сессии. Создайте черновик журнала, опубликуйте и снова скройте велосипед: проверьте исчезновение записи у гостя. Импортируйте **синтетический** GPX, включите приватность старта/финиша. Посмотрите `/journal`, `/search`, `/records`, а затем соответствующий модуль из оглавления.

Resolver и внешние карты могут быть недоступны в вашей сети. Ошибка автозаполнения должна оставлять ручной ввод; ошибка подложки — SVG-маршрут. Не используйте реальные production GPX как общедоступные fixtures.

## Работа с исходниками

Для host-side разработки установите версии Node/pnpm, совместимые с [Dockerfile](../../Dockerfile) и [CI](../../.github/workflows/check.yml). В проверенном snapshot это Node 22 и pnpm 11.19.0. В корне используется pnpm, у Resolver отдельный npm lockfile:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
(cd services/bike-resolver && npm ci)
```

Для `pnpm dev` нужны отдельная БД, `DATABASE_URL`, правильный `APP_ORIGIN` и предварительный `pnpm db:migrate`. Чтобы проверить письма (восстановление пароля, подтверждение) без SMTP, задайте `MAIL_CAPTURE_DIR=./mail`: каждое письмо сохранится JSON-файлом со ссылкой. Standalone Node-скрипты не следует считать автоматически читающими `.env`; передайте окружение явно. Hot reload хостового Next не меняет уже собранный Compose-контейнер.

## Куда идти по задаче

Начните с [карты архитектуры](../architecture/overview.md). Для маршрута откройте `app/.../page.jsx`, клиентский компонент в `app/ui`, затем соответствующий `app/api/.../route.js`, входную схему и доменный `lib`. Для парсинга начните с [Resolver](../resolver/architecture.md), а не с JSX мастера. Список проверок — [тестирование](testing.md).

Рабочие данные сохраняются в named volumes. `docker compose down` и `down -v` — не одно и то же: **не добавляйте `-v` к командам для окружения с нужными данными**.
