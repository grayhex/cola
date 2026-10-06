import { z } from "zod";
import { categoryFilterLabels } from "../bike-classification.ts";
import { publicOrigin } from "../public-urls.ts";
import { SESSION_COOKIE } from "../viewer-session.ts";
import {
  LIST_LIMIT,
  SEARCH_MAX,
  componentCatalogQuerySchema,
  marketQuerySchema,
  chatPeopleQuerySchema,
  componentSearchQuerySchema,
  experienceQuerySchema,
  feedQuerySchema,
  notificationsQuerySchema,
  schemaRegistry,
  usersSearchQuerySchema,
} from "./schemas.ts";

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

// What each parameter of the generated query lists says. The schema in
// schemas.ts is the parser, so the names, values and bounds cannot drift from
// the code; only the sentences are written here.
const queryNotes: Record<string, string> = {
  q: "Текст поиска, до 150 знаков; без учёта регистра и формы записи, с правилами написания каталога.",
  category: "Тип велосипеда (ключ из фильтра витрины).",
  exact: "`1` — точное совпадение модели и компонента вместо вхождения.",
  brand: "Бренд велосипеда.",
  model: "Модель велосипеда.",
  component: "Название компонента.",
  componentCategory: "Категория компонента.",
  bikeModelId: "Модель каталога велосипедов (UUID).",
  componentModelId: "Модель каталога компонентов (UUID).",
  year: "Модельный год.",
  purpose: "Назначение велосипеда (ключ каталога).",
  kind: "Тип записи журнала: build, service, review, question, story.",
  similar:
    "Идентификатор публичного велосипеда: ищутся похожие на него (его бренд, модель, назначение и категория).",
  sort: "`new` — по появлению в каталоге (по умолчанию), `popular` — по числу сборок.",
  subtype: "Подтип по классификации.",
  suspension: "Подвеска по классификации.",
  construction: "Конструкция по классификации.",
  use: "Назначение по классификации.",
  electric: "`1` — электро, `0` — без электропривода.",
  fatbike: "`1` — Fatbike, `0` — не Fatbike.",
};
/** Query parameters of an operation, from the schema its parser uses. */
function queryParameters(
  schema: z.ZodType,
  skip: string[] = [],
  notes: Record<string, string> = {},
): Json[] {
  const converted = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as { properties: Record<string, Json>; required?: string[] };
  return Object.entries(converted.properties)
    .filter(([name]) => !skip.includes(name))
    .map(([name, definition]) => ({
      name,
      in: "query",
      required: converted.required?.includes(name) ?? false,
      ...((notes[name] ?? queryNotes[name])
        ? { description: notes[name] ?? queryNotes[name] }
        : {}),
      schema: optionalForm(clean(definition) as Json),
    }));
}
/**
 * The parser takes an empty value as "not given". The document says it by
 * leaving the parameter out, which also keeps "" out of enums: a generator
 * cannot make a name of it (Kotlin enums with an empty member do not compile).
 */
