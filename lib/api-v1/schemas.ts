import { z } from "zod";
import { categoryFilterLabels } from "../bike-classification.ts";
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

export type Me = z.infer<typeof meSchema>;
export type SessionGrant = z.infer<typeof sessionGrantSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UserPage = z.infer<typeof userPageSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type JournalSummary = z.infer<typeof journalSummarySchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Comment = z.infer<typeof commentSchema>;
export type RideSummary = z.infer<typeof rideSummarySchema>;
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

/** Validated query of GET /api/v1/bikes. */
export const parseListQuery = (url: URL): ListQuery =>
  parseQuery(url, listQuerySchema);

/** limit and cursor, the whole query of the lists of a person (bikes, followers, following). */
export const pageQuerySchema = z.strictObject({
  limit: listQuerySchema.shape.limit,
  cursor: listQuerySchema.shape.cursor,
});
export const parsePageQuery = (url: URL) => parseQuery(url, pageQuerySchema);

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
