import { z } from "zod";
import { categoryFilterLabels } from "../bike-classification.ts";
import { publicOrigin } from "../public-urls.ts";
import { SESSION_COOKIE } from "../viewer-session.ts";
import { LIST_LIMIT, SEARCH_MAX, schemaRegistry } from "./schemas.ts";

// The OpenAPI 3.1 document of /api/v1 (#134). It describes exactly the
// operations that exist; there is no contract here for the rest of the site.
// Schemas come from schemas.ts, the ones tests parse real responses with, so
// the document and the answers cannot drift apart. Tests also check that its
// operations are exactly the route files under app/api/v1.

type Json = { [key: string]: unknown };

/** The version of this API contract, independent of the application's. */
export const API_VERSION = "1.0.0";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// Zod adds a fragment `$id` (invalid in JSON Schema 2020-12), repeats the
// uuid/date-time pattern next to `format`, and bounds every integer by the
// safe-integer range. The document says each once, as `format` and `type`.
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value === null || typeof value !== "object") return value;
  const source = value as Json;
  const out: Json = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "$schema" || key === "$id") continue;
    if (
      key === "pattern" &&
      ["uuid", "date-time"].includes(String(source.format))
    )
      continue;
    if (
      (key === "minimum" && child === -MAX_SAFE) ||
      (key === "maximum" && child === MAX_SAFE)
    )
      continue;
    out[key] = clean(child);
  }
  return out;
}

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({
  "application/json": { schema: schemaRef(name) },
});
const requestIdHeader = {
  "X-Request-ID": { $ref: "#/components/headers/RequestId" },
};
const success = (description: string, schema: string) => ({
  description,
  headers: requestIdHeader,
  content: json(schema),
});
const requestBody = (schema: string) => ({
  required: true,
  content: json(schema),
});
const noContent = (description: string) => ({
  description,
  headers: requestIdHeader,
});
const shared = (name: string) => ({
  $ref: `#/components/responses/${name}`,
});
const failure = (description: string) => ({
  description,
  headers: requestIdHeader,
  content: json("Error"),
});

const categories = Object.keys(categoryFilterLabels).join(", ");

const parameters = {
  scope: {
    name: "scope",
    in: "query",
    required: false,
    description:
      "`public` — публичные велосипеды; `mine` — только свои, включая приватные (нужен вход).",
    schema: { type: "string", enum: ["public", "mine"], default: "public" },
  },
  category: {
    name: "category",
    in: "query",
    required: false,
    description: `Типы велосипедов через запятую (не более 50). Допустимые ключи: ${categories}.`,
    schema: { type: "string", maxLength: 2000 },
  },
  q: {
    name: "q",
    in: "query",
    required: false,
    description: "Поиск по названию, бренду, модели и имени автора.",
    schema: { type: "string", maxLength: SEARCH_MAX },
  },
  limit: {
    name: "limit",
    in: "query",
    required: false,
    description: "Сколько элементов вернуть на страницу.",
    schema: {
      type: "integer",
      minimum: LIST_LIMIT.min,
      maximum: LIST_LIMIT.max,
      default: LIST_LIMIT.default,
    },
  },
  cursor: {
    name: "cursor",
    in: "query",
    required: false,
    description:
      "Непрозрачный курсор из `nextCursor` предыдущей страницы. Не разбирайте и не собирайте его самостоятельно.",
    schema: { type: "string", minLength: 1, maxLength: 200 },
  },
  userRef: {
    name: "ref",
    in: "path",
    required: true,
    description:
      "Человек: UUID (36 знаков) или текущий username (от 3 до 30 знаков), различие однозначно. Прежний username после переименования не распознаётся (404): стабильный ключ — `id`.",
    schema: { type: "string", minLength: 3, maxLength: 36 },
  },
  bikeId: {
    name: "id",
    in: "path",
    required: true,
    description:
      "Идентификатор велосипеда. Он не меняется при смене приватности.",
    schema: { type: "string", format: "uuid" },
  },
};