function optionalForm(schema: Json): Json {
  const { anyOf, default: fallback, enum: values, ...rest } = schema;
  const out: Json = { ...rest };
  if (fallback !== "" && fallback !== undefined) out.default = fallback;
  if (Array.isArray(values)) out.enum = values.filter((value) => value !== "");
  else if (values !== undefined) out.enum = values;
  if (Array.isArray(anyOf)) {
    const left = (anyOf as Json[]).filter((option) => option.const !== "");
    return left.length === 1 ? { ...left[0], ...out } : { ...out, anyOf: left };
  }
  return out;
}
const SAVE_RESPONSES = {
  "200": success("Итоговое состояние избранного.", "MarketSaved"),
  "400": failure("Одновременно cookie сессии и заголовок Authorization."),
  "401": failure(
    "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
  ),
  "403": failure("Cookie-запрос не с адреса сайта (нужен заголовок `Origin`)."),
  "404": failure("Объявление недоступно."),
  "429": failure(
    "Слишком много действий; секунды до конца окна — в `Retry-After`.",
  ),
  "500": shared("InternalError"),
};
// The market's own sentences for names the other lists use in another sense.
const marketNotes: Record<string, string> = {
  q: "Текст поиска по названию, описанию и месту, до 150 знаков; без учёта регистра.",
  category: "Категория объявления.",
  type: "Намерение: sale — продам, wanted — куплю, exchange — обмен, free — отдам даром.",
  condition: "Состояние товара.",
  price_min:
    "Цена от, целые рубли. Объявления без цены в выборку с границей не попадают.",
  price_max:
    "Цена до, целые рубли. Объявления без цены в выборку с границей не попадают.",
  city: "Часть названия места, без учёта регистра.",
  seller:
    "Username продавца: объявления одного человека. Неизвестный и заблокированный продавец — 404.",
  sort: "`new` — новые сверху (по умолчанию), `price_asc` — дешевле сверху, `price_desc` — дороже сверху; объявления без цены в конце. Курсор одного порядка в другом — 400.",
};
const notificationNotes: Record<string, string> = {
  unread: "`1` — только непрочитанные.",
  category:
    "Одна категория: rides — покатушки и приглашения, discussions — комментарии и ответы, market — объявления, reactions — подписки и лайки, site — от ColaBike.",
};
const feedNotes: Record<string, string> = {
  type: "`all` — всё; `rides` — только покатушки; `journal` — только записи журнала.",
};
const refs = (...names: string[]) =>
  names.map((name) => ({ $ref: `#/components/parameters/${name}` }));

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
  journalId: {
    name: "id",
    in: "path",
    required: true,
    description: "Идентификатор записи журнала (UUID).",
    schema: { type: "string", format: "uuid" },
  },
  commentId: {
    name: "commentId",
    in: "path",
    required: true,
    description: "Идентификатор комментария (UUID).",
    schema: { type: "string", format: "uuid" },
  },
  marketListingId: {
    name: "id",
    in: "path",
    required: true,
    description: "Идентификатор объявления (UUID).",
    schema: { type: "string", format: "uuid" },
  },
  componentModelId: {
    name: "id",
    in: "path",
    required: true,
    description: "Идентификатор модели компонента (UUID).",
    schema: { type: "string", format: "uuid" },
  },
  rideText: {
    name: "q",
    in: "query",
    required: false,
    description:
      "Текст: ищется в названии, описании, имени и username автора и названии велосипеда; без учёта регистра и формы записи.",
    schema: { type: "string", maxLength: 150 },
  },
  rideId: {
    name: "id",
    in: "path",
    required: true,
    description: "Идентификатор покатушки (UUID).",
    schema: { type: "string", format: "uuid" },
  },
  focus: {
    name: "focus",
    in: "query",
    required: false,
    description:
      "Идентификатор комментария для глубокой ссылки. Ответ — ветка его корня (в `items` один корень со своими ответами) и цепочка от корня до комментария в `focusPath`; страниц больше нет, поэтому вместе с `cursor` параметр не принимается.",
    schema: { type: "string", format: "uuid" },
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

const description = `API ColaBike: вход устройств, текущий пользователь, чтение велосипедов, людей, журнала, покатушек и комментариев, настройки приложения.

**Вход.** Два способа. Браузер — HttpOnly cookie \`${SESSION_COOKIE}\`, которую выдаёт вход на сайте. Нативный клиент — сессия устройства: \`POST /auth/sessions\` возвращает пару непрозрачных токенов, токен доступа (\`cola_at_…\`, 15 минут) передаётся как \`Authorization: Bearer\`, одноразовый refresh-токен (\`cola_rt_…\`) обновляется через \`POST /auth/sessions/refresh\`. Cookie и Bearer в одном запросе — 400 \`ambiguous_authentication\`; другие схемы Authorization — 401 \`unsupported_authentication\`. Просроченный токен доступа — 401 \`token_expired\`, любой другой негодный — 401 \`invalid_token\`. CORS не включён.

**Ошибки.** Тело ошибки — \`{ "error": { "code", "message", "details?" } }\`; клиент ветвится по \`code\`. Неизвестный адрес под \`/api/v1\` отвечает 404, неподдерживаемый метод — 405 с заголовком \`Allow\`. Каждый ответ несёт \`X-Request-ID\` для обращения в поддержку.

**Кэш.** Ответы зависят от того, кто спрашивает, и не кэшируются (\`Cache-Control: no-store\`). Исключения — сам документ и настройки приложения \`/app-config\`: они одинаковы для всех; настройки свежи минуту, затем проверяются по \`ETag\` (304 без тела).

**Изображения.** Адреса фото (\`url\`, \`avatarUrl\`, \`coverUrl\`) — пути сайта относительно его адреса. Публичные открываются без входа; приватные (фото закрытого велосипеда, картинки черновика журнала) — владельцу, с тем же \`Authorization: Bearer\` (или cookie), что и API; чужому и гостю — 404, недействительному токену — 401. Ответы зависят от зрителя (\`Vary: Cookie, Authorization\`), поддерживают \`ETag\`/304 и \`?width=\`.

**Видимость.** Публичный велосипед видят все, приватный — только владелец. Чужой приватный и несуществующий велосипед неотличимы: оба дают 404. Велосипеды заблокированных владельцев никому не видны.

**Что не входит.** Личные ответы владельца о покатушках, участие в них, поиск, рынок и операции записи, а также нативный вход через внешних провайдеров — отдельные срезы.`;

// Writing comments (#330): one set of operations for the four objects that have
// comments, added to the paths of their reads.
const commentTargets = [
  { path: "bikes", id: "BikeId", name: "велосипеда", tag: "Bike" },
  { path: "journal", id: "JournalId", name: "записи журнала", tag: "Journal" },
  { path: "rides", id: "RideId", name: "покатушки", tag: "Ride" },
  {
    path: "component-models",
    id: "ComponentModelId",
    name: "модели компонента",
    tag: "Component",
  },
] as const;
const writeFailures = (extra: Json = {}) => ({
  "400": failure(
    "Тело не разобрано или не подходит, неверный `Idempotency-Key` либо cookie вместе с Authorization.",
  ),
  "401": failure(
    "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
  ),
  "403": failure(
    "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`), почта не подтверждена (`email_verification_required`) или чужой комментарий (`forbidden`).",
  ),
  "404": shared("NotFound"),
  ...extra,
  "413": failure("Тело больше 8192 байт."),
  "415": failure("Тело не `application/json`."),
  "429": failure(
    "Слишком много действий; секунды до конца окна — в `Retry-After`.",
  ),
  "500": shared("InternalError"),
});
const chatFailures = (extra: Json = {}) => ({
  "400": failure(
    "Параметры или тело не подходят либо cookie вместе с Authorization.",
  ),
  "401": failure(
    "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
  ),
  "403": failure(
    "Cookie-запрос на изменение не с адреса сайта (нужен заголовок `Origin`) или почта не подтверждена (`email_verification_required`).",
  ),
  ...extra,
  "429": failure(
    "Слишком много запросов; секунды до конца окна — в `Retry-After`.",
  ),
  "500": shared("InternalError"),
  "503": failure(
    "Сообщения отключены или сервис чата недоступен (`service_unavailable`): основной сайт работает, повторите позже.",
  ),
});
function withChat(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  paths["/chat/token"] = {
    post: {
      operationId: "createChatToken",
      tags: ["Chat"],
      summary: "Токен для Stream Chat",
      description:
        "Подключает человека к чату: регистрирует его профиль у провайдера и выдаёт короткоживущий токен (5 минут) с публичным ключом приложения. Секрет приложения не возвращается никогда. Нужна подтверждённая почта; сессия проверяется ещё раз, отозванная — 401. Тела нет. Когда токен истёк, клиент запрашивает новый.",
      security,
      parameters: [],
      responses: {
        "200": success("Данные для подключения.", "ChatToken"),
        ...chatFailures(),
      },
    },
  };
  paths["/chat/channels"] = {
    post: {
      operationId: "createChatChannel",
      tags: ["Chat"],
      summary: "Создать или открыть канал",
      description:
        "Личный диалог открывается повторно тем же каналом; группа создаётся новой. Нельзя написать себе, заблокированному и тому, у кого не подтверждена почта (404). С заголовком `Idempotency-Key` (UUID) повтор того же запроса в течение суток отдаёт тот же канал (`Idempotency-Replayed: true`), а не вторую группу; тот же ключ с другим телом — 409 `conflict`. Бюджет — 10 за окно, общий с сайтом.",
      security,
      parameters: [],
      requestBody: requestBody("CreateChatChannelRequest"),
      responses: {
        "201": success("Канал создан или открыт.", "ChatChannel"),
        ...chatFailures({
          "404": failure("Участник недоступен для сообщений."),
          "409": failure("`Idempotency-Key` уже использован с другим телом."),
          "413": failure("Тело больше 4096 байт."),
          "415": failure("Тело не `application/json`."),
        }),
      },
    },
  };
  paths["/chat/people"] = {
    get: {
      operationId: "listChatPeople",
      tags: ["Chat"],
      summary: "Кому написать",
      description:
        "Без `q` — те, на кого подписан человек; с `q` (от 2 знаков, до 80) — поиск по имени и логину, не больше 20 человек. Только подтверждённые и не заблокированные.",
      security,
      parameters: queryParameters(chatPeopleQuerySchema, [], {
        q: "Часть имени или логина; пусто — те, на кого вы подписаны.",
      }),
      responses: {
        "200": success("Люди, которым можно написать.", "ChatPeople"),
        ...chatFailures(),
      },
    },
  };
  paths["/chat/unread"] = {
    get: {
      operationId: "getChatUnread",
      tags: ["Chat"],
      summary: "Непрочитанные сообщения",
      description:
        "Общее число непрочитанных у провайдера; 0, пока человек не подключался к чату.",
      security,
      parameters: [],
      responses: {
        "200": success("Число непрочитанных.", "ChatUnread"),
        ...chatFailures(),
      },
    },
  };
}
function withCommentWrites(document: Json) {
  const paths = document.paths as Record<string, Json>;
  for (const target of commentTargets) {
    const collection = `/${target.path}/{id}/comments`;
    const item = `${collection}/{commentId}`;
    const id = { $ref: `#/components/parameters/${target.id}` };
    const commentId = { $ref: "#/components/parameters/CommentId" };
    const security = [{ cookieSession: [] }, { bearerAuth: [] }];
    paths[collection] = {
      ...paths[collection],
      post: {
        operationId: `create${target.tag}Comment`,
        tags: ["Comments"],
        summary: `Написать комментарий к объекту: ${target.name}`,
        description:
          "Новый комментарий или ответ (`parentId`). Нужна подтверждённая почта. Бюджет новых комментариев общий с сайтом (20 за окно). С заголовком `Idempotency-Key` (UUID) повтор того же запроса в течение суток отдаёт тот же комментарий (заголовок `Idempotency-Replayed: true`), а не второй; тот же ключ с другим телом — 409 `conflict`. Права и уведомления те же, что на сайте: комментировать можно только публичное, заблокированный автор и заблокированный владелец — 404.",
        security,
        parameters: [id],
        requestBody: requestBody("CreateCommentRequest"),
        responses: {
          "201": success("Комментарий создан.", "Comment"),
          ...writeFailures({
            "409": failure("`Idempotency-Key` уже использован с другим телом."),
          }),
        },
      },
    };
    paths[item] = {
      patch: {
        operationId: `edit${target.tag}Comment`,
        tags: ["Comments"],
        summary: `Исправить свой комментарий: ${target.name}`,
        description:
          "Правит текст своего комментария; чужой — 403, удалённый — 404. Комментарий должен принадлежать объекту из пути. Условного обновления (`If-Match`) нет: правит один автор, и последняя правка побеждает. Нужна подтверждённая почта.",
        security,
        parameters: [id, commentId],
        requestBody: requestBody("EditCommentRequest"),
        responses: {
          "200": success("Комментарий после правки.", "Comment"),
          ...writeFailures(),
        },
      },
      delete: {
        operationId: `delete${target.tag}Comment`,
        tags: ["Comments"],
        summary: `Удалить комментарий: ${target.name}`,
        description:
          "Удаляет свой комментарий (администратор — любой, с записью в журнал аудита): остаётся «надгробие», пока под ним есть читаемые ответы. Повтор удаления тоже 204. Подтверждённая почта не нужна.",
        security,
        parameters: [id, commentId],
        responses: {
          "204": noContent("Комментарий удалён."),
          ...writeFailures(),
        },
      },
    };
  }
}

// Planning together (#343): intentions to ride and one's own part in a planned ride.
const intentEtag = {
  ...requestIdHeader,
  ETag: {
    description: "Версия намерения: для `If-Match` следующей замены.",
    schema: { type: "string" },
  },
};
const intentFailures = (extra: Json = {}) => ({
  "400": failure(
    "Тело, параметры или `Idempotency-Key` не подходят, окна нарушают правила (пересекаются, дальше 90 дней, дольше 24 часов, время не существует при переводе часов) либо cookie вместе с Authorization.",
  ),
  "401": failure(
    "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
  ),
  "403": failure(
    "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) либо публикация сообществу без подтверждённой почты (`email_verification_required`).",
  ),
  "404": shared("NotFound"),
  ...extra,
  "413": failure("Тело больше 8192 байт."),
  "415": failure("Тело не `application/json`."),
  "429": failure(
    "Слишком много действий; секунды до конца окна — в `Retry-After`.",
  ),
  "500": shared("InternalError"),
});
function withPlanning(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  const intentId = { $ref: "#/components/parameters/RideIntentId" };
  const readFailures = {
    "400": failure("Параметры не подходят либо cookie вместе с Authorization."),
    "401": failure(
      "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
    ),
    "500": shared("InternalError"),
  };
  paths["/me/ride-intents"] = {
    get: {
      operationId: "listOwnRideIntents",
      tags: ["Planning"],
      summary: "Мои намерения покататься",
      description:
        "Свои намерения в любом состоянии, кроме удалённых: действующие, отменённые и те, у которых окна прошли (`status`). Новые сверху, курсор по `(время создания, id)`.",
      security,
      parameters: refs("Limit", "Cursor"),
      responses: {
        "200": success("Страница своих намерений.", "RideIntentPage"),
        ...readFailures,
      },
    },
  };
  paths["/ride-intents"] = {
    get: {
      operationId: "listCommunityRideIntents",
      tags: ["Planning"],
      summary: "Намерения сообщества",
      description:
        "Действующие намерения, которые авторы опубликовали для сообщества и окна которых ещё не закончились. Только для вошедших; заблокированные авторы не видны. Включает и свои опубликованные (`own: true`). Новые сверху, курсор по `(время создания, id)`. Намерение — не мероприятие: ответить «Иду» на него нельзя, можно открыть автора и договориться.",
      security,
      parameters: refs("Limit", "Cursor"),
      responses: {
        "200": success("Страница намерений сообщества.", "RideIntentPage"),
        ...readFailures,
      },
    },
    post: {
      operationId: "createRideIntent",
      tags: ["Planning"],
      summary: "Создать намерение покататься",
      description:
        "Заголовок `Idempotency-Key` (UUID) обязателен и есть личность намерения: повтор того же запроса отдаёт то же намерение (`Idempotency-Replayed: true`), а не второе; тот же ключ с другим телом — 409 `conflict`. Не больше 5 действующих намерений (409). Для `visibility: community` нужна подтверждённая почта. Гараж не нужен. Публикация, готовность и истечение окон вызывают те же уведомления друзьям, что и на сайте; отдельной отправки здесь нет. Бюджет — 40 за окно, общий с сайтом.",
      security,
      parameters: [],
      requestBody: requestBody("RideIntentRequest"),
      responses: {
        "201": {
          description: "Намерение создано.",
          headers: intentEtag,
          content: json("RideIntent"),
        },
        "200": {
          description:
            "Повтор после того, как ключ уже забыт, но намерение есть: то же намерение.",
          headers: intentEtag,
          content: json("RideIntent"),
        },
        ...intentFailures({
          "409": failure(
            "`Idempotency-Key` уже использован с другим телом либо активных намерений уже 5.",
          ),
        }),
      },
    },
  };
  paths["/ride-intents/{id}"] = {
    get: {
      operationId: "getRideIntent",
      tags: ["Planning"],
      summary: "Намерение покататься",
      description:
        "Своё — в любом состоянии, кроме удалённого. Чужое — только опубликованное для сообщества, действующее и с не закончившимися окнами. Недоступное, удалённое, заблокированного автора и несуществующее одинаково 404.",
      security,
      parameters: [intentId],
      responses: {
        "200": {
          description: "Намерение.",
          headers: intentEtag,
          content: json("RideIntent"),
        },
        ...readFailures,
        "404": shared("NotFound"),
      },
    },
    put: {
      operationId: "replaceRideIntent",
      tags: ["Planning"],
      summary: "Заменить своё намерение",
      description:
        "Полная замена: окна, район, готовность, видимость. `If-Match` с `ETag` необязателен: с ним замена применяется только к версии, которую клиент видел (412, если другое устройство успело раньше). Отменённое намерение не правится (409): создайте новое. Публикация сообществу — с подтверждённой почтой. Бюджет общий с созданием.",
      security,
      parameters: [
        intentId,
        {
          name: "If-Match",
          in: "header",
          required: false,
          description:
            "`ETag` намерения, которое клиент видел: при другой версии — 412.",
          schema: { type: "string" },
        },
      ],
      requestBody: requestBody("RideIntentRequest"),
      responses: {
        "200": {
          description: "Намерение после замены.",
          headers: intentEtag,
          content: json("RideIntent"),
        },
        ...intentFailures({
          "409": failure(
            "Намерение отменено, либо замена оставила бы больше 5 действующих.",
          ),
          "412": failure(
            "`If-Match` не совпал с текущей версией: прочитайте намерение снова.",
          ),
        }),
      },
    },
    delete: {
      operationId: "deleteRideIntent",
      tags: ["Planning"],
      summary: "Удалить своё намерение",
      description:
        "Убирает намерение и его окна; остаётся только отметка, по которой запоздалый повтор создания не воскресит его. Повтор тоже 204. Чужое и несуществующее — 404.",
      security,
      parameters: [intentId],
      responses: {
        "204": noContent("Намерение удалено."),
        "401": failure(
          "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
        ),
        "403": failure(
          "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`).",
        ),
        "404": shared("NotFound"),
        "429": failure(
          "Слишком много действий; секунды до конца окна — в `Retry-After`.",
        ),
        "500": shared("InternalError"),
      },
    },
  };
  paths["/ride-intents/{id}/cancel"] = {
    post: {
      operationId: "cancelRideIntent",
      tags: ["Planning"],
      summary: "Отменить своё намерение",
      description:
        "Снимает намерение с публикации и закрывает его: оно остаётся в своём списке со статусом `cancelled`, ожидающие уведомления о нём не уходят. Повтор тоже 200. Тела нет.",
      security,
      parameters: [intentId],
      responses: {
        "200": {
          description: "Отменённое намерение.",
          headers: intentEtag,
          content: json("RideIntent"),
        },
        ...intentFailures(),
      },
    },
  };
  const rideId = { $ref: "#/components/parameters/RideId" };
  paths["/rides/{id}/participation"] = {
    get: {
      operationId: "getRideParticipation",
      tags: ["Planning"],
      summary: "Моё участие в покатушке",
      description:
        "Как человек связан с планом и его датой: ближайшая дата и часовой пояс, редакция условий (`agreement.revision`) и что в ней изменилось, набор, мой ответ, приглашение, `changedAfterAnswer`, разрешённая точка встречи, что сервер сейчас примет (`allowedResponses`). `occurrenceAt` — дата из уведомления: ответ говорит, текущая она, перенесена, отменена или прошла. Это то, что открывает уведомление о закрытом приглашении, изменении или отмене: читать может организатор, приглашённый и тот, кому доступен публичный план; ответивший на отменённый план видит лишь, что он отменён. Публичную карточку `GET /rides/{id}` это не расширяет, имён участников здесь нет. Недоступный, чужой закрытый и несуществующий план одинаково 404.",
      security,
      parameters: [
        rideId,
        {
          name: "occurrenceAt",
          in: "query",
          required: false,
          description:
            "Дата выезда (`scheduledAt`, `target.occurrenceAt` уведомления), любой допустимый вид даты со смещением.",
          schema: { type: "string", format: "date-time" },
        },
      ],
      responses: {
        "200": success("Участие человека.", "RideParticipation"),
        ...readFailures,
        "404": shared("NotFound"),
      },
    },
    put: {
      operationId: "respondToRide",
      tags: ["Planning"],
      summary: "Ответить на покатушку",
      description:
        "«Иду», «возможно» или «не иду» на одну дату — тем условиям, которые человек видел: `occurrenceAt` из `scheduledAt` и, для «иду» и «возможно», `expectedAgreementRevision` из `agreement.revision`. Если дата или условия уже другие, организатор закрыл набор или организатор отвечает на свой план, ответ не принимается: 409 с `current` — состоянием как оно есть сейчас, чтобы человек решил заново; молча подтвердить новые условия сервер не может. Выйти («не иду») можно всегда. Повтор того же ответа ничего не меняет. Велосипед не нужен; подтверждённая почта — как на сайте, не нужна. Бюджет — 20 за окно, общий с сайтом.",
      security,
      parameters: [rideId],
      requestBody: requestBody("RideParticipationRequest"),
      responses: {
        "200": success("Участие после ответа.", "RideParticipation"),
        "400": failure(
          "Тело не подходит (для «иду» и «возможно» нужен `expectedAgreementRevision`) либо cookie вместе с Authorization.",
        ),
        "401": failure(
          "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
        ),
        "403": failure(
          "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`).",
        ),
        "404": shared("NotFound"),
        "409": {
          description:
            "Ответ не принят: дата или условия изменились, набор закрыт либо организатор отвечает на свой план. `current` — состояние сейчас (null, если план стал недоступен).",
          headers: requestIdHeader,
          content: json("RideParticipationConflict"),
        },
        "413": failure("Тело больше 2048 байт."),
        "415": failure("Тело не `application/json`."),
        "429": failure(
          "Слишком много действий; секунды до конца окна — в `Retry-After`.",
        ),
        "500": shared("InternalError"),
      },
    },
  };
}

// The private area of "rides near me" (#343).
const nearbyEtag = {
  ...requestIdHeader,
  ETag: {
    description:
      "Версия района и настроек: для `If-Match` следующего изменения.",
    schema: { type: "string" },
  },
};
// Writing bicycles (#347, W2b): the owner's own bicycle, its parts and the order of their groups.
const bikeEtag = {
  ...requestIdHeader,
  ETag: {
    description:
      "Версия собственных полей велосипеда (не комплектации и не фото): для `If-Match` следующей правки.",
    schema: { type: "string" },
  },
};
const componentEtag = {
  ...requestIdHeader,
  ETag: {
    description:
      "Версия компонента: для `If-Match` следующей правки. Меняется вместе с его полями.",
    schema: { type: "string" },
  },
};
const bikeFailures = (extra: Json = {}) => ({
  "400": failure(
    "Тело, параметры или `Idempotency-Key` не подходят, либо cookie вместе с Authorization.",
  ),
  "401": failure(
    "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
  ),
  "403": failure(
    "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) либо публикация без подтверждённой почты (`email_verification_required`).",
  ),
  "404": shared("NotFound"),
  ...extra,
  "413": failure(
    "Тело больше допустимого (16384 байта для велосипеда, 4096 для остального).",
  ),
  "415": failure("Тело не `application/json`."),
  "429": failure(
    "Слишком много действий; секунды до конца окна — в `Retry-After`.",
  ),
  "500": shared("InternalError"),
});
const ifMatchHeader = (required: boolean, what: string) => ({
  name: "If-Match",
  in: "header",
  required,
  description: `\`ETag\` ${what}, который клиент видел: при другой версии — 412.${required ? " Без заголовка — 428." : ""}`,
  schema: { type: "string" },
});
const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description:
    "UUID одной операции создания: повтор того же запроса в течение суток отдаёт тот же ответ (`Idempotency-Replayed: true`), а не второй объект; тот же ключ с другим телом — 409.",
  schema: { type: "string", format: "uuid" },
};
function withBikeWrites(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  const bikeId = { $ref: "#/components/parameters/BikeId" };
  const componentId = { $ref: "#/components/parameters/BikeComponentId" };
  paths["/bikes"] = {
    ...paths["/bikes"],
    post: {
      operationId: "createBike",
      tags: ["Bikes"],
      summary: "Создать свой велосипед",
      description:
        "Заголовок `Idempotency-Key` (UUID) обязателен: повтор после потерянного ответа отдаёт тот же велосипед (`Idempotency-Replayed: true`), а не второй; тот же ключ с другим телом — 409. `isPublic` называет аудиторию явно; публикация требует подтверждённой почты (403 `email_verification_required`), приватный велосипед — нет. Не больше 20 велосипедов на человека (409). Бюджет создания (30 за окно) общий с сайтом. Фото загружаются отдельно.",
      security,
      parameters: [idempotencyHeader],
      requestBody: requestBody("BikeRequest"),
      responses: {
        "201": {
          description: "Велосипед создан: карточка владельца.",
          headers: bikeEtag,
          content: json("Bike"),
        },
        ...bikeFailures({
          "409": failure(
            "`Idempotency-Key` уже использован с другим телом либо велосипедов уже 20.",
          ),
        }),
      },
    },
  };
  const getBike = (paths["/bikes/{id}"] as { get: Json }).get;
  paths["/bikes/{id}"] = {
    get: {
      ...getBike,
      description: `${String(getBike.description)} Владельцу ответ приходит с \`ETag\`: его называет \`If-Match\` правки.`,
      responses: {
        ...(getBike.responses as Json),
        "200": {
          description: "Велосипед. Владельцу — с `ETag`.",
          headers: bikeEtag,
          content: json("Bike"),
        },
      },
    },
    patch: {
      operationId: "updateBike",
      tags: ["Bikes"],
      summary: "Изменить свой велосипед",
      description:
        "Меняется только названное в теле. `If-Match` с `ETag` обязателен: правка применяется только к той версии, которую клиент видел (412, если другое устройство успело раньше; 428 без заголовка). Версия охватывает собственные поля велосипеда, но не комплектацию и фото. Смена типа заменяет `classification` целиком; смена идентичности (бренд, модель, год, комплектация) сбрасывает заводскую спецификацию, как на сайте. Публикация (`isPublic: true`) и любая правка уже публичного велосипеда требуют подтверждённой почты; снятие с публикации отзывает прежнюю публичную ссылку. Пустое тело не меняет ничего. Бюджет — 240 за окно на все правки велосипедов.",
      security,
      parameters: [bikeId, ifMatchHeader(true, "велосипеда")],
      requestBody: requestBody("BikePatchRequest"),
      responses: {
        "200": {
          description: "Велосипед после правки.",
          headers: bikeEtag,
          content: json("Bike"),
        },
        ...bikeFailures({
          "412": failure(
            "`If-Match` не совпал с текущей версией: прочитайте велосипед снова.",
          ),
          "428": failure("Нет заголовка `If-Match`."),
        }),
      },
    },
    delete: {
      operationId: "deleteBike",
      tags: ["Bikes"],
      summary: "Удалить свой велосипед",
      description:
        "Удаляет велосипед с комплектацией, фото и их файлами. Пока к велосипеду привязана покатушка, он остаётся (409), как на сайте. Повторный запрос после удаления — 404: велосипеда больше нет.",
      security,
      parameters: [bikeId],
      responses: {
        "204": noContent("Велосипед удалён."),
        ...bikeFailures({
          "409": failure("У велосипеда есть покатушки."),
        }),
      },
    },
  };
  paths["/bikes/{id}/components"] = {
    post: {
      operationId: "createBikeComponent",
      tags: ["Bikes"],
      summary: "Добавить компонент в сборку",
      description:
        "Новый компонент или аксессуар в конец списка этого велосипеда. Это запись о том, что стоит на велосипеде, а не правка каталога моделей. `Idempotency-Key` обязателен, повтор отдаёт тот же компонент. Для публичного велосипеда нужна подтверждённая почта. Бюджет общий с правками велосипеда.",
      security,
      parameters: [bikeId, idempotencyHeader],
      requestBody: requestBody("BikeComponentRequest"),
      responses: {
        "201": {
          description: "Компонент добавлен.",
          headers: componentEtag,
          content: json("BikeComponent"),
        },
        ...bikeFailures({
          "409": failure("`Idempotency-Key` уже использован с другим телом."),
        }),
      },
    },
  };
  paths["/bikes/{id}/components/{componentId}"] = {
    patch: {
      operationId: "updateBikeComponent",
      tags: ["Bikes"],
      summary: "Изменить компонент",
      description:
        "Меняется только названное в теле; место в списке не меняется. `If-Match` с `ETag` необязателен: с ним правка применяется только к версии, которую клиент видел (412). Версию возвращают ответы создания и правки компонента. Для публичного велосипеда нужна подтверждённая почта.",
      security,
      parameters: [bikeId, componentId, ifMatchHeader(false, "компонента")],
      requestBody: requestBody("BikeComponentPatchRequest"),
      responses: {
        "200": {
          description: "Компонент после правки.",
          headers: componentEtag,
          content: json("BikeComponent"),
        },
        ...bikeFailures({
          "412": failure(
            "`If-Match` не совпал с текущей версией: прочитайте велосипед снова.",
          ),
        }),
      },
    },
    delete: {
      operationId: "deleteBikeComponent",
      tags: ["Bikes"],
      summary: "Убрать компонент",
      description:
        "Убирает компонент из сборки. Повтор тоже 204: что уже убрано, остаётся убранным. Подтверждённая почта не нужна.",
      security,
      parameters: [bikeId, componentId],
      responses: {
        "204": noContent("Компонент убран."),
        ...bikeFailures(),
      },
    },
  };
  paths["/bikes/{id}/group-order"] = {
    put: {
      operationId: "setBikeGroupOrder",
      tags: ["Bikes"],
      summary: "Порядок групп компонентов",
      description:
        "Заменяет порядок групп, в котором владелец показывает сборку. Идемпотентно, версия не нужна: последний порядок побеждает. Для публичного велосипеда нужна подтверждённая почта.",
      security,
      parameters: [bikeId],
      requestBody: requestBody("BikeGroupOrderRequest"),
      responses: {
        "200": {
          description: "Велосипед с новым порядком групп.",
          headers: bikeEtag,
          content: json("Bike"),
        },
        ...bikeFailures(),
      },
    },
  };
}

