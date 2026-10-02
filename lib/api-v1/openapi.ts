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
    description: "Сколько велосипедов вернуть на страницу.",
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
  bikeId: {
    name: "id",
    in: "path",
    required: true,
    description:
      "Идентификатор велосипеда. Он не меняется при смене приватности.",
    schema: { type: "string", format: "uuid" },
  },
};

const description = `Первый срез API ColaBike: текущий пользователь и чтение велосипедов.

**Вход.** Используется сессия, которую выдаёт вход на сайте, — HttpOnly cookie \`${SESSION_COOKIE}\`. Токены для мобильных клиентов пока не выпускаются: заголовок \`Authorization\` отклоняется ответом 401 \`unsupported_authentication\`, чтобы запрос не был молча обслужен как гостевой. Все операции этого среза читают данные; CORS не включён.

**Ошибки.** Тело ошибки — \`{ "error": { "code", "message", "details?" } }\`; клиент ветвится по \`code\`. Неизвестный адрес под \`/api/v1\` отвечает 404, неподдерживаемый метод — 405 с заголовком \`Allow\`. Каждый ответ несёт \`X-Request-ID\` для обращения в поддержку.

**Кэш.** Ответы зависят от того, кто спрашивает, и не кэшируются (\`Cache-Control: no-store\`), кроме самого документа.

**Видимость.** Публичный велосипед видят все, приватный — только владелец. Чужой приватный и несуществующий велосипед неотличимы: оба дают 404. Велосипеды заблокированных владельцев никому не видны.

**Что не входит.** Журнал, поездки, поиск, рынок и операции записи, а также токены мобильного клиента — отдельные срезы.`;

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
    },
    servers: [{ url: `${origin}/api/v1` }],
    tags: [
      { name: "Account", description: "Текущий пользователь." },
      { name: "Bikes", description: "Чтение велосипедов." },
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
          security: [{ cookieSession: [] }],
          responses: {
            "200": success("Текущий пользователь.", "Me"),
            "401": failure(
              "Нет входа или заголовок Authorization не поддерживается.",
            ),
            "500": failure("Внутренняя ошибка."),
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
          security: [{}, { cookieSession: [] }],
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
              "`scope=mine` без входа или заголовок Authorization не поддерживается.",
            ),
            "500": failure("Внутренняя ошибка."),
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
          security: [{}, { cookieSession: [] }],
          parameters: [{ $ref: "#/components/parameters/BikeId" }],
          responses: {
            "200": success("Велосипед.", "Bike"),
            "401": failure("Заголовок Authorization не поддерживается."),
            "404": failure(
              "Велосипеда нет, он приватный и чужой, или его владелец заблокирован.",
            ),
            "500": failure("Внутренняя ошибка."),
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
            "HttpOnly-сессия, которую выдаёт вход на сайте. API v1 её не выдаёт и не продлевает.",
        },
      },
    },
  };
}
