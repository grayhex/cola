import { z } from "zod";
import { categoryFilterLabels } from "../bike-classification.ts";
import { classificationQueryShape } from "../classification-validation.ts";
import { listingTypeKeys } from "../market-types.ts";
import { notificationCategoryKeys } from "../notification-catalog.ts";
import { notificationSettingsPatch } from "../notification-settings.ts";
import { circleModes, muteKinds } from "../notification-policy.ts";
import { nativeCodePattern, verifierPattern } from "../native-auth.ts";
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
  "Author",
  "Публичные данные автора: велосипеда, записи, комментария.",
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

export const errorDetailSchema = named(
  "ErrorDetail",
  "Что именно не так в запросе: путь параметра или поля и сообщение.",
  z.strictObject({ path: z.string(), message: z.string() }),
);

/**
 * The codes the server uses today. The set is open: a new code is an additive
 * change, so a client must handle any other value by the HTTP status.
 */
export const errorCodeSchema = named(
  "ErrorCode",
  "Известные коды ошибок. Набор открыт: клиент обязан обработать неизвестный код по HTTP-статусу. Схема `Error` намеренно хранит код строкой, а не этим перечислением, чтобы новый код не ломал разбор у выпущенных приложений.",
  z.enum(apiErrorCodes),
);

export const errorBodySchema = named(
  "ErrorBody",
  "Содержимое ошибки: код для программы, сообщение для людей, подробности.",
  z.strictObject({
    code: z
      .string()
      .describe(
        "Код ошибки, по нему ветвится клиент. Набор открыт, известные значения перечислены в схеме `ErrorCode`.",
      ),
    message: z.string(),
    details: z
      .array(errorDetailSchema)
      .optional()
      .describe("Что именно не так: путь параметра и сообщение."),
  }),
);