// Photos of a bicycle (#347, W6a): a raw upload, the cover and deletion.
const photoBody = {
  required: true,
  description:
    "Сам файл, без multipart: JPEG, PNG или WebP до 10 МБ, от 600 × 400 пикселей. `Content-Type` — `image/jpeg`, `image/png`, `image/webp` либо `application/octet-stream`: тип определяется по байтам, а не по заголовку.",
  content: Object.fromEntries(
    ["application/octet-stream", "image/jpeg", "image/png", "image/webp"].map(
      (type) => [type, { schema: { type: "string", format: "binary" } }],
    ),
  ),
};
function withBikePhotos(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  const bikeId = { $ref: "#/components/parameters/BikeId" };
  const photoId = { $ref: "#/components/parameters/BikePhotoId" };
  paths["/bikes/{id}/photos"] = {
    post: {
      operationId: "uploadBikePhoto",
      tags: ["Bikes"],
      summary: "Загрузить фото велосипеда",
      description:
        "Один файл за запрос. Сервер сам проверяет байты (не доверяет `Content-Type` и EXIF), поворачивает по EXIF и сохраняет WebP до 2400 пикселей. Первое фото велосипеда становится обложкой. `Idempotency-Key` обязателен и стоит за хэш файла: повтор тех же байтов после потерянного ответа отдаёт то же фото (`Idempotency-Replayed: true`), а не второе; другой файл при том же ключе — 409. Не больше 12 фото на велосипед и общего объёма на человека (409), 60 загрузок за окно (429), общие с сайтом. Для публичного велосипеда нужна подтверждённая почта.",
      security,
      parameters: [bikeId, idempotencyHeader],
      requestBody: photoBody,
      responses: {
        "201": success("Фото загружено.", "BikePhoto"),
        ...bikeFailures({
          "409": failure(
            "`Idempotency-Key` уже использован с другим файлом либо исчерпана квота фото (12 на велосипед или общий объём).",
          ),
        }),
        "413": failure(
          "Файл больше 10 МБ либо слишком велик в пикселях (больше 40 млн).",
        ),
        "415": failure(
          "Не `image/jpeg`, `image/png`, `image/webp` и не `application/octet-stream`, либо по байтам это другой формат.",
        ),
      },
    },
  };
  paths["/bikes/{id}/photos/{photoId}"] = {
    delete: {
      operationId: "deleteBikePhoto",
      tags: ["Bikes"],
      summary: "Удалить фото велосипеда",
      description:
        "Удаляет фото и его файлы. Если оно было обложкой, обложкой становится самое раннее из оставшихся. Повтор тоже 204. Подтверждённая почта не нужна.",
      security,
      parameters: [bikeId, photoId],
      responses: {
        "204": noContent("Фото удалено."),
        ...bikeFailures(),
      },
    },
  };
  paths["/bikes/{id}/photos/{photoId}/cover"] = {
    put: {
      operationId: "setBikeCover",
      tags: ["Bikes"],
      summary: "Назначить обложку",
      description:
        "Делает фото обложкой, остальные перестают ею быть. Идемпотентно, тела нет. Возвращает велосипед с согласованными `photos`. Фото другого велосипеда и несуществующее — 404. Для публичного велосипеда нужна подтверждённая почта.",
      security,
      parameters: [bikeId, photoId],
      responses: {
        "200": {
          description: "Велосипед с новой обложкой.",
          headers: bikeEtag,
          content: json("Bike"),
        },
        ...bikeFailures(),
      },
    },
  };
}