const description = `API ColaBike: вход устройств, текущий пользователь, чтение велосипедов и людей.

**Вход.** Два способа. Браузер — HttpOnly cookie \`${SESSION_COOKIE}\`, которую выдаёт вход на сайте. Нативный клиент — сессия устройства: \`POST /auth/sessions\` возвращает пару непрозрачных токенов, токен доступа (\`cola_at_…\`, 15 минут) передаётся как \`Authorization: Bearer\`, одноразовый refresh-токен (\`cola_rt_…\`) обновляется через \`POST /auth/sessions/refresh\`. Cookie и Bearer в одном запросе — 400 \`ambiguous_authentication\`; другие схемы Authorization — 401 \`unsupported_authentication\`. Просроченный токен доступа — 401 \`token_expired\`, любой другой негодный — 401 \`invalid_token\`. CORS не включён.

**Ошибки.** Тело ошибки — \`{ "error": { "code", "message", "details?" } }\`; клиент ветвится по \`code\`. Неизвестный адрес под \`/api/v1\` отвечает 404, неподдерживаемый метод — 405 с заголовком \`Allow\`. Каждый ответ несёт \`X-Request-ID\` для обращения в поддержку.

**Кэш.** Ответы зависят от того, кто спрашивает, и не кэшируются (\`Cache-Control: no-store\`), кроме самого документа.

**Видимость.** Публичный велосипед видят все, приватный — только владелец. Чужой приватный и несуществующий велосипед неотличимы: оба дают 404. Велосипеды заблокированных владельцев никому не видны.

**Что не входит.** Журнал, поездки, поиск, рынок и операции записи, а также нативный вход через внешних провайдеров — отдельные срезы.`;

