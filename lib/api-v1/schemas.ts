import { z } from "zod";
import { categoryFilterLabels } from "../bike-classification.ts";
import { ApiError, apiErrorCodes, detailsOf } from "./errors.ts";

// The /api/v1 contract (#134), written once. These schemas describe the
// responses (tests parse real responses with them), validate query strings,
// and become the components of the OpenAPI document (openapi.ts). Objects are
// strict: a field nobody listed here can never reach a client.

/** Every named schema: its id becomes a component of the OpenAPI document. */
export const schemaRegistry = z.registry<{ id: string }>();
function named<T extends z.ZodType>(
  id: string,
  description: string,
  schema: T,
): T {
  // describe() returns a new schema, and that one is what gets registered.
  const described = schema.describe(description);
  schemaRegistry.add(described, { id });
  return described;
}

const id = z.uuid();
const instant = z.iso.datetime();

export const authorSchema = named(
  "BikeAuthor",
  "Публичные данные автора велосипеда.",
  z.strictObject({
    id,
    username: z.string(),
    name: z.string(),
    avatarUrl: z
      .string()
      .nullable()
      .describe("Путь к изображению относительно адреса сайта или null."),
  }),
);

export const photoSchema = named(
  "BikePhoto",
  "Фотография велосипеда. Файл отдаёт `url`; доступ к нему проверяется так же, как к велосипеду.",
  z.strictObject({
    id,
    isCover: z.boolean(),
    url: z.string().describe("Путь к файлу относительно адреса сайта."),
    sourcePageUrl: z
      .string()
      .nullable()
      .describe("Страница-источник, если фото импортировано."),
  }),
);

export const componentSchema = named(
  "BikeComponent",
  "Компонент или аксессуар велосипеда.",
  z.strictObject({
    id,
    modelId: id
      .nullable()
      .describe("Модель из каталога компонентов, если выбрана."),
    section: z.enum(["build", "accessories"]),
    category: z.string(),
    name: z.string(),
    notes: z.string(),
    url: z.string(),
    groupId: z.string(),
    sortOrder: z.int(),
    price: z
      .number()
      .nullable()
      .describe(
        "Цена в рублях. Чужая цена приходит только если владелец её показывает, иначе null.",
      ),
  }),
);

export const classificationSchema = named(
  "BikeClassification",
  "Независимые признаки типа велосипеда.",
  z.strictObject({
    category: z.string(),
    subtype: z.string().nullable(),
    suspension: z.string().nullable(),
    construction: z.string().nullable(),
    uses: z.array(z.string()),
    electric: z.boolean(),
    fatbike: z.boolean(),
  }),
);

export const scoresSchema = named(
  "BikeScores",
  "Оценки полноты описания и апгрейдов.",
  z.strictObject({ completeness: z.number(), upgrade: z.number() }),
);

export const priceVisibilitySchema = named(
  "BikePriceVisibility",
  "Какие цены владелец показывает другим. Приходит только владельцу.",
  z.strictObject({
    bike: z.boolean(),
    components: z.boolean(),
    accessories: z.boolean(),
  }),
);

const summaryShape = {
  id,
  name: z.string(),
  brand: z.string(),
  model: z.string(),
  trim: z.string(),
  year: z.int(),
  category: z.string(),
  classification: classificationSchema,
  isFormer: z.boolean(),
  isPublic: z.boolean(),
  isOwner: z.boolean().describe("Велосипед принадлежит текущему пользователю."),
  coverPhoto: photoSchema
    .nullable()
    .describe("Обложка, а без неё первое фото; null, если фото нет."),
  photoCount: z.int(),
  author: authorSchema.nullable(),
  likes: z.int(),
  liked: z.boolean().describe("Текущий пользователь поставил лайк."),
  comments: z.int(),
  scores: scoresSchema,
};

export const bikeSummarySchema = named(
  "BikeSummary",
  "Краткая карточка велосипеда для списка.",
  z.strictObject(summaryShape),
);

export const bikeSchema = named(
  "Bike",
  "Карточка велосипеда.",
  z.strictObject({
    ...summaryShape,
    description: z.string(),
    color: z.string(),
    size: z.string(),
    weight: z.number().nullable().describe("Вес в килограммах."),
    mileage: z.int().describe("Пробег в километрах."),
    manufacturerUrl: z.string(),
    purposes: z.array(z.string()),
    groupOrder: z
      .array(z.string())
      .describe("Порядок групп компонентов, выбранный владельцем."),
    price: z
      .number()
      .nullable()
      .describe(
        "Цена велосипеда в рублях. Чужая цена приходит только если владелец её показывает, иначе null.",
      ),
    priceVisibility: priceVisibilitySchema.nullable(),
    components: z.array(componentSchema),
    photos: z.array(photoSchema),
  }),
);