// Writing the journal (#347, W3): an entry of one's own bicycle and its photos.
const entryEtag = {
  ...requestIdHeader,
  ETag: {
    description:
      "Версия записи (текста и полей, не фотографий): для `If-Match` следующей правки.",
    schema: { type: "string" },
  },
};
function withJournalWrites(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  const journalId = { $ref: "#/components/parameters/JournalId" };
  const photoId = { $ref: "#/components/parameters/JournalPhotoId" };
  paths["/journal"] = {
    post: {
      operationId: "createJournalEntry",
      tags: ["Journal"],
      summary: "Создать запись журнала",
      description:
        "Запись своего велосипеда: черновик или публикация. `status` и `isPublic` обязательны и называют аудиторию явно; публикация для всех (`published` и `isPublic: true`) требует подтверждённой почты (403 `email_verification_required`) и публичного велосипеда, иначе запись видна только владельцу. `Idempotency-Key` (UUID) обязателен: повтор после потерянного ответа отдаёт ту же запись (`Idempotency-Replayed: true`), а не вторую; другое тело при том же ключе — 409. Снимок выбранных компонентов (`componentIds`) фиксируется на момент сохранения. Не больше 1000 записей на человека (409). Бюджет — 20 за окно, общий с сайтом. Фото добавляются отдельно.",
      security,
      parameters: [idempotencyHeader],
      requestBody: requestBody("JournalRequest"),
      responses: {
        "201": {
          description: "Запись создана: вид владельца.",
          headers: entryEtag,
          content: json("JournalEntry"),
        },
        ...bikeFailures({
          "409": failure(
            "`Idempotency-Key` уже использован с другим телом либо записей уже 1000.",
          ),
        }),
        "413": failure("Тело больше 100000 байт."),
      },
    },
  };
  const getEntry = (paths["/journal/{id}"] as { get: Json }).get;
  paths["/journal/{id}"] = {
    get: {
      ...getEntry,
      description: `${String(getEntry.description)} Владельцу ответ приходит с \`ETag\`: его называет \`If-Match\` правки.`,
      responses: {
        ...(getEntry.responses as Json),
        "200": {
          description: "Запись. Владельцу — с `ETag`.",
          headers: entryEtag,
          content: json("JournalEntry"),
        },
      },
    },
    patch: {
      operationId: "updateJournalEntry",
      tags: ["Journal"],
      summary: "Изменить запись журнала",
      description:
        "Меняется только названное в теле; велосипед сменить нельзя. `If-Match` с `ETag` обязателен: правка применяется только к версии, которую клиент видел (412, если другое устройство успело раньше; 428 без заголовка), поэтому чужая свежая правка не затирается молча. Публикация для всех и любая правка опубликованной публичной записи требуют подтверждённой почты. Компоненты, которые уже были в записи, остаются со снимком на момент записи. Пустое тело ничего не меняет. Статьи сайта здесь не правятся (404). Бюджет общий с созданием.",
      security,
      parameters: [journalId, ifMatchHeader(true, "записи")],
      requestBody: requestBody("JournalPatchRequest"),
      responses: {
        "200": {
          description: "Запись после правки.",
          headers: entryEtag,
          content: json("JournalEntry"),
        },
        ...bikeFailures({
          "412": failure(
            "`If-Match` не совпал с текущей версией: прочитайте запись снова.",
          ),
          "428": failure("Нет заголовка `If-Match`."),
        }),
        "413": failure("Тело больше 100000 байт."),
      },
    },
    delete: {
      operationId: "deleteJournalEntry",
      tags: ["Journal"],
      summary: "Удалить запись журнала",
      description:
        "Удаляет свою запись с комментариями, лайками и фотографиями; файлы убираются после фиксации. Повтор после удаления — 404: записи больше нет.",
      security,
      parameters: [journalId],
      responses: {
        "204": noContent("Запись удалена."),
        ...bikeFailures(),
      },
    },
  };
  paths["/journal/{id}/photos"] = {
    post: {
      operationId: "uploadJournalPhoto",
      tags: ["Journal"],
      summary: "Загрузить фото записи",
      description:
        "Один файл за запрос, тело — сам файл, как у фото велосипеда (JPEG, PNG или WebP до 10 МБ; формат определяют байты, а не заголовок; сервер поворачивает по EXIF и сохраняет WebP). Минимального размера в пикселях нет. `Idempotency-Key` обязателен и стоит за хэш файла: те же байты — то же фото (`Idempotency-Replayed: true`), другой файл при том же ключе — 409. Не больше 8 фото в записи и 240 на человека, общий объём фото ограничен (409); 60 загрузок за окно, общих с фото велосипедов (429). Для опубликованной публичной записи нужна подтверждённая почта. Фото черновика видно только владельцу.",
      security,
      parameters: [journalId, idempotencyHeader],
      requestBody: {
        ...photoBody,
        description:
          "Сам файл, без multipart: JPEG, PNG или WebP до 10 МБ. `Content-Type` — `image/jpeg`, `image/png`, `image/webp` либо `application/octet-stream`: тип определяется по байтам, а не по заголовку.",
      },
      responses: {
        "201": success("Фото загружено.", "EntryPhoto"),
        ...bikeFailures({
          "409": failure(
            "`Idempotency-Key` уже использован с другим файлом либо исчерпана квота фото.",
          ),
        }),
        "413": failure(
          "Файл больше 10 МБ либо слишком велик в пикселях (больше 40 млн).",
        ),
        "415": failure(
          "Не `image/jpeg`, `image/png`, `image/webp` и не `application/octet-stream`, либо по байтам это другой формат.",
        ),
      },
    },
  };
  paths["/journal/{id}/photos/{photoId}"] = {
    delete: {
      operationId: "deleteJournalPhoto",
      tags: ["Journal"],
      summary: "Удалить фото записи",
      description:
        "Убирает фото записи; файл удаляется после фиксации. Повтор тоже 204. Чужая и несуществующая запись — 404.",
      security,
      parameters: [journalId, photoId],
      responses: {
        "204": noContent("Фото удалено."),
        ...bikeFailures(),
      },
    },
  };
}

// The person's own account (#354): how its deletion is confirmed, and the deletion.
function withAccount(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  paths["/account/deletion"] = {
    get: {
      operationId: "getAccountDeletion",
      tags: ["Account"],
      summary: "Чем подтверждается удаление аккаунта",
      description:
        "Говорит, как этот аккаунт подтверждает удаление: `password` — текущим паролем, `yandex` — повторным входом через Яндекс ID (у аккаунта нет пароля), и можно ли удалять вообще (`allowed`). Администратор (`admin`) сначала передаёт права; аккаунт без пароля и без Яндекса (`no_method`) задаёт пароль через «Забыли пароль?» на сайте. Ничего не меняет.",
      security,
      parameters: [],
      responses: {
        "200": success("Способ подтверждения.", "AccountDeletion"),
        "400": failure(
          "Параметры не нужны либо cookie вместе с Authorization.",
        ),
        "401": failure(
          "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
        ),
        "500": shared("InternalError"),
      },
    },
  };
  paths["/account/delete"] = {
    post: {
      operationId: "deleteAccount",
      tags: ["Account"],
      summary: "Удалить свой аккаунт",
      description:
        "Необратимо удаляет аккаунт и всё, что ему принадлежит, тем же кодом, что и сайт: велосипеды с фото, журнал, покатушки и намерения, объявления, подписки, область «поездок рядом», уведомления, адреса push и все сессии (браузеров и устройств); комментарии остаются как «недоступные», профиль в Stream Chat удаляется отдельной надёжной задачей. Тело — явное подтверждение: `confirm` = `УДАЛИТЬ` и **ровно один** способ подтвердить личность: `password` (аккаунт с паролем) либо `reauth` (аккаунт без пароля: одноразовый код ColaBike и `codeVerifier` нового нативного входа через Яндекс ID, `GET /api/auth/native/start`). Одного токена доступа недостаточно. Код тратится любой попыткой, верной или нет; код другого аккаунта отвергается. Бюджет попыток — 5 за окно, общий с сайтом (429). Администратору нельзя (409), пока он не передал права. Успех — 204 без тела; после него все токены этого аккаунта недействительны (401), повтор тоже 401. Файлы с диска убираются сразу, остальные медиа — по существующим очередям.",
      security,
      parameters: [],
      requestBody: requestBody("DeleteAccountRequest"),
      responses: {
        "204": noContent("Аккаунт удалён."),
        "400": failure(
          "Нет слова подтверждения, нет способа подтверждения, подан не тот способ или оба, либо cookie вместе с Authorization.",
        ),
        "401": failure(
          "Нет входа или токен недействителен; либо пароль не подходит, либо повторный вход не подошёл (`invalid_credentials`).",
        ),
        "403": failure(
          "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`).",
        ),
        "409": failure(
          "Администратор не может удалить аккаунт, пока не передал права; либо у аккаунта нет ни пароля, ни входа через Яндекс.",
        ),
        "413": failure("Тело больше 4096 байт."),
        "415": failure("Тело не `application/json`."),
        "429": failure(
          "Слишком много попыток; секунды до конца окна — в `Retry-After`.",
        ),
        "500": shared("InternalError"),
      },
    },
  };
}