export function buildOpenApiDocument(origin: string = publicOrigin()): Json {
  const { schemas } = z.toJSONSchema(schemaRegistry, {
    target: "draft-2020-12",
    io: "output",
    uri: (id) => `#/components/schemas/${id}`,
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "ColaBike API",
      version: API_VERSION,
      description,
      license: {
        name: "Пользовательское соглашение ColaBike",
        url: `${origin}/legal/terms`,
      },
    },
    servers: [{ url: `${origin}/api/v1` }],
    tags: [
      { name: "Account", description: "Текущий пользователь." },
      {
        name: "Sessions",
        description: "Вход устройства, обновление токенов и список сессий.",
      },
      { name: "Bikes", description: "Чтение велосипедов." },
      {
        name: "Users",
        description: "Публичные профили, их велосипеды и подписки.",
      },
      { name: "Contract", description: "Описание самого API." },
    ],
    paths: {
      "/me": {
        get: {
          operationId: "getMe",
          tags: ["Account"],
          summary: "Текущий пользователь",
          description:
            "Только явно перечисленные поля. Без входа, с заблокированным аккаунтом и с истёкшей сессией — 401.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          responses: {
            "200": success("Текущий пользователь.", "Me"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/bikes": {
        get: {
          operationId: "listBikes",
          tags: ["Bikes"],
          summary: "Список велосипедов",
          description:
            "Новые сверху. Страницы идут по курсору, а не по номеру: велосипед, опубликованный во время просмотра, не сдвигает следующую страницу, ничто не повторяется и не пропускается. Общего количества нет. Чужие приватные велосипеды и велосипеды заблокированных владельцев не попадают в список никогда.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Scope" },
            { $ref: "#/components/parameters/Category" },
            { $ref: "#/components/parameters/Query" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница велосипедов.", "BikePage"),
            "400": failure(
              "Неверный параметр: неизвестный, повторённый, вне диапазона или неверный курсор.",
            ),
            "401": failure(
              "`scope=mine` без входа, недействительный или истёкший токен, либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/bikes/{id}": {
        get: {
          operationId: "getBike",
          tags: ["Bikes"],
          summary: "Карточка велосипеда",
          description:
            "Публичный велосипед виден всем. Приватный — только владельцу, остальные получают 404. Владелец видит свои цены и настройки их показа; остальные — только цены, которые владелец разрешил показывать.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/BikeId" }],
          responses: {
            "200": success("Велосипед.", "Bike"),
            "401": failure(
              "Недействительный или истёкший токен, либо схема Authorization не поддерживается.",
            ),
            "404": failure(
              "Велосипеда нет, он приватный и чужой, или его владелец заблокирован.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/auth/sessions": {
        post: {
          operationId: "createSession",
          tags: ["Sessions"],
          summary: "Вход с устройства",
          description:
            "Почта и пароль, как на сайте (те же ограничения частоты и блокировки), плюс описание устройства. Возвращает сессию устройства и пару токенов. Токены показываются только в этом ответе. Подтверждённая почта для входа не нужна, как и в вебе. Одновременно у человека не больше 20 сессий устройств: самая давно не использованная завершается.",
          security: [],
          requestBody: requestBody("CreateSessionRequest"),
          responses: {
            "201": success("Сессия устройства и токены.", "SessionGrant"),
            "400": failure("Неверное тело запроса."),
            "401": failure(
              "`invalid_credentials`: неверная почта или пароль либо аккаунт заблокирован; ответ одинаков во всех этих случаях.",
            ),
            "429": failure("Слишком много попыток; заголовок `Retry-After`."),
            "500": shared("InternalError"),
          },
        },
        get: {
          operationId: "listSessions",
          tags: ["Sessions"],
          summary: "Сессии аккаунта",
          description:
            "Браузеры и устройства со входом: сначала текущая сессия, затем по последней активности. Хешей и токенов в ответе нет.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          responses: {
            "200": success("Активные сессии.", "SessionList"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure("Нет входа или токен недействителен либо истёк."),
            "500": shared("InternalError"),
          },
        },
      },
      "/auth/sessions/refresh": {
        post: {
          operationId: "refreshSession",
          tags: ["Sessions"],
          summary: "Обновление токенов",
          description:
            "Refresh-токен одноразовый: ответ содержит новую пару, а старый refresh-токен больше не работает. Предъявление уже заменённого токена вне короткого допуска на потерянный ответ считается кражей и завершает сессию. Обновляйте токены в один поток: два параллельных запроса одним токеном оставят в силе только последнюю выданную пару. Любая ошибка отвечает `invalid_token`: клиент возвращается ко входу.",
          security: [],
          requestBody: requestBody("RefreshRequest"),
          responses: {
            "200": success("Новая пара токенов.", "SessionGrant"),
            "400": failure("Неверное тело запроса."),
            "401": failure(
              "`invalid_token`: токен неизвестен, просрочен, использован повторно, или аккаунт заблокирован.",
            ),
            "429": failure(
              "Слишком много обновлений; заголовок `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/auth/sessions/current": {
        delete: {
          operationId: "revokeCurrentSession",
          tags: ["Sessions"],
          summary: "Выход на этом устройстве",
          description:
            "Завершает сессию, которой сделан запрос. С cookie требует заголовок Origin сайта (защита от CSRF); с Bearer-токеном он не нужен.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          responses: {
            "204": noContent("Сессия завершена."),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure("Нет входа или токен недействителен либо истёк."),
            "403": failure("Cookie без допустимого заголовка Origin."),
            "500": shared("InternalError"),
          },
        },
      },
      "/auth/sessions/{id}": {
        delete: {
          operationId: "revokeSession",
          tags: ["Sessions"],
          summary: "Завершить сессию",
          description:
            "Завершает любую сессию своего аккаунта по её публичному идентификатору (из списка сессий). Чужая и несуществующая сессия неотличимы: 404.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/SessionId" }],
          responses: {
            "204": noContent("Сессия завершена."),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure("Нет входа или токен недействителен либо истёк."),
            "403": failure("Cookie без допустимого заголовка Origin."),
            "404": failure("Такой сессии у аккаунта нет."),
            "500": shared("InternalError"),
          },
        },
      },
      "/users/{ref}": {
        get: {
          operationId: "getUser",
          tags: ["Users"],
          summary: "Публичный профиль",
          description:
            "Имя, username, аватар, «о себе», место, дата регистрации и счётчики (публичные велосипеды, подписчики, подписки без заблокированных людей). `relationship` — отношения вошедшего зрителя с человеком, для гостя null. Почта, настройки и роль не передаются никогда. Заблокированный человек, неизвестный `{ref}` и прежний username неотличимы: 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/UserRef" }],
          responses: {
            "200": success("Профиль.", "Profile"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/users/{ref}/bikes": {
        get: {
          operationId: "listUserBikes",
          tags: ["Users"],
          summary: "Публичные велосипеды человека",
          description:
            "Та же страница `BikePage` и то же правило видимости, что у `/bikes`, но только велосипеды одного владельца; новые сверху, курсор. Приватные велосипеды сюда не попадают, даже когда спрашивает сам владелец: свои, включая приватные, — `/bikes?scope=mine`.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/UserRef" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница велосипедов.", "BikePage"),
            "400": failure(
              "Неверный параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/users/{ref}/followers": {
        get: {
          operationId: "listFollowers",
          tags: ["Users"],
          summary: "Подписчики",
          description:
            "Кто подписан на человека: новые подписки сверху (время подписки, затем id), курсор, без общего количества — оно в `Profile.counts`. Подписка, добавленная во время просмотра, не сдвигает следующие страницы. Заблокированные люди в списке не появляются.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/UserRef" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница людей.", "UserPage"),
            "400": failure(
              "Неверный параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/users/{ref}/following": {
        get: {
          operationId: "listFollowing",
          tags: ["Users"],
          summary: "Подписки",
          description:
            "На кого подписан человек; порядок, курсор и правила те же, что у подписчиков.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/UserRef" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница людей.", "UserPage"),
            "400": failure(
              "Неверный параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/openapi.json": {
        get: {
          operationId: "getOpenApiDocument",
          tags: ["Contract"],
          summary: "Этот документ",
          description:
            "OpenAPI 3.1 для реально реализованных операций. Адрес сервера берётся из настройки сайта, не из заголовков запроса.",
          security: [],
          responses: {
            "200": {
              description: "Документ OpenAPI 3.1.",
              headers: requestIdHeader,
              content: { "application/json": { schema: { type: "object" } } },
            },
            "405": failure("Другой метод: разрешены GET, HEAD и OPTIONS."),
          },
        },
      },
    },
    components: {
      schemas: clean(schemas) as Json,
      parameters: {
        Scope: parameters.scope,
        Category: parameters.category,
        Query: parameters.q,
        Limit: parameters.limit,
        Cursor: parameters.cursor,
        BikeId: parameters.bikeId,
        UserRef: parameters.userRef,
        SessionId: {
          name: "id",
          in: "path",
          required: true,
          description: "Публичный идентификатор сессии из списка сессий.",
          schema: { type: "string", format: "uuid" },
        },
      },
      responses: {
        InternalError: failure("Внутренняя ошибка, код `internal_error`."),
        NotFound: failure(
          "Такого объекта нет или он вам недоступен: приватный, чужой, скрытый, заблокированного владельца; ответ одинаков во всех этих случаях.",
        ),
      },
      headers: {
        RequestId: {
          description: "Идентификатор запроса для обращения в поддержку.",
          schema: { type: "string", format: "uuid" },
        },
      },
      securitySchemes: {
        cookieSession: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description:
            "HttpOnly-сессия, которую выдаёт вход на сайте. API v1 её не выдаёт и не продлевает. Для изменяющих запросов нужен заголовок Origin сайта.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "cola_at_… (непрозрачный токен доступа)",
          description:
            "Токен доступа сессии устройства из `POST /auth/sessions` (15 минут по умолчанию). Просроченный — 401 `token_expired`, обновите его `POST /auth/sessions/refresh`; недействительный или отозванный — 401 `invalid_token`, нужен новый вход. Заголовок `Authorization` вместе с cookie сессии отвергается (400 `ambiguous_authentication`).",
        },
      },
    },
  };
}