export const bikePageSchema = named(
  "BikePage",
  "Страница списка велосипедов.",
  z.strictObject({
    items: z.array(bikeSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const meSchema = named(
  "Me",
  "Текущий пользователь. Только поля, перечисленные здесь.",
  z.strictObject({
    id,
    username: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(["user", "admin"]),
    bio: z.string(),
    location: z.string(),
    avatarUrl: z.string().nullable(),
    createdAt: instant,
    emailVerifiedAt: instant
      .nullable()
      .describe("Когда подтверждена почта; null, если не подтверждена."),
  }),
);

export const errorSchema = named(
  "Error",
  "Ошибка. Клиент ветвится по `code`; `message` — для людей.",
  z.strictObject({
    error: z.strictObject({
      code: z.enum(apiErrorCodes),
      message: z.string(),
      details: z
        .array(z.strictObject({ path: z.string(), message: z.string() }))
        .optional()
        .describe("Что именно не так: путь параметра и сообщение."),
    }),
  }),
);

const platform = z.enum(["ios", "android", "other"]);

export const deviceInputSchema = named(
  "DeviceInput",
  "Описание устройства, которое входит в аккаунт. Показывается человеку в списке его устройств.",
  z.strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Название устройства, например «iPhone Ивана»."),
    platform,
    appVersion: z.string().trim().min(1).max(40).optional(),
  }),
);

export const createSessionRequestSchema = named(
  "CreateSessionRequest",
  "Вход с устройства по почте и паролю.",
  z.strictObject({
    email: z.string().min(3).max(254),
    password: z.string().min(1).max(128),
    device: deviceInputSchema,
  }),
);

export const refreshRequestSchema = named(
  "RefreshRequest",
  "Обмен refresh-токена на новую пару. Refresh-токен передаётся только в теле этого запроса.",
  z.strictObject({
    refreshToken: z
      .string()
      .regex(/^cola_rt_[A-Za-z0-9_-]{43}$/, "Неверный формат refresh-токена"),
  }),
);

export const accountSessionSchema = named(
  "AccountSession",
  "Сессия аккаунта: браузер или устройство. Хеши и токены не передаются.",
  z.strictObject({
    id,
    kind: z.enum(["browser", "device"]),
    deviceName: z.string().nullable(),
    platform: platform.nullable(),
    appVersion: z.string().nullable(),
    userAgent: z.string(),
    createdAt: instant,
    lastSeenAt: instant,
    current: z
      .boolean()
      .describe("Сессия, которой сделан этот запрос (по токену или cookie)."),
  }),
);

export const sessionListSchema = named(
  "SessionList",
  "Активные сессии аккаунта: сначала текущая, затем по последней активности.",
  z.strictObject({ items: z.array(accountSessionSchema) }),
);

export const sessionGrantSchema = named(
  "SessionGrant",
  "Новая сессия устройства и пара токенов. Токены показываются только в этом ответе: храните их в Keychain/Keystore.",
  z.strictObject({
    session: accountSessionSchema,
    accessToken: z
      .string()
      .describe(
        "Короткоживущий токен доступа (`cola_at_…`), заголовок `Authorization: Bearer`.",
      ),
    accessTokenExpiresAt: instant,
    refreshToken: z
      .string()
      .describe(
        "Одноразовый refresh-токен (`cola_rt_…`). Каждый обмен выдаёт новый; обновляйте токен в один поток.",
      ),
    refreshTokenExpiresAt: instant.describe(
      "Когда refresh-токен перестанет работать, если им не пользоваться. Абсолютный срок сессии больше.",
    ),
    user: meSchema,
  }),
);

export type Me = z.infer<typeof meSchema>;
export type SessionGrant = z.infer<typeof sessionGrantSchema>;
export type AccountSession = z.infer<typeof accountSessionSchema>;
export type BikeSummary = z.infer<typeof bikeSummarySchema>;
export type Bike = z.infer<typeof bikeSchema>;
export type BikePage = z.infer<typeof bikePageSchema>;

/** A bike id in a path. */
export const bikeIdSchema = z.uuid();

export const LIST_LIMIT = Object.freeze({ min: 1, max: 50, default: 24 });
export const SEARCH_MAX = 150;
const CATEGORY_MAX_KEYS = 50;

function categoryKeys(value: string) {
  return value.split(",").filter(Boolean);
}

// Query strings are text on the wire; this schema turns them into typed values.
// The OpenAPI document describes the same parameters in openapi.ts.
export const listQuerySchema = z.strictObject({
  scope: z.enum(["public", "mine"]).default("public"),
  category: z
    .string()
    .max(2000)
    .default("")
    .refine(
      (value) =>
        categoryKeys(value).length <= CATEGORY_MAX_KEYS &&
        categoryKeys(value).every((key) =>
          Object.hasOwn(categoryFilterLabels, key),
        ),
      "Неизвестный тип велосипеда",
    ),
  q: z.string().trim().max(SEARCH_MAX).default(""),
  limit: z
    .string()
    .regex(/^\d{1,3}$/, "Ожидается целое число")
    .transform(Number)
    .pipe(z.int().min(LIST_LIMIT.min).max(LIST_LIMIT.max))
    .default(LIST_LIMIT.default),
  cursor: z.string().min(1).max(200).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** The category filter as a list of keys, in the form the shared query takes. */
export const categoriesOf = categoryKeys;

/** Validated query of GET /api/v1/bikes; a repeated or unknown parameter is an error. */
export function parseListQuery(url: URL): ListQuery {
  const entries = [...url.searchParams];
  const repeated = entries
    .map(([key]) => key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  if (repeated.length)
    throw new ApiError("invalid_request", "Проверьте параметры запроса.", {
      details: [...new Set(repeated)].map((path) => ({
        path,
        message: "Параметр передан несколько раз",
      })),
    });
  const result = listQuerySchema.safeParse(Object.fromEntries(entries));
  if (!result.success)
    throw new ApiError("invalid_request", "Проверьте параметры запроса.", {
      details: detailsOf(result.error),
    });
  return result.data;
}