function withNearby(document: Json) {
  const paths = document.paths as Record<string, Json>;
  const security = [{ cookieSession: [] }, { bearerAuth: [] }];
  const ifMatch = (required: boolean) => ({
    name: "If-Match",
    in: "header",
    required,
    description: required
      ? "`ETag` района, который клиент видел, обязателен: без него 428, при другой версии 412. До первого сохранения версия есть и у пустого состояния."
      : "`ETag`, который клиент видел: при другой версии — 412.",
    schema: { type: "string" },
  });
  const authFailures = {
    "401": failure(
      "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
    ),
    "403": failure(
      "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) либо район с телефона прислан не с токена приложения.",
    ),
  };
  const common = {
    ...authFailures,
    "429": failure(
      "Слишком много действий; секунды до конца окна — в `Retry-After`.",
    ),
    "500": shared("InternalError"),
  };
  paths["/me/nearby"] = {
    get: {
      operationId: "getNearby",
      tags: ["Planning"],
      summary: "Район «поездки рядом» и настройки",
      description:
        "Свой район и настройки: включено ли, откуда район, его срок, на сколько дней вперёд искать, предпочтения и пределы. Не включено по умолчанию. Версия — в `ETag` и у пустого состояния. Район хранится один, последний, как центр ячейки сетки; истории мест нет.",
      security,
      parameters: [],
      responses: {
        "200": {
          description: "Район и настройки.",
          headers: nearbyEtag,
          content: json("Nearby"),
        },
        "400": failure(
          "Параметры не подходят либо cookie вместе с Authorization.",
        ),
        "401": authFailures["401"],
        "500": shared("InternalError"),
      },
    },
    patch: {
      operationId: "updateNearbySettings",
      tags: ["Planning"],
      summary: "Включить поиск рядом, горизонт и предпочтения",
      description:
        "Меняется только указанное. Включение — отдельное согласие: оно не включает push и публикацию намерений, а сохранённый район его не включает. Выключить можно всегда, и когда оператор выключил возможность (`available: false`) включить нельзя (503). `If-Match` необязателен.",
      security,
      parameters: [ifMatch(false)],
      requestBody: requestBody("NearbySettingsPatch"),
      responses: {
        "200": {
          description: "Состояние после изменения.",
          headers: nearbyEtag,
          content: json("Nearby"),
        },
        "400": failure("Тело не подходит либо cookie вместе с Authorization."),
        ...common,
        "412": failure("`If-Match` не совпал: прочитайте состояние снова."),
        "413": failure("Тело больше 2048 байт."),
        "415": failure("Тело не `application/json`."),
        "503": failure("Оператор выключил возможность."),
      },
    },
    delete: {
      operationId: "forgetNearby",
      tags: ["Planning"],
      summary: "Отказаться от поиска рядом и забыть всё",
      description:
        "Удаляет район, переключатель и предпочтения целиком; запланированная доставка, основанная на районе, отменяется. Повтор тоже 204.",
      security,
      parameters: [],
      responses: { "204": noContent("Всё удалено."), ...common },
    },
  };
  paths["/me/nearby/area"] = {
    put: {
      operationId: "saveNearbyArea",
      tags: ["Planning"],
      summary: "Сохранить район",
      description:
        "Один район на аккаунт, последний. Телефон присылает центр ячейки сетки (`limits.cell`), а не точку: более точное сервер не округляет, а отклоняет (400), потому что округление на сервере не заменяет минимизацию до отправки. Район с телефона живёт `limits.deviceTtlHours` часов от подтверждения и ничем, кроме нового подтверждения, не продлевается; срок не продлевает и приход push. Выбранный вручную район сервер приводит к ячейке сам и хранит до удаления. Район другого источника заменяется только с `replaceSource: true` (иначе 409), поэтому два устройства не затирают район молча. Заголовок `If-Match` обязателен. Сохранение не включает возможность.",
      security,
      parameters: [ifMatch(true)],
      requestBody: requestBody("NearbyAreaRequest"),
      responses: {
        "200": {
          description: "Состояние после сохранения.",
          headers: nearbyEtag,
          content: json("Nearby"),
        },
        "400": failure(
          "Тело не подходит: радиус вне 5 км…предела оператора или не кратен километру, положение с телефона не центр ячейки, название у района с телефона.",
        ),
        ...common,
        "409": failure(
          "Действует район другого источника, а `replaceSource` не указан.",
        ),
        "412": failure("`If-Match` не совпал: прочитайте состояние снова."),
        "413": failure("Тело больше 2048 байт."),
        "415": failure("Тело не `application/json`."),
        "428": failure("Нет заголовка `If-Match`."),
        "503": failure("Оператор выключил возможность."),
      },
    },
    delete: {
      operationId: "removeNearbyArea",
      tags: ["Planning"],
      summary: "Удалить район",
      description:
        "Убирает район; переключатель и предпочтения остаются. Предложения, основанные на районе, перестают подбираться. Повтор тоже 200. `If-Match` необязателен.",
      security,
      parameters: [ifMatch(false)],
      responses: {
        "200": {
          description: "Состояние без района.",
          headers: nearbyEtag,
          content: json("Nearby"),
        },
        ...common,
        "412": failure("`If-Match` не совпал: прочитайте состояние снова."),
      },
    },
  };
  paths["/me/nearby/offers"] = {
    get: {
      operationId: "listNearbyOffers",
      tags: ["Planning"],
      summary: "Что есть в выбранном районе сейчас",
      description:
        "Короткий список текущих предложений по запросу — для выдачи после первого включения поиска рядом или переезда. Это чтение: ничего не рассылается и не записывается, а уже опубликованное не приходит новостью. Берётся публичная приблизительная область плана и его вид, но не точка встречи; свои планы, планы, куда вы приглашены или уже ответили, и заглушённые авторы не показываются. Расстояния до вас в ответе нет. Если района нет, срок района с телефона вышел или поиск выключен, список пуст, а `state` говорит почему.",
      security,
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Сколько показать, от 1 до 20; по умолчанию 10.",
          schema: { type: "integer", minimum: 1, maximum: 20, default: 10 },
        },
      ],
      responses: {
        "200": {
          description: "Предложения и состояние поиска.",
          headers: {
            "Cache-Control": {
              description: "`no-store`: ответ зависит от района человека.",
              schema: { type: "string" },
            },
          },
          content: json("NearbyOffers"),
        },
        "400": failure(
          "Параметры не подходят либо cookie вместе с Authorization.",
        ),
        "401": authFailures["401"],
        "429": common["429"],
        "500": shared("InternalError"),
      },
    },
  };
}