export const errorSchema = named(
  "Error",
  "Ошибка. Клиент ветвится по `error.code`; `message` — для людей. Набор кодов открыт.",
  z.strictObject({ error: errorBodySchema }),
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
  "Вход с устройства: либо `email` и `password`, либо `code` и `codeVerifier` (нативный вход через внешнего провайдера: одноразовый код ColaBike и секрет, чей S256-образ приложение отправило в начале входа). Ровно один способ.",
  z
    .strictObject({
      email: z.string().min(3).max(254).optional(),
      password: z.string().min(1).max(128).optional(),
      code: z
        .string()
        .regex(nativeCodePattern, "Неверный формат кода входа")
        .optional()
        .describe("Одноразовый код с ссылки приложения; живёт две минуты."),
      codeVerifier: z
        .string()
        .regex(verifierPattern, "Неверный формат code_verifier")
        .optional()
        .describe(
          "Секрет приложения (RFC 7636, 43–128 знаков), S256-образ которого ушёл в начале входа.",
        ),
      device: deviceInputSchema,
    })
    .refine(
      (body) =>
        (body.email !== undefined && body.password !== undefined) !==
          (body.code !== undefined && body.codeVerifier !== undefined) &&
        (body.email === undefined) === (body.password === undefined) &&
        (body.code === undefined) === (body.codeVerifier === undefined),
      {
        message: "Нужна одна пара: email и password либо code и codeVerifier",
      },
    ),
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

export const relationshipSchema = named(
  "Relationship",
  "Отношения вошедшего зрителя с человеком. Для гостя вместо них null.",
  z.strictObject({
    isSelf: z.boolean(),
    following: z.boolean().describe("Зритель подписан на человека."),
    followedBy: z.boolean().describe("Человек подписан на зрителя."),
    friends: z.boolean().describe("Подписки взаимны."),
  }),
);

export const userSummarySchema = named(
  "UserSummary",
  "Человек в списке: публичные данные автора и отношения зрителя.",
  z.strictObject({
    id,
    username: z.string(),
    name: z.string(),
    avatarUrl: z
      .string()
      .nullable()
      .describe("Путь к изображению относительно адреса сайта или null."),
    relationship: relationshipSchema.nullable(),
  }),
);

export const profileCountsSchema = named(
  "ProfileCounts",
  "Счётчики профиля: публичные велосипеды и подписки без заблокированных людей.",
  z.strictObject({
    bikes: z.int(),
    followers: z.int(),
    following: z.int(),
  }),
);

export const profileSchema = named(
  "Profile",
  "Публичный профиль. Почта, настройки и роль не передаются никогда.",
  z.strictObject({
    id,
    username: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    bio: z.string(),
    location: z.string(),
    createdAt: instant,
    counts: profileCountsSchema,
    relationship: relationshipSchema.nullable(),
  }),
);

export const userPageSchema = named(
  "UserPage",
  "Страница людей: подписчики или подписки.",
  z.strictObject({
    items: z.array(userSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

const journalKind = z.enum(["build", "service", "review", "question", "story"]);
const entryStatus = z.enum(["draft", "published"]);

export const bikeRefSchema = named(
  "BikeRef",
  "Велосипед, к которому относится запись.",
  z.strictObject({ id, name: z.string() }),
);

export const entryPhotoSchema = named(
  "EntryPhoto",
  "Фотография записи журнала; доступ к файлу проверяется как к записи.",
  z.strictObject({
    id,
    url: z.string().describe("Путь к файлу относительно адреса сайта."),
  }),
);

const entrySummaryShape = {
  id,
  kind: journalKind,
  title: z.string(),
  status: entryStatus.describe(
    "Черновик виден только владельцу; остальные видят только опубликованное.",
  ),
  isPublic: z.boolean(),
  eventDate: z.iso.date().nullable(),
  mileage: z.int().nullable().describe("Пробег в километрах на момент записи."),
  createdAt: instant,
  updatedAt: instant,
  bike: bikeRefSchema,
  author: authorSchema,
  likes: z.int(),
  comments: z
    .int()
    .describe("Видимые комментарии без удалённых и заблокированных авторов."),
  liked: z
    .boolean()
    .describe("Поставил ли лайк вошедший зритель; для гостя false."),
};

export const journalSummarySchema = named(
  "JournalSummary",
  "Запись журнала в списке: без полного текста, фотографий и снимка компонентов.",
  z.strictObject({
    ...entrySummaryShape,
    excerpt: z.string().describe("Начало текста без разметки, до 240 знаков."),
  }),
);

export const journalComponentSchema = named(
  "JournalComponent",
  "Компонент в снимке записи на момент её сохранения. Цена приходит по правилам цен велосипеда, иначе null.",
  componentSchema.extend({
    capturedAt: instant.nullable().describe("Когда снимок сделан."),
  }),
);

export const journalEntrySchema = named(
  "JournalEntry",
  "Запись журнала целиком. `body` — исходный текст в разметке Markdown; фотографии записи перечислены отдельно.",
  z.strictObject({
    ...entrySummaryShape,
    body: z.string(),
    components: z.array(journalComponentSchema),
    photos: z.array(entryPhotoSchema),
  }),
);

export const journalPageSchema = named(
  "JournalPage",
  "Страница записей журнала велосипеда, новые сверху.",
  z.strictObject({
    items: z.array(journalSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const commentSchema = named(
  "Comment",
  "Комментарий. Один вид для велосипедов, записей и других целей. Удалённый, скрытый или комментарий заблокированного автора остаётся «надгробием» только пока под ним есть читаемые ответы: тогда `deleted` = true, а `body` и `author` — null.",
  z.strictObject({
    id,
    parentId: id
      .nullable()
      .describe(
        "Корневой комментарий или null; ответы вкладываются на один уровень.",
      ),
    author: authorSchema.nullable(),
    body: z.string().nullable(),
    createdAt: instant,
    editedAt: instant
      .nullable()
      .describe("Когда комментарий правили; null, если не правили."),
    deleted: z.boolean(),
    replyCount: z.int().describe("Читаемые ответы."),
  }),
);

export const commentThreadSchema = named(
  "CommentThread",
  "Корневой комментарий и превью его ответов: не больше трёх первых.",
  z.strictObject({ comment: commentSchema, replies: z.array(commentSchema) }),
);

export const commentPageSchema = named(
  "CommentPage",
  "Страница корневых комментариев, старые сверху.",
  z.strictObject({
    items: z.array(commentThreadSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
    focusPath: z
      .array(commentSchema)
      .describe(
        "С `focus`: цепочка от корня до нужного комментария, иначе пустой массив. Тогда `items` — одна ветка этого корня, страниц больше нет.",
      ),
  }),
);

export const replyPageSchema = named(
  "ReplyPage",
  "Страница ответов на комментарий, старые сверху.",
  z.strictObject({
    items: z.array(commentSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

const rideMetricsSchema = named(
  "RideMetrics",
  "Показатели покатушки. Для плана без трека расстояния нет (null).",
  z.strictObject({
    distanceM: z.int().nullable(),
    elapsedTimeS: z.int().nullable(),
    movingTimeS: z.int().nullable(),
    avgSpeedMps: z.number().nullable(),
    elevationGainM: z.number().nullable(),
  }),
);

const participantsSchema = named(
  "RideParticipants",
  "Сколько человек ответили на план; без имён.",
  z.strictObject({
    going: z.int().describe("Ответили «еду»."),
    maybe: z.int().describe("Ответили «возможно»."),
  }),
);

const rideSummaryShape = {
  id,
  title: z.string(),
  status: z
    .enum(["completed", "planned"])
    .describe("Состоявшаяся покатушка или план; отменённых в API нет."),
  kind: z
    .enum(["recorded", "planned"])
    .describe("Откуда данные: запись трека или план покатушки."),
  startedAt: instant
    .nullable()
    .describe(
      "Начало состоявшейся покатушки; null у плана и у трека без времени.",
    ),
  scheduledAt: instant
    .nullable()
    .describe(
      "Ближайшая дата плана (у еженедельной серии — следующая); у состоявшейся покатушки null.",
    ),
  recurrence: z.enum(["none", "weekly"]),
  hasTrack: z.boolean(),
  metrics: rideMetricsSchema,
  bike: bikeRefSchema,
  author: authorSchema,
  likes: z.int(),
  comments: z.int(),
  liked: z
    .boolean()
    .describe("Поставил ли лайк вошедший зритель; для гостя false."),
  participants: participantsSchema
    .nullable()
    .describe("Количество ответивших на план, без имён; у состоявшейся null."),
};

export const rideSummarySchema = named(
  "RideSummary",
  "Покатушка в списке: без геометрии и без описания, чтобы список оставался лёгким.",
  z.strictObject(rideSummaryShape),
);

export const rideLineSchema = named(
  "RideGeometry",
  "Публичная геометрия в формате GeoJSON MultiLineString: координаты [долгота, широта]. Участки внутри зоны приватности обрезаны, поэтому линий может быть несколько, и между ними нельзя проводить отрезок.",
  z.strictObject({
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(z.array(z.number()).min(2).max(3))),
  }),
);

const rangeSchema = named(
  "RideRange",
  "Диапазон значений плана от `min` до `max`.",
  z.strictObject({ min: z.number(), max: z.number() }),
);

const areaSchema = named(
  "RideArea",
  "Район плана: подпись и, если задан, грубая область на карте.",
  z.strictObject({
    label: z.string(),
    center: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("Центр области с точностью до сотой градуса, не точка."),
    radiusM: z.int().optional(),
  }),
);

export const ridePassportSchema = named(
  "RidePassport",
  "Паспорт плана: ожидания организатора. Все поля необязательны; значения `purpose`, `pace`, `surface`, `difficulty` и `regroupPolicy` — открытый набор строк, неизвестное значение клиент показывает как есть.",
  z.strictObject({
    area: areaSchema.optional(),
    purpose: z.string().optional(),
    pace: z.string().optional(),
    surface: z.string().optional(),
    difficulty: z.string().optional(),
    regroupPolicy: z.string().optional(),
    distanceKm: rangeSchema.optional(),
    durationMinutes: rangeSchema.optional(),
    groupSize: rangeSchema.optional(),
    speedKmh: rangeSchema.optional(),
    beginnerFriendly: z.boolean().optional(),
  }),
);

export const rideSchema = named(
  "Ride",
  "Покатушка целиком. Геометрия только публичная (участки у начала и конца внутри радиуса приватности обрезаны), точка встречи «только участникам» скрыта от остальных. Владельческих полей (приватность, число точек, полные серии, `isPublic`) нет: они в личных ответах владельца.",
  z.strictObject({
    ...rideSummaryShape,
    description: z.string(),
    features: z.array(z.string()),
    meetingPoint: z
      .string()
      .nullable()
      .describe(
        "Текст точки встречи; null, если её нет или она скрыта (`meetingHidden`).",
      ),
    meetingHidden: z
      .boolean()
      .describe(
        "Точка встречи есть, но показывается только организатору и принявшим участие.",
      ),
    expectedEndAt: instant
      .nullable()
      .describe("Ожидаемое окончание ближайшей даты плана."),
    recruitmentClosed: z
      .boolean()
      .describe("Организатор закрыл набор на ближайшую дату."),
    passport: ridePassportSchema.nullable().describe("Только у плана."),
    geometry: rideLineSchema
      .nullable()
      .describe("Null, если у покатушки нет публичного трека."),
    bounds: z
      .array(z.number())
      .length(4)
      .nullable()
      .describe(
        "Рамка публичной геометрии [запад, юг, восток, север] или null.",
      ),
    extraMetrics: z
      .record(z.string(), z.number())
      .describe(
        "Показатели датчиков и устройства (пульс, мощность, калории…), которые автор разрешил показывать; пусто, если ничего не открыто.",
      ),
  }),
);

export const ridePageSchema = named(
  "RidePage",
  "Страница покатушек.",
  z.strictObject({
    items: z.array(rideSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const ownRideSummarySchema = named(
  "OwnRideSummary",
  "Своя покатушка в списке владельца: любое состояние, публичная или нет. Владельческие поля (`isPublic`, зона приватности, число точек) есть только здесь, в публичном `RideSummary` их нет.",
  z.strictObject({
    ...rideSummaryShape,
    status: z
      .enum(["completed", "planned", "cancelled"])
      .describe("Состоявшаяся, запланированная или отменённая."),
    isPublic: z.boolean(),
    privacyEnabled: z
      .boolean()
      .describe("Включена ли зона приватности вокруг начала и конца трека."),
    privacyRadiusM: z.int().describe("Радиус зоны приватности, метры."),
    pointCount: z.int().describe("Число точек загруженного трека."),
  }),
);

export const ownRidePageSchema = named(
  "OwnRidePage",
  "Страница своих покатушек, новые сверху.",
  z.strictObject({
    items: z.array(ownRideSummarySchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const myUpcomingRideSchema = named(
  "MyUpcomingRide",
  "Ближайший план человека и его роль в нём. Точка встречи — по правилам участников: скрыта, пока человек не принял условия.",
  z.strictObject({
    ...rideSummaryShape,
    status: z
      .enum(["planned", "cancelled"])
      .describe("`cancelled` — весь план отменён, а человек на него отвечал."),
    role: z
      .enum(["organizer", "accepted", "maybe", "invited", "cancelled"])
      .describe(
        "Роль человека: организатор, «еду», «возможно», приглашён без ответа или ответил на отменённую дату.",
      ),
    occurrenceCancelled: z
      .boolean()
      .describe(
        "Отменена одна дата серии, на которую человек отвечал; сама серия идёт дальше.",
      ),
    changedAfterAnswer: z
      .boolean()
      .describe(
        "Условия плана изменились после ответа человека: ответ нужно подтвердить.",
      ),
    meetingPoint: z.string().nullable(),
    meetingHidden: z
      .boolean()
      .describe("Точка встречи есть, но человеку пока не показывается."),
  }),
);

export const myUpcomingRidesSchema = named(
  "MyUpcomingRides",
  "Ближайшие планы человека: свои, принятые, «возможно», приглашения и недавние отмены; до 20 штук на 60 дней вперёд, ближайшие первыми. Без курсора.",
  z.strictObject({ items: z.array(myUpcomingRideSchema) }),
);

const analysisPointSchema = named(
  "RideAnalysisPoint",
  "Точка публичной серии. Датчик, который автор не открыл, отсутствует; абсолютного времени нет, только время в пути `elapsedS`.",
  z.strictObject({
    coord: z.array(z.number()).length(2),
    distanceM: z.number().nullable(),
    elapsedS: z.number().nullable(),
    elevationM: z.number().nullable(),
    speedMps: z.number().nullable(),
    gradePct: z.number().nullable(),
    hrBpm: z.number().nullable().optional(),
    cadenceRpm: z.number().nullable().optional(),
    powerW: z.number().nullable().optional(),
    gaps: z
      .int()
      .describe(
        "Битовая маска каналов, у которых между предыдущей показанной точкой и этой были пропуски значений (линию в таком месте не интерполируют): elevationM = 1, speedMps = 2, gradePct = 4, hrBpm = 8, cadenceRpm = 16, powerW = 32.",
      ),
  }),
);

export const rideAnalysisSchema = named(
  "RideAnalysis",
  "Публичные серии разбора трека для графиков. Участки в зонах приватности обрезаны, как у геометрии.",
  z.strictObject({
    channels: z
      .array(z.string())
      .describe("Каналы, у которых есть значения; открытый набор имён."),
    pointCount: z
      .int()
      .describe(
        "Сколько точек показано; число точек исходного трека не передаётся.",
      ),
    downsampled: z.boolean(),
    segments: z
      .array(z.array(analysisPointSchema))
      .describe("Непрерывные участки; между ними разрывы."),
  }),
);

export const bikeLikeSchema = named(
  "BikeLike",
  "Итоговое состояние лайка велосипеда после `PUT` или `DELETE`: повтор запроса даёт тот же ответ.",
  z.strictObject({
    liked: z.boolean().describe("Лайк стоит."),
    likes: z.int().describe("Лайки без заблокированных людей."),
  }),
);

export const followResultSchema = named(
  "FollowResult",
  "Итоговое состояние подписки после `PUT` или `DELETE`: отношения и число подписчиков человека.",
  z.strictObject({
    relationship: relationshipSchema,
    followers: z.int().describe("Подписчики без заблокированных людей."),
  }),
);

export const saveResultSchema = named(
  "SaveResult",
  "Итоговое состояние «сохранить» после `PUT` или `DELETE`: повтор запроса даёт тот же ответ.",
  z.strictObject({ saved: z.boolean() }),
);

export const componentHitSchema = named(
  "ComponentHit",
  "Название компонента публичных велосипедов и число публичных велосипедов, на которых оно встречается.",
  z.strictObject({
    name: z.string(),
    bikes: z.int(),
  }),
);

export const componentHitListSchema = named(
  "ComponentHitList",
  "Подсказки по компонентам: короткий список по убыванию числа велосипедов, затем по названию. Не страницы: курсора нет.",
  z.strictObject({ items: z.array(componentHitSchema) }),
);

export const componentModelSchema = named(
  "ComponentModel",
  "Модель компонента из публичного каталога. Установки, владельцы и приватные даты не передаются: только то, что показывает страница модели. Слитая модель отдаёт каноническую (`id` — её).",
  z.strictObject({
    id,
    category: z.string(),
    brand: z.string(),
    name: z.string(),
    description: z.string(),
    path: z
      .string()
      .describe("Путь страницы модели на сайте относительно его адреса."),
    builds: z
      .int()
      .describe("Число публичных велосипедов без заблокированных владельцев."),
    firstPublicAt: instant,
    coverUrl: z
      .string()
      .nullable()
      .describe("Путь к обложке относительно адреса сайта или null."),
    archived: z
      .boolean()
      .describe(
        "Архивная модель читается по `id`, но в каталоге не перечисляется.",
      ),
  }),
);

export const componentModelPageSchema = named(
  "ComponentModelPage",
  "Страница каталога моделей компонентов. При `sort=popular` порядок по числу сборок, а оно меняется: если число сборок модели изменилось между двумя страницами, модель может встретиться дважды или пропуститься.",
  z.strictObject({
    items: z.array(componentModelSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const componentFiltersSchema = named(
  "ComponentFilters",
  "Категории и бренды перечисляемых моделей каталога: значения для фильтров.",
  z.strictObject({
    categories: z.array(z.string()),
    brands: z.array(z.string()),
  }),
);

export const componentPhotoSourceSchema = named(
  "ComponentPhotoSource",
  "Источник и лицензия фотографии из Wikimedia Commons: показывать вместе с фотографией.",
  z.strictObject({
    provider: z.string(),
    url: z.string(),
    title: z.string(),
    creator: z.string(),
    credit: z.string(),
    license: z.string(),
    licenseUrl: z.string(),
  }),
);

export const componentPhotoSchema = named(
  "ComponentPhoto",
  "Публичная фотография модели компонента. Скрытых фотографий и фотографий заблокированных авторов нет; состояния правки и модерации не передаются.",
  z.strictObject({
    id,
    url: z.string().describe("Путь к файлу относительно адреса сайта."),
    width: z.int(),
    height: z.int(),
    caption: z.string(),
    source: componentPhotoSourceSchema
      .nullable()
      .describe("Для фото из внешнего источника; у загруженных null."),
    author: authorSchema,
    createdAt: instant,
    isCover: z.boolean(),
  }),
);

export const componentPhotoListSchema = named(
  "ComponentPhotoList",
  "Галерея модели: до 60 фотографий, обложка первой.",
  z.strictObject({
    modelId: id,
    items: z.array(componentPhotoSchema),
  }),
);

const marketCatalogLinkSchema = named(
  "MarketCatalogLink",
  "Модель каталога, к которой привязано объявление. Имя и путь следуют правкам каталога; слитая модель отдаёт каноническую.",
  z.strictObject({
    id,
    name: z.string(),
    path: z.string().describe("Путь страницы модели относительно сайта."),
    archived: z.boolean(),
  }),
);

const marketBikeLinkSchema = named(
  "MarketBikeLink",
  "Публичный велосипед продавца, к которому привязано объявление. Приватный велосипед не показывается, даже если привязан.",
  z.strictObject({
    id,
    name: z.string(),
    path: z.string().describe("Путь страницы велосипеда относительно сайта."),
    // A plain boolean, not a literal: a generated client turns a boolean
    // constant into a one-value enum that does not compile (#325).
    isPublic: z
      .boolean()
      .describe("Всегда `true`: приватный велосипед в ссылку не попадает."),
  }),
);

const marketListingShape = {
  id,
  title: z.string(),
  description: z.string(),
  category: z.enum(["bikes", "components", "accessories"]),
  listingType: z.enum(listingTypeKeys),
  condition: z.enum(["new", "used"]),
  price: z
    .number()
    .nullable()
    .describe(
      "Цена в `currency`; null — «по договорённости»/обмен/бюджет не указан. У `listingType=free` — 0.",
    ),
  currency: z
    .string()
    .describe(
      "Валюта цены. Новые объявления только в RUB; старые могли быть в USD/EUR.",
    ),
  location: z.string(),
  hasContact: z
    .boolean()
    .describe(
      "Указан ли контакт. Сам контакт отдаёт `/market/{id}/contact` (вход, подтверждённая почта, лимит); владельцу он приходит в `contact`.",
    ),
  contact: z
    .string()
    .optional()
    .describe("Только владельцу объявления; остальным поля нет."),
  status: z
    .enum(["draft", "active", "sold"])
    .describe("Черновик виден только владельцу."),
  expired: z
    .boolean()
    .describe(
      "Срок размещения вышел: объявление не в списках, страница открывается с пометкой и без контакта.",
    ),
  expiresAt: instant
    .optional()
    .describe("Только владельцу: конец срока размещения."),
  createdAt: instant,
  publishedAt: instant.nullable(),
  path: z.string().describe("Путь страницы объявления относительно сайта."),
  photos: z.array(
    z.strictObject({
      id,
      url: z
        .string()
        .describe(
          "Путь к фото относительно сайта; `?width=` — уменьшенный вариант. Доступ проверяется при каждом запросе.",
        ),
    }),
  ),
  author: authorSchema,
  isOwner: z.boolean(),
  componentModel: marketCatalogLinkSchema.nullable(),
  bikeModel: marketCatalogLinkSchema.nullable(),
  linkedBike: marketBikeLinkSchema.nullable(),
};

export const marketListingSchema = named(
  "MarketListing",
  "Объявление барахолки. Контакт не входит в карточку; срок размещения виден только владельцу.",
  z.strictObject(marketListingShape),
);

export const marketListingDetailSchema = named(
  "MarketListingDetail",
  "Объявление с отметкой «в избранном» вошедшего зрителя (для гостя false).",
  z.strictObject({ ...marketListingShape, saved: z.boolean() }),
);

export const marketPageSchema = named(
  "MarketPage",
  "Страница объявлений в действующих и неблокированных продавцов. В порядке цены курсор хранит цену последнего объявления; объявления без цены идут в конце.",
  z.strictObject({
    items: z.array(marketListingSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const marketOthersSchema = named(
  "MarketOthers",
  "До четырёх других действующих объявлений того же продавца, новые сверху, и их общее число.",
  z.strictObject({
    items: z.array(marketListingSchema),
    total: z.int(),
  }),
);

export const marketContactSchema = named(
  "MarketContact",
  "Контакт продавца. Отдаётся по одному объявлению, только вошедшему человеку с подтверждённой почтой, с лимитом запросов.",
  z.strictObject({ contact: z.string() }),
);

export const marketSavedSchema = named(
  "MarketSaved",
  "Состояние избранного после операции.",
  z.strictObject({ saved: z.boolean() }),
);

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationSettingsBody = z.infer<
  typeof notificationSettingsSchema
>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type MarketListing = z.infer<typeof marketListingSchema>;
export type MarketListingDetail = z.infer<typeof marketListingDetailSchema>;
export const notificationTargetSchema = named(
  "NotificationTarget",
  "О чём уведомление: объект, его название и путь на сайте (с якорем комментария, если уведомление о нём). Название и путь вычисляются при чтении, поэтому следуют переименованиям и продлению.",
  z.strictObject({
    type: z
      .string()
      .describe(
        "bike, ride, journal, article, component, profile, market, account, bike-week или intent; набор открыт.",
      ),
    id,
    name: z.string(),
    path: z.string().describe("Путь на сайте относительно его адреса."),
    commentId: id
      .nullable()
      .describe(
        "Комментарий или ответ, о котором уведомление, иначе null. Приложение берёт его отсюда, а не из `path`.",
      ),
    occurrenceAt: instant
      .nullable()
      .describe(
        "Дата покатушки (occurrence), о которой уведомление: у приглашения, изменения, отмены, ответа участника и напоминания. У остальных и у старых приглашений, созданных до учёта дат, null: тогда ориентируйтесь на `type`, `id` и `path`.",
      ),
    agreementRevision: z
      .int()
      .nullable()
      .describe(
        "Версия договорённостей покатушки, к которой относится уведомление, иначе null.",
      ),
    expiresAt: instant
      .optional()
      .describe("Только у `market_expiring`: конец срока объявления."),
    state: z
      .enum(["closed", "expired", "expiring", "extended"])
      .optional()
      .describe(
        "Только у `market_expiring`: состояние объявления сейчас (закрыто, срок вышел, скоро выйдет, продлено).",
      ),
  }),
);

export const notificationSchema = named(
  "Notification",
  "Уведомление вошедшему. Показывается только то, что получатель вправе видеть сейчас: приватное, скрытое и заблокированное не просачивается, а отменённое действие (снятый лайк, удалённый комментарий) уведомления не оставляет.",
  z.strictObject({
    id,
    type: z
      .string()
      .describe(
        "follow, like, comment, reply, ride_like, ride_comment, ride_reply, journal_like, journal_comment, journal_reply, article_*, component_reply, market_expiring, session_reuse, bike_week и другие; набор открыт, неизвестный тип клиент показывает общим видом.",
      ),
    category: z
      .string()
      .describe(
        "Категория настроек и фильтра: rides, discussions, market, reactions, site; набор открыт, неизвестную клиент относит к «прочим».",
      ),
    createdAt: instant,
    readAt: instant.nullable(),
    actor: authorSchema
      .nullable()
      .describe("Кто это сделал; null у уведомлений от самого сайта."),
    target: notificationTargetSchema,
  }),
);

const watermark = z
  .string()
  .nullable()
  .describe(
    "Отметка сервера для «Прочитать все»: самое новое уведомление, которое человек мог видеть на момент ответа. Непрозрачный текст: его не разбирают и не составляют. Отметка действует только для аккаунта, которому выдана. null, если видимых уведомлений нет.",
  );

export const notificationPageSchema = named(
  "NotificationPage",
  "Страница уведомлений, новые сверху.",
  z.strictObject({
    items: z.array(notificationSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
    watermark,
  }),
);

export const notificationCountSchema = named(
  "NotificationCount",
  "Число непрочитанных: считается до 100; при `capped` их не меньше 100. `watermark` — отметка для «Прочитать все» без загрузки списка.",
  z.strictObject({ unread: z.int(), capped: z.boolean(), watermark }),
);

export const notificationReadResultSchema = named(
  "NotificationReadResult",
  "Итог пометки «прочитано»: сколько уведомлений помечено сейчас (повтор даёт 0) и сколько непрочитанных осталось, считая как `NotificationCount`.",
  z.strictObject({
    marked: z.int(),
    unread: z.int(),
    capped: z.boolean(),
  }),
);

export const notificationReadRequestSchema = named(
  "NotificationReadRequest",
  "Какие уведомления пометить прочитанными: их идентификаторы, не больше 100. Чужие и ещё не доставленные не считаются.",
  z.strictObject({ ids: z.array(id).min(1).max(100) }),
);

export const notificationReadAllRequestSchema = named(
  "NotificationReadAllRequest",
  "«Прочитать все» до отметки `watermark` из списка или счётчика: уведомления, пришедшие позже, остаются непрочитанными. С `category` — только эта категория.",
  z.strictObject({
    watermark: z.string().min(1).max(300),
    category: z.enum(notificationCategoryKeys).optional(),
  }),
);

const settingsFlag = named(
  "NotificationChannelFlag",
  "Переключатель канала в категории: может ли канал её передавать и включён ли он.",
  z.strictObject({ supported: z.boolean(), enabled: z.boolean() }),
);
export const notificationCategorySettingSchema = named(
  "NotificationCategorySetting",
  "Категория уведомлений и то, как она ходит по каналам. В списке только категории, которые сервер производит и которыми канал может поделиться; отсутствующую клиент не показывает.",
  z.strictObject({
    key: z
      .string()
      .describe(
        "rides, discussions, market; набор открыт: неизвестную категорию клиент пропускает.",
      ),
    label: z.string(),
    email: settingsFlag,
    push: settingsFlag,
  }),
);
const emailChannel = named(
  "NotificationEmailChannel",
  "Почта: настроена ли отправка на сервере, подтверждён ли адрес и дано ли согласие на письма.",
  z.strictObject({
    available: z.boolean(),
    verified: z.boolean(),
    enabled: z.boolean(),
  }),
);
const pushChannel = named(
  "NotificationPushChannel",
  "Push: подключена ли доставка на сервере и дано ли согласие аккаунта. Разрешение системы и регистрация конкретного телефона — не здесь: включить их сервер не может.",
  z.strictObject({ available: z.boolean(), enabled: z.boolean() }),
);
export const notificationSettingsSchema = named(
  "NotificationSettings",
  "Настройки уведомлений аккаунта: одни и те же для сайта и приложения. Версию объекта говорит заголовок `ETag`; `PATCH` принимает `If-Match`.",
  z.strictObject({
    channels: named(
      "NotificationChannels",
      "Каналы, кроме уведомлений внутри сайта: они есть всегда.",
      z.strictObject({ email: emailChannel, push: pushChannel }),
    ),
    categories: z.array(notificationCategorySettingSchema),
    reminders: z
      .boolean()
      .describe(
        "Напоминание о принятой покатушке за сутки, для всех каналов; по умолчанию включено.",
      ),
    timeZone: z
      .string()
      .nullable()
      .describe(
        "Часовой пояс человека (название из базы IANA, например Europe/Moscow), в котором читаются тихие часы; null, пока не указан.",
      ),
    quietHours: named(
      "NotificationQuietHours",
      "Тихие часы: пока окно открыто, внешние каналы ждут его конца. Сообщение, срок которого выходит раньше, не отправляется утром вовсе. Внутри приложения и сайта уведомления появляются всегда.",
      z.strictObject({
        enabled: z.boolean(),
        from: z.string().describe("Начало, ЧЧ:ММ по часам человека."),
        to: z
          .string()
          .describe(
            "Конец, ЧЧ:ММ; если раньше начала, окно переходит через полночь.",
          ),
        allowCancellations: z
          .boolean()
          .describe(
            "Явный выбор человека: отмена подтверждённого выезда, до которого меньше 12 часов, не ждёт конца тихих часов. По умолчанию выключено. Пауза этим не обходится.",
          ),
      }),
    ),
    pausedUntil: instant
      .nullable()
      .describe(
        "Пока пауза идёт, внешние каналы молчат; сказанное за это время потом не досылается. null — паузы нет.",
      ),
    circle: named(
      "NotificationCircle",
      "От кого человек узнаёт о новых планах и намерениях: `friends` — взаимные подписки (по умолчанию), `follows` — все, на кого подписан, `selected` — выбранные люди (`members`), `off` — ни от кого. Подписка и выбор не расширяют доступ: уведомление есть, только если человек и так вправе увидеть событие.",
      z.strictObject({
        mode: z.enum(circleModes),
        members: z.array(authorSchema),
      }),
    ),
    considering: z
      .boolean()
      .describe(
        "Сообщать и о намерениях, которые автор пока отметил «думаю»; по умолчанию нет.",
      ),
    mutes: z
      .array(
        named(
          "NotificationMute",
          "Заглушённое: автор (всё, что он делает), покатушка (всё о ней) или обсуждение (комментарии под объектом). Метка — название, если человек вправе его знать, иначе null.",
          z.strictObject({
            kind: z.enum(muteKinds),
            id: z.string(),
            label: z.string().nullable(),
          }),
        ),
      )
      .describe("Сначала самые давние."),
    updatedAt: instant
      .nullable()
      .describe(
        "Когда настройки менялись последний раз; null — ещё не менялись.",
      ),
  }),
);
export const notificationSettingsPatchSchema = named(
  "NotificationSettingsPatch",
  "Изменение настроек: меняется только указанное. Включение канала требует, чтобы он работал (почта — подтверждённый адрес и настроенную отправку; push — подключённую доставку); выключение возможно всегда.",
  notificationSettingsPatch,
);

export const feedItemSchema = named(
  "FeedItem",
  "Публикация в ленте: ровно одно из полей `bike`, `ride`, `journal`, `listing` заполнено, остальные null; какое — говорит `type`. Это те же карточки, что в списках (`BikeSummary`, `RideSummary`, `JournalSummary`, `MarketListing`).",
  z.strictObject({
    type: z.enum(["bike", "ride", "journal", "market"]),
    publishedAt: instant.describe(
      "Когда опубликовано: по этому времени лента упорядочена.",
    ),
    bike: bikeSummarySchema.nullable(),
    ride: rideSummarySchema.nullable(),
    journal: journalSummarySchema.nullable(),
    listing: marketListingSchema.nullable(),
  }),
);

export const feedPageSchema = named(
  "FeedPage",
  "Страница ленты, новые сверху. Лента состоит из публикаций тех, на кого подписан человек (и велосипедов, за которыми он следит); страница читается заново по видимости зрителя, поэтому скрытое между страницами не показывается.",
  z.strictObject({
    items: z.array(feedItemSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Курсор следующей страницы или null, если страниц больше нет."),
  }),
);

export const createCommentRequestSchema = named(
  "CreateCommentRequest",
  "Новый комментарий. `parentId` — комментарий того же объекта, на который отвечают; чужой или недоступный комментарий — 404.",
  z.strictObject({
    body: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((value) => !value.includes("\0"), "Недопустимый символ")
      .describe("Текст, от 1 до 1000 знаков после обрезки пробелов."),
    parentId: id.nullable().optional(),
  }),
);

export const editCommentRequestSchema = named(
  "EditCommentRequest",
  "Новый текст своего комментария.",
  z.strictObject({
    body: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((value) => !value.includes("\0"), "Недопустимый символ"),
  }),
);

export const chatTokenSchema = named(
  "ChatToken",
  "Всё, что нужно нативному клиенту Stream Chat, чтобы подключить человека: публичный ключ приложения, его профиль в чате и короткоживущий токен. Секрет приложения сюда никогда не попадает.",
  z.strictObject({
    apiKey: z.string().describe("Публичный ключ приложения Stream Chat."),
    user: z.strictObject({
      id: z
        .string()
        .describe(
          "Идентификатор человека в Stream Chat (не идентификатор ColaBike).",
        ),
      name: z.string(),
      image: z.string().nullable().describe("Полный адрес аватара или null."),
    }),
    token: z
      .string()
      .describe(
        "JWT человека в Stream Chat; живёт недолго, при истечении запросите новый.",
      ),
    expiresAt: instant.describe("Когда токен перестаёт действовать."),
    channelType: z
      .string()
      .describe(
        "Тип каналов ColaBike в Stream Chat: с ним клиент открывает и создаёт каналы.",
      ),
  }),
);

export const createChatChannelRequestSchema = named(
  "CreateChatChannelRequest",
  "Новый канал. Личный диалог (`dm`): ровно один собеседник, без названия; повторный запрос откроет тот же диалог. Группа (`group`): название до 80 знаков и от 2 до 7 других участников. Нельзя включить себя, повторы, заблокированных и тех, у кого не подтверждена почта.",
  z
    .strictObject({
      kind: z.enum(["dm", "group"]),
      name: z.string().trim().min(1).max(80).optional(),
      members: z
        .array(id)
        .min(1)
        .max(7)
        .describe("Другие участники (UUID людей ColaBike)."),
    })
    .superRefine((value, context) => {
      if (
        value.kind === "dm" &&
        (value.members.length !== 1 || value.name !== undefined)
      )
        context.addIssue({
          code: "custom",
          path: [value.members.length !== 1 ? "members" : "name"],
          message: "Для личного диалога нужен один собеседник и нет названия",
        });
      if (
        value.kind === "group" &&
        (value.name === undefined || value.members.length < 2)
      )
        context.addIssue({
          code: "custom",
          path: [value.name === undefined ? "name" : "members"],
          message: "Для группы нужны название и не меньше двух участников",
        });
    }),
);

export const chatChannelSchema = named(
  "ChatChannel",
  "Созданный или открытый канал: `cid` вида `тип:id`, по нему клиент Stream Chat открывает канал.",
  z.strictObject({ cid: z.string() }),
);

export const chatPeopleQuerySchema = z.strictObject({
  q: z.string().trim().max(80).default(""),
});
export const parseChatPeopleQuery = (url: URL) =>
  parseQuery(url, chatPeopleQuerySchema);

export const chatPeopleSchema = named(
  "ChatPeople",
  "Кому можно написать. Без запроса — те, на кого подписан человек; с запросом (от 2 знаков) — поиск по имени и логину. Только подтверждённые и не заблокированные; право написать проверяется ещё раз при создании канала.",
  z.strictObject({
    people: z.array(authorSchema),
    mode: z.enum(["following", "search"]),
  }),
);

export const chatUnreadSchema = named(
  "ChatUnread",
  "Число непрочитанных сообщений во всех каналах человека.",
  z.strictObject({ unread: z.int() }),
);

// Settings of the native apps (#338): content and switches of features the app
// already has. No layout, styles, code or secrets. Fields only ever get added;
// an app ignores what it does not know.
const appImage = z
  .string()
  .nullable()
  .describe(
    "Путь к растровому изображению (WebP) относительно адреса сайта или null. Файл публичный и не меняется: новая картинка получает новый адрес. Принимает `?width=` из набора 160, 320, 640, 1280, 1920, 2400.",
  );

export const appLaunchSchema = named(
  "AppLaunch",
  "Экран запуска, который приложение показывает после системного splash. Системный SplashScreen и иконка остаются в APK и отсюда не меняются.",
  z.strictObject({
    enabled: z
      .boolean()
      .describe("Показывать ли экран; `true` только вместе с `imageUrl`."),
    imageUrl: appImage,
    contentMode: z
      .enum(["fit", "crop"])
      .describe(
        "`fit` — вписать изображение целиком, `crop` — заполнить экран с обрезкой. Неизвестное значение трактуйте как `crop`.",
      ),
    title: z.string().nullable().describe("Короткая подпись или null."),
  }),
);

export const appOnboardingItemSchema = named(
  "AppOnboardingItem",
  "Карточка знакомства с приложением. Обычный текст без разметки.",
  z.strictObject({
    title: z.string(),
    body: z.string().nullable(),
    imageUrl: appImage,
  }),
);

export const appOnboardingSchema = named(
  "AppOnboarding",
  "Знакомство с приложением: карточки по порядку. Выключенное приходит с пустым `items`.",
  z.strictObject({
    enabled: z.boolean(),
    revision: z
      .int()
      .describe(
        "Редакция знакомства. Меняется, когда администратор публикует новую; сравнивайте на равенство с редакцией, которую человек уже прошёл на устройстве.",
      ),
    items: z.array(appOnboardingItemSchema),
  }),
);

export const appNoticeActionSchema = named(
  "AppNoticeAction",
  "Кнопка сообщения: текст и абсолютный адрес — страница ColaBike или https-адрес разрешённого администратором сайта.",
  z.strictObject({ label: z.string(), url: z.string() }),
);

export const appNoticeSchema = named(
  "AppNotice",
  "Сообщение приложения. `promo` — обычное, `service` — служебное, заметнее, `maintenance` — о технических работах, самое заметное; оно только сообщает и ничего не блокирует. Неизвестный тип показывайте как `promo`.",
  z.strictObject({
    revision: z
      .int()
      .describe(
        "Редакция сообщения: меняется вместе с его содержанием. Закрытое человеком сообщение запоминайте по ней.",
      ),
    kind: z.enum(["promo", "service", "maintenance"]),
    title: z.string(),
    body: z.string().nullable(),
    imageUrl: appImage,
    action: appNoticeActionSchema.nullable(),
  }),
);

export const appLinksSchema = named(
  "AppLinks",
  "Служебные ссылки, абсолютные адреса: страница ColaBike или https-адрес разрешённого сайта. Без настройки — страницы сайта по умолчанию; у поддержки умолчания нет.",
  z.strictObject({
    help: z.string(),
    privacy: z.string(),
    terms: z.string(),
    about: z.string(),
    support: z
      .string()
      .nullable()
      .describe("null — действие поддержки не показывается."),
  }),
);

export const appCompatibilitySchema = named(
  "AppCompatibility",
  "Совместимость версий по `versionCode` сборки. Ниже `minimumSupportedVersionCode` версия не поддерживается: при `updateMode: hard` приложение показывает экран обновления, при `soft` — настойчивое предложение без блокировки. Ниже `latestVersionCode` — ненавязчивое предложение обновиться. Не привязано к магазину приложений: адрес обновления даёт `updateUrl`.",
  z.strictObject({
    minimumSupportedVersionCode: z.int().nullable(),
    latestVersionCode: z.int().nullable(),
    updateMode: z
      .enum(["soft", "hard"])
      .describe(
        "`hard` бывает только вместе с `minimumSupportedVersionCode` и `updateUrl`. Неизвестное значение трактуйте как `soft`.",
      ),
    updateUrl: z.string().nullable().describe("Абсолютный адрес обновления."),
    updateMessage: z.string().nullable(),
  }),
);

export const appConfigSchema = named(
  "AppConfig",
  "Настройки нативного приложения из админки ColaBike: экран запуска, знакомство, сообщение, служебные ссылки, доступность функций и политика версий. Одинаковы для всех, без входа.",
  z.strictObject({
    revision: z
      .int()
      .describe("Версия настроек: растёт при каждом сохранении в админке."),
    updatedAt: instant,
    launch: appLaunchSchema,
    onboarding: appOnboardingSchema,
    notice: appNoticeSchema
      .nullable()
      .describe("Текущее сообщение или null, если его нет."),
    links: appLinksSchema,
    features: z
      .record(z.string(), z.boolean())
      .describe(
        "Доступность функций, которые уже есть в приложении: `chat`, `market`, `componentCatalog`, `rides`, `bikeEditor`, `journalEditor`, `nativeYandexSignIn`. Известные ключи приходят всегда. `false` скрывает функцию; `true` не создаёт того, чего в приложении нет, а неизвестные ключи пропускайте. `chat` и `nativeYandexSignIn` бывают `true`, только когда сервер для них настроен. Это не граница доступа: права проверяет API.",
      ),
    compatibility: appCompatibilitySchema,
  }),
);

export type AppConfig = z.infer<typeof appConfigSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type Me = z.infer<typeof meSchema>;
export type SessionGrant = z.infer<typeof sessionGrantSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UserPage = z.infer<typeof userPageSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type JournalSummary = z.infer<typeof journalSummarySchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Comment = z.infer<typeof commentSchema>;
export type ComponentHit = z.infer<typeof componentHitSchema>;
export type ComponentModel = z.infer<typeof componentModelSchema>;
export type ComponentPhoto = z.infer<typeof componentPhotoSchema>;
export type RideSummary = z.infer<typeof rideSummarySchema>;
export type OwnRideSummary = z.infer<typeof ownRideSummarySchema>;
export type MyUpcomingRide = z.infer<typeof myUpcomingRideSchema>;
export type FeedItem = z.infer<typeof feedItemSchema>;
export type Ride = z.infer<typeof rideSchema>;
export type RideAnalysis = z.infer<typeof rideAnalysisSchema>;
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

/** A query string checked against `schema`: a repeated or unknown parameter is an error. */
export function parseQuery<T extends z.ZodType>(
  url: URL,
  schema: T,
): z.infer<T> {
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
  const result = schema.safeParse(Object.fromEntries(entries));
  if (!result.success)
    throw new ApiError("invalid_request", "Проверьте параметры запроса.", {
      details: detailsOf(result.error),
    });
  return result.data;
}

/** For an operation without parameters: any parameter at all is a 400. */
export const parseNoQuery = (url: URL) => parseQuery(url, z.strictObject({}));

/** Validated query of GET /api/v1/bikes. */
export const parseListQuery = (url: URL): ListQuery =>
  parseQuery(url, listQuerySchema);

/** limit and cursor, the whole query of the lists of a person (bikes, followers, following). */
export const pageQuerySchema = z.strictObject({
  limit: listQuerySchema.shape.limit,
  cursor: listQuerySchema.shape.cursor,
});
export const parsePageQuery = (url: URL) => parseQuery(url, pageQuerySchema);

/** The feed: which publications, with a cursor. */
export const feedQuerySchema = z.strictObject({
  type: z.enum(["all", "rides", "journal"]).default("all"),
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
});
export const parseFeedQuery = (url: URL) => parseQuery(url, feedQuerySchema);

/** The inbox: only the unread, only one category, with a cursor. */
export const notificationsQuerySchema = z.strictObject({
  unread: z.enum(["", "1"]).default(""),
  category: z.enum(["", ...notificationCategoryKeys]).default(""),
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
});
export const parseNotificationsQuery = (url: URL) =>
  parseQuery(url, notificationsQuerySchema);

/** Comments add `focus`, a deep link to one comment; it replaces paging. */
export const commentsQuerySchema = z
  .strictObject({
    limit: pageQuerySchema.shape.limit,
    cursor: pageQuerySchema.shape.cursor,
    focus: z.uuid().optional(),
  })
  .refine((query) => !(query.focus && query.cursor), {
    message: "С focus курсор не нужен: ответ — одна ветка",
    path: ["cursor"],
  });
export const parseCommentsQuery = (url: URL) =>
  parseQuery(url, commentsQuerySchema);

/** A search text: trimmed, at most SEARCH_MAX characters, never a NUL byte. */
const searchText = z
  .string()
  .trim()
  .max(SEARCH_MAX)
  .refine((value) => !value.includes("\0"), "Недопустимый символ");

/** Lists of rides take a text as well: title, description, author and bike. */
export const ridesQuerySchema = z.strictObject({
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
  q: searchText.default(""),
});
export const parseRidesQuery = (url: URL) => parseQuery(url, ridesQuerySchema);

const facetText = searchText.default("");
/**
 * The experience search (#315): the text and facets of the site's search
 * (spelling rules of the catalog, brand, model, year, purpose, component,
 * classification), with a cursor instead of a page. Unknown and repeated
 * parameters are errors.
 */
export const experienceQuerySchema = z.strictObject({
  ...classificationQueryShape,
  category: z.enum(["", ...Object.keys(categoryFilterLabels)]).default(""),
  q: facetText,
  exact: z.enum(["", "1"]).default(""),
  brand: facetText,
  model: facetText,
  component: facetText,
  componentCategory: facetText,
  bikeModelId: z.union([z.literal(""), z.uuid()]).default(""),
  componentModelId: z.union([z.literal(""), z.uuid()]).default(""),
  year: z
    .union([
      z.literal(""),
      z
        .string()
        .regex(/^\d{4}$/, "Ожидается год")
        .transform(Number)
        .pipe(z.int().min(1900).max(2100)),
    ])
    .default(""),
  purpose: z
    .string()
    .regex(/^[a-z0-9_-]{0,30}$/)
    .default(""),
  kind: z
    .enum(["", "build", "service", "review", "question", "story"])
    .default(""),
  similar: z.union([z.literal(""), z.uuid()]).default(""),
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
});
export const parseExperienceQuery = (url: URL) =>
  parseQuery(url, experienceQuerySchema);

/** People search: a text is required (a search, not a directory). */
export const usersSearchQuerySchema = z.strictObject({
  q: searchText.min(1),
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
});
export const parseUsersSearchQuery = (url: URL) =>
  parseQuery(url, usersSearchQuerySchema);

/** Component suggestions: a text is required, the list is short. */
export const componentSearchQuerySchema = z.strictObject({
  q: searchText.min(1),
  limit: z
    .string()
    .regex(/^\d{1,2}$/, "Ожидается целое число")
    .transform(Number)
    .pipe(z.int().min(1).max(24))
    .default(12),
});
export const parseComponentSearchQuery = (url: URL) =>
  parseQuery(url, componentSearchQuerySchema);

/** The component catalog: the site's filters and an order, with a cursor. */
export const componentCatalogQuerySchema = z.strictObject({
  q: searchText.default(""),
  category: z.string().trim().max(60).default(""),
  brand: z.string().trim().max(100).default(""),
  sort: z.enum(["new", "popular"]).default("new"),
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
});
export const parseComponentCatalogQuery = (url: URL) =>
  parseQuery(url, componentCatalogQuerySchema);

/** A price bound: whole rubles, as on the site. */
const priceBound = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d{1,10}$/, "Ожидается целое число")
      .transform(Number)
      .pipe(z.int().min(0).max(9999999999)),
  ])
  .default("");
/** The market: the site's filters and orders, with a cursor instead of a page. */
export const marketQuerySchema = z.strictObject({
  q: searchText.default(""),
  category: z.enum(["", "bikes", "components", "accessories"]).default(""),
  type: z.enum(["", ...listingTypeKeys]).default(""),
  condition: z.enum(["", "new", "used"]).default(""),
  price_min: priceBound,
  price_max: priceBound,
  city: z.string().trim().max(100).default(""),
  seller: z
    .union([z.literal(""), z.string().regex(/^[A-Za-z0-9._-]{3,30}$/)])
    .default(""),
  sort: z.enum(["new", "price_asc", "price_desc"]).default("new"),
  limit: pageQuerySchema.shape.limit,
  cursor: pageQuerySchema.shape.cursor,
});
export const parseMarketQuery = (url: URL) =>
  parseQuery(url, marketQuerySchema);

/**
 * `{ref}` of /users: a UUID (36 characters) or a username (3 to 30), so the two
 * can never be confused. An old username from the rename history is not a ref;
 * the stable key is the id.
 */
export const userRefSchema = z.union([
  z.uuid().transform((value) => ({ id: value.toLowerCase() })),
  z
    .string()
    .regex(/^[A-Za-z0-9._-]{3,30}$/)
    .transform((value) => ({ username: value })),
]);