export function buildOpenApiDocument(origin: string = publicOrigin()): Json {
  const { schemas } = z.toJSONSchema(schemaRegistry, {
    target: "draft-2020-12",
    io: "output",
    uri: (id) => `#/components/schemas/${id}`,
  });
  const document: Json = {
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
      {
        name: "Account",
        description: "Текущий пользователь и удаление его аккаунта.",
      },
      {
        name: "Sessions",
        description: "Вход устройства, обновление токенов и список сессий.",
      },
      {
        name: "Personal",
        description:
          "Личные ответы вошедшему: уведомления, сохранённое. Никому, кроме самого человека.",
      },
      {
        name: "Bikes",
        description:
          "Велосипеды: чтение и запись владельцем (велосипед, комплектация, порядок групп, фото).",
      },
      {
        name: "Journal",
        description: "Записи журнала велосипеда: чтение и запись владельцем.",
      },
      {
        name: "Rides",
        description:
          "Публичные покатушки: состоявшиеся, ближайшие планы, публичная геометрия и разбор трека.",
      },
      {
        name: "Planning",
        description:
          "Договориться о поездке: намерения покататься и ответ на покатушку на конкретную дату. Права и правила те же, что на сайте.",
      },
      {
        name: "Comments",
        description:
          "Комментарии к велосипедам, записям и покатушкам: один вид на всё.",
      },
      {
        name: "Chat",
        description:
          "Мост к Stream Chat для нативного клиента: токен, каналы, кому написать, непрочитанные. Сообщения идут напрямую между клиентом и провайдером.",
      },
      {
        name: "Components",
        description: "Публичный каталог моделей компонентов: карточки, фото.",
      },
      {
        name: "Market",
        description:
          "Барахолка: действующие объявления, карточка, контакт по запросу, избранное.",
      },
      {
        name: "Search",
        description:
          "Поиск велосипедов, записей журнала и людей по опыту сборок и подсказки по компонентам.",
      },
      {
        name: "Users",
        description: "Публичные профили, их велосипеды и подписки.",
      },
      {
        name: "App",
        description:
          "Настройки нативного приложения из админки: экран запуска, знакомство, сообщение, ссылки, доступность функций и политика версий. Без входа.",
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
      "/me/feed": {
        get: {
          operationId: "getFeed",
          tags: ["Personal"],
          summary: "Моя лента",
          description:
            "Публикации тех, на кого подписан человек, и велосипедов, за которыми он следит: велосипеды, покатушки, записи журнала и объявления, новые сверху, курсор по `(время публикации, id)`. `type`: `all` (по умолчанию), `rides` или `journal`. Покатушка, к которой есть публичная запись журнала, в `all` не повторяется отдельной карточкой (есть запись). Отменённых покатушек нет. Каждая страница читается заново по видимости зрителя: скрытое между страницами не показывается. В каждом элементе заполнено одно поле из `bike`, `ride`, `journal`, `listing`.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(
            feedQuerySchema,
            ["limit", "cursor"],
            feedNotes,
          ).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница ленты.", "FeedPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/notifications": {
        get: {
          operationId: "listNotifications",
          tags: ["Personal"],
          summary: "Мои уведомления",
          description:
            "Новые сверху, курсор по `(время, id)`; `unread=1` и `category` сужают список, курсор работает и с ними. Видимость вычисляется при чтении, как на сайте: уведомление о том, что получатель уже не вправе видеть (приватное, скрытое, заблокированное, отменённый лайк, удалённый комментарий), не показывается. Чтение уведомлений, как и на сайте, создаёт напоминание о конце срока объявления (раз за срок). Сам список ничего не помечает прочитанным: это отдельные операции, а `watermark` ответа нужен для «Прочитать все».",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(
            notificationsQuerySchema,
            ["limit", "cursor"],
            notificationNotes,
          ).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница уведомлений.", "NotificationPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/notifications/count": {
        get: {
          operationId: "getNotificationCount",
          tags: ["Personal"],
          summary: "Число непрочитанных",
          description:
            "Считается до 100: при `capped` непрочитанных не меньше 100. `watermark` — отметка для «Прочитать все», если список не загружался.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [],
          responses: {
            "200": success("Число непрочитанных.", "NotificationCount"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/notifications/{id}/read": {
        put: {
          operationId: "markNotificationRead",
          tags: ["Personal"],
          summary: "Пометить уведомление прочитанным",
          description:
            "Идемпотентно: повтор тоже 200, `marked` в нём 0. Прочитанным делает только само приложение, когда человек открыл уведомление или нажал «прочитано»: показ в шторке, смахивание и загрузка списка ничего не помечают. Чужое, ещё не доставленное (напоминание, срок которого не пришёл) и несуществующее уведомление неотличимы: 404. Бюджет тот же, что у кнопок сайта.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/NotificationId" }],
          responses: {
            "200": success("Итог пометки.", "NotificationReadResult"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`).",
            ),
            "404": failure("Уведомление не найдено."),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/notifications/read": {
        post: {
          operationId: "markNotificationsRead",
          tags: ["Personal"],
          summary: "Пометить несколько уведомлений прочитанными",
          description:
            "До 100 идентификаторов, как на экране. Идемпотентно. Чужие и ещё не доставленные не считаются и не вызывают ошибки: `marked` — сколько помечено сейчас.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          requestBody: requestBody("NotificationReadRequest"),
          responses: {
            "200": success("Итог пометки.", "NotificationReadResult"),
            ...writeFailures(),
          },
        },
      },
      "/me/notifications/read-all": {
        post: {
          operationId: "markAllNotificationsRead",
          tags: ["Personal"],
          summary: "Прочитать все до отметки",
          description:
            "Помечает прочитанными всё видимое сейчас до `watermark` из списка или счётчика (с `category` — только эту категорию). Уведомление, пришедшее после того, как список был показан, лежит выше отметки и остаётся непрочитанным. Скрытое сейчас (например, о приватном объекте) не помечается: оно не было показано. За один запрос — до 10 000; если `unread` в ответе не нулевой, запрос повторяют. Идемпотентно. `watermark`, который сервер не выдавал этому аккаунту (чужой, выдуманный, курсор страницы или отметка уже удалённого уведомления), — 400, и ничего не помечается: обновите список или счётчик и возьмите новую отметку.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          requestBody: requestBody("NotificationReadAllRequest"),
          responses: {
            "200": success("Итог пометки.", "NotificationReadResult"),
            ...writeFailures(),
          },
        },
      },
      "/me/notification-settings": {
        get: {
          operationId: "getNotificationSettings",
          tags: ["Personal"],
          summary: "Настройки уведомлений",
          description:
            "Что человек хочет получать: каналы (почта, push), категории по каналам, напоминание о покатушке, часовой пояс и тихие часы, паузу, круг людей, чьи новые планы и намерения приходят, и заглушённое. Те же настройки видит и меняет сайт. В списке категорий только те, которые сервер производит и которые канал может передать; `channels.*.available` говорит, работает ли канал на сервере (почта — настроена ли отправка, push — подключена ли доставка), и приложение не показывает переключатель недоступного канала. Версия объекта — заголовок `ETag`. Разрешение системы и регистрация телефона — не здесь.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [],
          responses: {
            "200": {
              description: "Настройки уведомлений.",
              headers: {
                ...requestIdHeader,
                ETag: {
                  description:
                    "Версия настроек: для `If-Match` следующего изменения.",
                  schema: { type: "string" },
                },
              },
              content: json("NotificationSettings"),
            },
            "400": failure(
              "Неверный параметр либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
        patch: {
          operationId: "updateNotificationSettings",
          tags: ["Personal"],
          summary: "Изменить настройки уведомлений",
          description:
            "Меняется только указанное, поэтому два устройства, меняющие разные переключатели, не затирают друг друга; повтор того же изменения ничего не меняет. `If-Match` необязателен: с ним изменение применяется только к версии, которую клиент видел (412, если версия уже другая). Включить канал можно, когда он работает: почту — с подтверждённым адресом (403 `email_verification_required`) и настроенной отправкой (503 `service_unavailable`), push — когда доставка подключена (503). Выключить можно всегда; повтор того, что уже есть, и `reminders` (общее для всех каналов) не требуют работающей почты. Категория называет только каналы, которые могут её передавать. Тихие часы нужны с часовым поясом IANA и работают по часам человека; пауза не дальше чем на год вперёд (`null` или `resume: true` снимает); круг `selected` и `mutes` меняются списками `add`/`remove`, повтор того, что уже есть, ничего не меняет. Всё это касается письма и push, но не ящика уведомлений. Согласие на push здесь не включает разрешение системы на конкретном телефоне. Бюджет тот же, что у формы на сайте.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "If-Match",
              in: "header",
              required: false,
              description:
                "`ETag` настроек, которые клиент видел: при другой версии — 412.",
              schema: { type: "string" },
            },
          ],
          requestBody: requestBody("NotificationSettingsPatch"),
          responses: {
            "200": {
              description: "Настройки после изменения.",
              headers: {
                ...requestIdHeader,
                ETag: {
                  description: "Новая версия настроек.",
                  schema: { type: "string" },
                },
              },
              content: json("NotificationSettings"),
            },
            ...writeFailures({
              "412": failure(
                "`If-Match` не совпал с текущей версией: прочитайте настройки снова.",
              ),
              "503": failure(
                "Канал не работает на сервере (отправка почты не настроена, push не подключён).",
              ),
            }),
          },
        },
      },
      "/me/push-device": {
        get: {
          operationId: "getPushDevice",
          tags: ["Personal"],
          summary: "Привязка этого телефона к push",
          description:
            "Привязка телефона, с сессии которого сделан запрос: служба доставки, проект и поколение. Адреса в ответе нет и не будет. Только для Bearer-токена приложения: у cookie браузера телефона нет. 404, если телефон не привязан или привязка отозвана.",
          security: [{ bearerAuth: [] }],
          parameters: [],
          responses: {
            "200": success("Привязка этого телефона.", "PushDevice"),
            "401": failure(
              "Нет входа, сессия или токен недействительны либо токен доступа истёк (`token_expired`).",
            ),
            "403": failure(
              "Запрос с cookie браузера, а не с токеном приложения.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
        put: {
          operationId: "registerPushDevice",
          tags: ["Personal"],
          summary: "Привязать телефон к push",
          description:
            "Привязывает адрес push этого телефона к сессии приложения; у сессии один адрес. Идемпотентно: тот же адрес с той же установки — то же поколение, а новый адрес, проект или установка и привязка после отзыва — следующее. Адрес уже другой живой привязки переходит сюда, прежняя привязка отзывается и ничего не получает. Привязка не включает push в настройках и не заменяет разрешение системы: сервер шлёт только тому, кто дал согласие аккаунта. Адрес — секрет: сервер хранит его зашифрованным и не показывает. Телефонов с push у человека не больше десяти (409 `conflict`). Не подключён push на сервере или проект не разрешён — 503 / 400. Привязка кончается с сессией (выход, отзыв, блокировка, смена пароля, удаление аккаунта) и в ответ на `DELETE`.",
          security: [{ bearerAuth: [] }],
          parameters: [],
          requestBody: requestBody("PushDeviceRegistration"),
          responses: {
            "200": success("Привязка после изменения.", "PushDevice"),
            ...writeFailures({
              "409": failure(
                "Поколение, которое назвал клиент, не текущее (прочитайте привязку заново) либо телефонов с push уже слишком много.",
              ),
              "503": failure("Push на сервере не подключён."),
            }),
          },
        },
        delete: {
          operationId: "revokePushDevice",
          tags: ["Personal"],
          summary: "Отвязать телефон от push",
          description:
            "Отзывает привязку этого телефона, и всё, что для него ещё не отправлено, не будет отправлено. Повтор тоже 204. Повторная привязка — следующее поколение, прежнее не оживает.",
          security: [{ bearerAuth: [] }],
          parameters: [],
          responses: {
            "204": noContent("Привязка отозвана или её не было."),
            "401": failure(
              "Нет входа, сессия или токен недействительны либо токен доступа истёк (`token_expired`).",
            ),
            "403": failure(
              "Запрос с cookie браузера, а не с токеном приложения.",
            ),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/saved/journal": {
        get: {
          operationId: "listSavedJournal",
          tags: ["Personal"],
          summary: "Сохранённые записи журнала",
          description:
            "Новые сохранения сверху, курсор по `(время сохранения, id)`. Запись, которую скрыли или сняли с публикации, остаётся сохранённой, но не показывается.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("Limit", "Cursor"),
          responses: {
            "200": success("Страница сохранённых записей.", "JournalPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/saved/market": {
        get: {
          operationId: "listSavedMarket",
          tags: ["Personal"],
          summary: "Сохранённые объявления",
          description:
            "Новые сохранения сверху, курсор по `(время сохранения, id)`. Проданное, истёкшее и скрытое объявление остаётся сохранённым, но не показывается; добавить и убрать — `PUT/DELETE /market/{id}/save`.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("Limit", "Cursor"),
          responses: {
            "200": success("Страница сохранённых объявлений.", "MarketPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/rides": {
        get: {
          operationId: "listMyRides",
          tags: ["Personal"],
          summary: "Мои покатушки",
          description:
            "Все свои покатушки в любом состоянии (состоявшиеся, запланированные, отменённые; публичные и нет), новые сверху, курсор по `(начало или дата добавления, id)`. Владельческие поля — `isPublic`, зона приватности, число точек. Геометрия и серии трека в списки не входят: карточка `/rides/{id}` отдаёт публичную геометрию.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("Limit", "Cursor"),
          responses: {
            "200": success("Страница своих покатушек.", "OwnRidePage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/me/rides/upcoming": {
        get: {
          operationId: "listMyUpcomingRides",
          tags: ["Personal"],
          summary: "Мои ближайшие планы",
          description:
            "Свои планы, планы с ответами «еду» и «возможно», приглашения без ответа и недавние отмены дат, на которые человек отвечал: до 20 штук на 60 дней вперёд, ближайшие первыми, без курсора и без параметров. `role` говорит, кем человек в плане выступает. Точка встречи — по правилам участников. Имена ответивших не передаются.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [],
          responses: {
            "200": success("Ближайшие планы человека.", "MyUpcomingRides"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
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
            "Почта и пароль, как на сайте (те же ограничения частоты и блокировки), либо одноразовый код приложения и `codeVerifier` после нативного входа через внешнего провайдера (код тратится любой попыткой; все отказы одинаковы), плюс описание устройства. Возвращает сессию устройства и пару токенов. Токены показываются только в этом ответе. Подтверждённая почта для входа не нужна, как и в вебе. Одновременно у человека не больше 20 сессий устройств: самая давно не использованная завершается.",
          security: [],
          requestBody: requestBody("CreateSessionRequest"),
          responses: {
            "201": success("Сессия устройства и токены.", "SessionGrant"),
            "400": failure("Неверное тело запроса."),
            "413": failure("`payload_too_large`: тело больше лимита."),
            "415": failure(
              "`unsupported_media_type`: тело не `application/json`.",
            ),
            "401": failure(
              "`invalid_credentials`: неверная почта или пароль, недействительный, просроченный или потраченный код либо аккаунт заблокирован; ответ одинаков во всех этих случаях.",
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
            "413": failure("`payload_too_large`: тело больше лимита."),
            "415": failure(
              "`unsupported_media_type`: тело не `application/json`.",
            ),
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
      "/bikes/{id}/journal": {
        get: {
          operationId: "listBikeJournal",
          tags: ["Journal"],
          summary: "Записи журнала велосипеда",
          description:
            "Новые сверху, курсор. Владелец видит и черновики, остальные — только опубликованные публичные записи публичного велосипеда. Записи заблокированных авторов не показываются. Приватный, чужой и несуществующий велосипед неотличимы: 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/BikeId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница записей.", "JournalPage"),
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
      "/journal/{id}": {
        get: {
          operationId: "getJournalEntry",
          tags: ["Journal"],
          summary: "Запись журнала",
          description:
            "Запись целиком: текст в Markdown, снимок компонентов на момент записи (цены — по правилам цен велосипеда), фотографии, счётчики и `liked` вошедшего зрителя. Публичная опубликованная запись публичного велосипеда видна всем; черновик и закрытая запись — только владельцу, остальным 404, как и записи заблокированного автора.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/JournalId" }],
          responses: {
            "200": success("Запись.", "JournalEntry"),
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
      "/bikes/{id}/comments": {
        get: {
          operationId: "listBikeComments",
          tags: ["Comments"],
          summary: "Комментарии велосипеда",
          description:
            "Корневые комментарии, старые сверху, курсор; у каждого превью из не более чем трёх первых ответов и `replyCount`. Ответы вложены на один уровень. Удалённый, скрытый или комментарий заблокированного автора виден «надгробием» (`deleted`, без текста и автора), только пока под ним есть читаемые ответы. Комментарии есть только у публичных объектов: у закрытых, черновиков и объектов заблокированных владельцев — 404, даже для владельца. `focus` возвращает ветку и цепочку для глубокой ссылки.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/BikeId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
            { $ref: "#/components/parameters/Focus" },
          ],
          responses: {
            "200": success("Страница комментариев.", "CommentPage"),
            "400": failure(
              "Неверный параметр или курсор, `focus` вместе с `cursor` либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/bikes/{id}/comments/{commentId}/replies": {
        get: {
          operationId: "listBikeReplies",
          tags: ["Comments"],
          summary: "Ответы на комментарий велосипеда",
          description:
            "Ответы на один комментарий, старые сверху, курсор. Те же правила видимости и «надгробия», что у списка комментариев.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/BikeId" },
            { $ref: "#/components/parameters/CommentId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница ответов.", "ReplyPage"),
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
      "/journal/{id}/comments": {
        get: {
          operationId: "listJournalComments",
          tags: ["Comments"],
          summary: "Комментарии записи",
          description:
            "Корневые комментарии, старые сверху, курсор; у каждого превью из не более чем трёх первых ответов и `replyCount`. Ответы вложены на один уровень. Удалённый, скрытый или комментарий заблокированного автора виден «надгробием» (`deleted`, без текста и автора), только пока под ним есть читаемые ответы. Комментарии есть только у публичных объектов: у закрытых, черновиков и объектов заблокированных владельцев — 404, даже для владельца. `focus` возвращает ветку и цепочку для глубокой ссылки.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/JournalId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
            { $ref: "#/components/parameters/Focus" },
          ],
          responses: {
            "200": success("Страница комментариев.", "CommentPage"),
            "400": failure(
              "Неверный параметр или курсор, `focus` вместе с `cursor` либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/journal/{id}/comments/{commentId}/replies": {
        get: {
          operationId: "listJournalReplies",
          tags: ["Comments"],
          summary: "Ответы на комментарий записи",
          description:
            "Ответы на один комментарий, старые сверху, курсор. Те же правила видимости и «надгробия», что у списка комментариев.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/JournalId" },
            { $ref: "#/components/parameters/CommentId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница ответов.", "ReplyPage"),
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
      "/rides": {
        get: {
          operationId: "listRides",
          tags: ["Rides"],
          summary: "Состоявшиеся покатушки",
          description:
            "Публичные состоявшиеся покатушки публичных велосипедов, новые сверху, курсор по `(начало, id)`; трек без времени стоит по дате добавления. Карточки без геометрии и описания: это список. Покатушки заблокированных авторов, приватные и отменённые не показываются.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
            { $ref: "#/components/parameters/RideText" },
          ],
          responses: {
            "200": success("Страница покатушек.", "RidePage"),
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
      "/rides/upcoming": {
        get: {
          operationId: "listUpcomingRides",
          tags: ["Rides"],
          summary: "Ближайшие планы",
          description:
            "Публичные планы, которые ещё впереди, ближайшие сверху, курсор по `(дата, id)`. Еженедельная серия стоит одной карточкой на ближайшей дате (`scheduledAt`); дата серии сдвигается вместе с часами, поэтому серия, дата которой прошла между страницами, может встретиться ещё раз уже на следующей неделе. Отменённые планы и отменённые даты серии пропускаются.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
            { $ref: "#/components/parameters/RideText" },
          ],
          responses: {
            "200": success("Страница планов.", "RidePage"),
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
      "/rides/{id}": {
        get: {
          operationId: "getRide",
          tags: ["Rides"],
          summary: "Покатушка",
          description:
            "Карточка покатушки или плана: показатели, публичная геометрия (`MultiLineString`, участки у начала и конца внутри радиуса приватности обрезаны), рамка, паспорт плана, счётчики. Точка встречи «только участникам» приходит `null` с `meetingHidden: true`, пока зритель не организатор и не принявший участие. Имён ответивших и владельческих полей нет. Приватная, отменённая, заблокированного автора, на приватном велосипеде и несуществующая покатушка неотличимы: 404, и это верно и для самого владельца: его личные ответы — отдельная операция.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RideId" }],
          responses: {
            "200": success("Покатушка.", "Ride"),
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
      "/rides/{id}/analysis": {
        get: {
          operationId: "getRideAnalysis",
          tags: ["Rides"],
          summary: "Разбор трека",
          description:
            "Публичные серии для графиков высоты, скорости и уклона (пульс, каденс и мощность — только если автор открыл их показатели): участки в зонах приватности обрезаны, как у геометрии; абсолютного времени нет. Отдельный запрос, чтобы карточка и список оставались лёгкими. У покатушки без трека или без готового разбора — 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/RideId" }],
          responses: {
            "200": success("Публичные серии.", "RideAnalysis"),
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
      "/bikes/{id}/rides": {
        get: {
          operationId: "listBikeRides",
          tags: ["Rides"],
          summary: "Покатушки велосипеда",
          description:
            "Состоявшиеся публичные покатушки одного велосипеда, как `/rides`. Приватный, чужой и несуществующий велосипед неотличимы: 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/BikeId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
            { $ref: "#/components/parameters/RideText" },
          ],
          responses: {
            "200": success("Страница покатушек.", "RidePage"),
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
      "/rides/{id}/comments": {
        get: {
          operationId: "listRideComments",
          tags: ["Comments"],
          summary: "Комментарии покатушки",
          description:
            "Корневые комментарии, старые сверху, курсор; у каждого превью из не более чем трёх первых ответов и `replyCount`. Правила те же, что у комментариев велосипеда и записи; у приватной, отменённой и недоступной покатушки — 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/RideId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
            { $ref: "#/components/parameters/Focus" },
          ],
          responses: {
            "200": success("Страница комментариев.", "CommentPage"),
            "400": failure(
              "Неверный параметр или курсор, `focus` вместе с `cursor` либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/rides/{id}/comments/{commentId}/replies": {
        get: {
          operationId: "listRideReplies",
          tags: ["Comments"],
          summary: "Ответы на комментарий покатушки",
          description:
            "Ответы на один комментарий, старые сверху, курсор. Те же правила видимости и «надгробия», что у списка комментариев.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [
            { $ref: "#/components/parameters/RideId" },
            { $ref: "#/components/parameters/CommentId" },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Cursor" },
          ],
          responses: {
            "200": success("Страница ответов.", "ReplyPage"),
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
      "/bikes/{id}/like": {
        put: {
          operationId: "likeBike",
          tags: ["Bikes"],
          summary: "Поставить лайк велосипеду",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние. Свой, приватный, чужой приватный и несуществующий велосипед лайка не получают.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/BikeId" }],
          responses: {
            "200": success("Итоговое состояние лайка.", "BikeLike"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) или действие запрещено, например лайк своему велосипеду.",
            ),
            "404": failure(
              "Велосипед недоступен: приватный, чужой, заблокированного владельца или несуществующий.",
            ),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
        delete: {
          operationId: "unlikeBike",
          tags: ["Bikes"],
          summary: "Снять лайк с велосипеда",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/BikeId" }],
          responses: {
            "200": success("Итоговое состояние лайка.", "BikeLike"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) или действие запрещено, например лайк своему велосипеду.",
            ),
            "404": failure("Велосипед недоступен."),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/users/{ref}/follow": {
        put: {
          operationId: "followUser",
          tags: ["Users"],
          summary: "Подписаться на человека",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние. На себя подписаться нельзя (400). Заблокированный и неизвестный человек — 404. Ответ — отношения и число подписчиков.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/UserRef" }],
          responses: {
            "200": success("Итоговое состояние подписки.", "FollowResult"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) или действие запрещено, например лайк своему велосипеду.",
            ),
            "404": failure(
              "Человек недоступен: заблокирован, неизвестный `{ref}` или прежний username.",
            ),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
        delete: {
          operationId: "unfollowUser",
          tags: ["Users"],
          summary: "Отписаться от человека",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/UserRef" }],
          responses: {
            "200": success("Итоговое состояние подписки.", "FollowResult"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) или действие запрещено, например лайк своему велосипеду.",
            ),
            "404": failure("Человек недоступен."),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/journal/{id}/save": {
        put: {
          operationId: "saveJournalEntry",
          tags: ["Journal"],
          summary: "Сохранить запись журнала",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние. Сохранить можно только публичную опубликованную запись публичного велосипеда.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/JournalId" }],
          responses: {
            "200": success("Итоговое состояние «сохранить».", "SaveResult"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) или действие запрещено, например лайк своему велосипеду.",
            ),
            "404": failure("Запись недоступна."),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
        delete: {
          operationId: "unsaveJournalEntry",
          tags: ["Journal"],
          summary: "Убрать запись из сохранённых",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: [{ $ref: "#/components/parameters/JournalId" }],
          responses: {
            "200": success("Итоговое состояние «сохранить».", "SaveResult"),
            "400": failure(
              "Одновременно cookie сессии и заголовок Authorization.",
            ),
            "401": failure(
              "Нет входа, сессия или токен недействительны, токен доступа истёк (`token_expired`) либо схема Authorization не поддерживается.",
            ),
            "403": failure(
              "Cookie-запрос не с адреса сайта (нужен заголовок `Origin`) или действие запрещено, например лайк своему велосипеду.",
            ),
            "404": failure("Запись недоступна."),
            "429": failure(
              "Слишком много действий; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/experience/bikes": {
        get: {
          operationId: "searchExperienceBikes",
          tags: ["Search"],
          summary: "Поиск велосипедов",
          description:
            "Поиск по опыту сборок: текст и грани сайта (бренд, модель, год, назначение, компонент, классификация) с правилами написания каталога; `similar` — похожие на велосипед. Новые сверху, курсор по `(создан, id)`; те же видимость и `BikeSummary`, что у `/bikes` (там же простой поиск по тексту `q`). Чужой приватный и заблокированного владельца не находятся. Неизвестный или непубличный `similar` — 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(experienceQuerySchema, [
            "limit",
            "cursor",
          ]).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница велосипедов.", "BikePage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/experience/journal": {
        get: {
          operationId: "searchExperienceJournal",
          tags: ["Search"],
          summary: "Поиск записей журнала",
          description:
            "Те же текст и грани, что у поиска велосипедов, по публичным опубликованным записям публичных велосипедов (компоненты берутся из снимка записи; `kind` — тип записи). Новые сверху, курсор по `(опубликована, id)`; `JournalSummary` как у `/bikes/{id}/journal`.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(experienceQuerySchema, [
            "limit",
            "cursor",
          ]).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница записей.", "JournalPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/experience/users": {
        get: {
          operationId: "searchExperienceUsers",
          tags: ["Search"],
          summary: "Поиск людей",
          description:
            "Люди, у которых имя или username содержит текст; текст обязателен (это поиск, не каталог). Новые аккаунты сверху, курсор по `(регистрация, id)`; заблокированных нет. `UserSummary` с `relationship` для вошедшего.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(usersSearchQuerySchema, [
            "limit",
            "cursor",
          ]).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница людей.", "UserPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/search/components": {
        get: {
          operationId: "searchComponents",
          tags: ["Search"],
          summary: "Подсказки по компонентам",
          description:
            "Названия компонентов публичных велосипедов, содержащие текст, и число велосипедов, на которых каждое встречается: по убыванию числа, затем по названию. Короткий список для строки поиска, не страницы (курсора нет); текст обязателен.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(componentSearchQuerySchema, [
            "limit",
          ]).concat([
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Сколько подсказок вернуть, 1–24, по умолчанию 12.",
              schema: { type: "integer", minimum: 1, maximum: 24, default: 12 },
            },
          ]),
          responses: {
            "200": success("Подсказки.", "ComponentHitList"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/component-models": {
        get: {
          operationId: "listComponentModels",
          tags: ["Components"],
          summary: "Каталог моделей компонентов",
          description:
            "Опубликованные неархивные модели, не слитые в другие. Фильтры: `q` (название, бренд и прежние написания), `category`, `brand`. `sort=new` — новые сверху, курсор по `(появилась, id)`; `sort=popular` — по числу сборок публичных велосипедов, курсор хранит значение числа на момент страницы, поэтому при изменении числа между страницами модель может встретиться дважды или пропуститься. Курсор одного порядка в другом — 400.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(componentCatalogQuerySchema, [
            "limit",
            "cursor",
          ]).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница моделей.", "ComponentModelPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/component-models/filters": {
        get: {
          operationId: "listComponentFilters",
          tags: ["Components"],
          summary: "Фильтры каталога",
          description:
            "Категории и бренды перечисляемых моделей: значения для `category` и `brand`.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: [],
          responses: {
            "200": success("Категории и бренды.", "ComponentFilters"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/component-models/{id}": {
        get: {
          operationId: "getComponentModel",
          tags: ["Components"],
          summary: "Модель компонента",
          description:
            "Карточка модели: название, бренд, категория, описание, число публичных сборок, обложка. Слитая модель отдаёт каноническую; архивная читается, но в каталоге не перечисляется (`archived`). Установки и их владельцы не передаются. Неопубликованная и неизвестная модель — 404.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("ComponentModelId"),
          responses: {
            "200": success("Модель.", "ComponentModel"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/component-models/{id}/photos": {
        get: {
          operationId: "listComponentPhotos",
          tags: ["Components"],
          summary: "Фотографии модели",
          description:
            "Галерея: до 60 публичных фотографий, обложка первой, с источником и лицензией для фото из внешних источников. Скрытых фотографий и фотографий заблокированных авторов нет; состояния правки и модерации не передаются.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("ComponentModelId"),
          responses: {
            "200": success("Галерея.", "ComponentPhotoList"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/component-models/{id}/comments": {
        get: {
          operationId: "listComponentComments",
          tags: ["Comments"],
          summary: "Комментарии модели",
          description:
            "Корневые комментарии, старые сверху, курсор; превью до трёх ответов и `replyCount`; те же правила и «надгробия», что у остальных объектов. Комментарии слитых моделей собраны под канонической.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("ComponentModelId", "Limit", "Cursor", "Focus"),
          responses: {
            "200": success("Страница комментариев.", "CommentPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/component-models/{id}/comments/{commentId}/replies": {
        get: {
          operationId: "listComponentReplies",
          tags: ["Comments"],
          summary: "Ответы на комментарий модели",
          description: "Ответы на один комментарий, старые сверху, курсор.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("ComponentModelId", "CommentId", "Limit", "Cursor"),
          responses: {
            "200": success("Страница ответов.", "ReplyPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/market": {
        get: {
          operationId: "listMarket",
          tags: ["Market"],
          summary: "Объявления барахолки",
          description:
            "Только объявления, которые на рынке сейчас: опубликованные, в пределах срока, продавец не заблокирован. Проданное, истёкшее и черновики сюда не попадают (по `id` проданное и истёкшее читаются с пометкой). Свои действующие объявления зритель видит в общей ленте как все остальные. Порядок `sort=new` — по дате публикации, курсор по `(published_at, id)`; в порядках цены курсор хранит цену последнего объявления, объявления без цены идут в конце; курсор одного порядка в другом — 400. Контакт в карточке не отдаётся: `/market/{id}/contact`.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: queryParameters(
            marketQuerySchema,
            ["limit", "cursor"],
            marketNotes,
          ).concat(refs("Limit", "Cursor")),
          responses: {
            "200": success("Страница объявлений.", "MarketPage"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": failure("Продавец из `seller` не найден."),
            "500": shared("InternalError"),
          },
        },
      },
      "/market/{id}": {
        get: {
          operationId: "getMarketListing",
          tags: ["Market"],
          summary: "Объявление",
          description:
            "Карточка с отметкой `saved` вошедшего зрителя. Проданное и истёкшее объявление читается с пометкой (`status`, `expired`). Черновик читает только владелец; скрытое, чужой черновик, объявление заблокированного продавца и неизвестный `id` — одинаковый 404. `contact` и `expiresAt` — только владельцу.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("MarketListingId"),
          responses: {
            "200": success("Объявление.", "MarketListingDetail"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/market/{id}/contact": {
        get: {
          operationId: "getMarketContact",
          tags: ["Market"],
          summary: "Контакт продавца",
          description:
            "Контакт одного объявления: нужен вход, подтверждённая почта и укладывается в лимит запросов контактов (20 за окно, общий с сайтом). Контакт объявления, которое уже не на рынке (проданное, истёкшее), чужому не отдаётся: 404. Владелец читает свой контакт всегда.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("MarketListingId"),
          responses: {
            "200": success("Контакт.", "MarketContact"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "403": failure(
              "Почта не подтверждена (`email_verification_required`).",
            ),
            "404": shared("NotFound"),
            "429": failure(
              "Слишком много запросов контактов; секунды до конца окна — в `Retry-After`.",
            ),
            "500": shared("InternalError"),
          },
        },
      },
      "/market/{id}/others": {
        get: {
          operationId: "listMarketSellerOthers",
          tags: ["Market"],
          summary: "Другие объявления продавца",
          description:
            "До четырёх других действующих объявлений того же продавца, новые сверху, и их общее число. Все остальные: `/market?seller=`. Доступно, если читается само объявление.",
          security: [{}, { cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("MarketListingId"),
          responses: {
            "200": success("Объявления продавца.", "MarketOthers"),
            "400": failure(
              "Неверный или повторённый параметр, неверный курсор либо cookie вместе с Authorization.",
            ),
            "401": failure(
              "Недействительный или истёкший токен либо неподдерживаемая схема Authorization.",
            ),
            "404": shared("NotFound"),
            "500": shared("InternalError"),
          },
        },
      },
      "/market/{id}/save": {
        put: {
          operationId: "saveMarketListing",
          tags: ["Market"],
          summary: "Добавить объявление в избранное",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние. Сохранить можно только объявление, которое на рынке сейчас; снять можно любое.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("MarketListingId"),
          responses: SAVE_RESPONSES,
        },
        delete: {
          operationId: "unsaveMarketListing",
          tags: ["Market"],
          summary: "Убрать объявление из избранного",
          description:
            "Переключатель идемпотентен: `PUT` ставит состояние, `DELETE` снимает, повтор ничего не меняет, ответ — итоговое состояние.",
          security: [{ cookieSession: [] }, { bearerAuth: [] }],
          parameters: refs("MarketListingId"),
          responses: SAVE_RESPONSES,
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
      "/app-config": {
        get: {
          operationId: "getAppConfig",
          tags: ["App"],
          summary: "Настройки приложения",
          description:
            "Что приложение может менять без новой сборки: экран запуска после системного splash, знакомство, сообщение, служебные ссылки, доступность уже встроенных функций и политика версий. Без входа, одинаково для всех; заголовки входа не читаются. Только перечисленные поля, без разметки, стилей и кода; поля со временем только добавляются, неизвестные приложение пропускает. Ответ свеж минуту (`Cache-Control: public, max-age=60`), затем запрос с `If-None-Match` получает 304 без тела, если ничего не изменилось. `revision` растёт с каждым сохранением в админке; `ETag` меняется и при смене настроек сервера (например, готовности входа через Яндекс ID).",
          security: [],
          parameters: [
            {
              name: "If-None-Match",
              in: "header",
              required: false,
              description: "`ETag` прошлого ответа: без изменений ответ — 304.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Настройки приложения.",
              headers: {
                ...requestIdHeader,
                ETag: {
                  description: "Валидатор этого ответа для `If-None-Match`.",
                  schema: { type: "string" },
                },
                "Cache-Control": {
                  description: "`public, max-age=60`.",
                  schema: { type: "string" },
                },
              },
              content: json("AppConfig"),
            },
            "304": {
              description: "Настройки не изменились: тела нет, `ETag` тот же.",
              headers: {
                ...requestIdHeader,
                ETag: {
                  description: "Тот же валидатор.",
                  schema: { type: "string" },
                },
              },
            },
            "405": failure("Другой метод: разрешены GET, HEAD и OPTIONS."),
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
        JournalId: parameters.journalId,
        RideId: parameters.rideId,
        RideText: parameters.rideText,
        ComponentModelId: parameters.componentModelId,
        MarketListingId: parameters.marketListingId,
        CommentId: parameters.commentId,
        Focus: parameters.focus,
        SessionId: {
          name: "id",
          in: "path",
          required: true,
          description: "Публичный идентификатор сессии из списка сессий.",
          schema: { type: "string", format: "uuid" },
        },
        NotificationId: {
          name: "id",
          in: "path",
          required: true,
          description: "Идентификатор уведомления из списка.",
          schema: { type: "string", format: "uuid" },
        },
        JournalPhotoId: {
          name: "photoId",
          in: "path",
          required: true,
          description: "Идентификатор фото записи журнала (UUID).",
          schema: { type: "string", format: "uuid" },
        },
        BikePhotoId: {
          name: "photoId",
          in: "path",
          required: true,
          description: "Идентификатор фото велосипеда (UUID).",
          schema: { type: "string", format: "uuid" },
        },
        BikeComponentId: {
          name: "componentId",
          in: "path",
          required: true,
          description: "Идентификатор компонента велосипеда (UUID).",
          schema: { type: "string", format: "uuid" },
        },
        RideIntentId: {
          name: "id",
          in: "path",
          required: true,
          description: "Идентификатор намерения покататься (UUID).",
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
  withCommentWrites(document);
  withChat(document);
  withPlanning(document);
  withBikeWrites(document);
  withBikePhotos(document);
  withJournalWrites(document);
  withAccount(document);
  withNearby(document);
  return document;
}
