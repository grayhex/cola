import { fileURLToPath } from "node:url";
import { toNotification } from "../../lib/api-v1/mappers.ts";
import type {
  Notification,
  NotificationSettingsBody,
} from "../../lib/api-v1/schemas.ts";
import {
  ENVELOPE_MAX_BYTES,
  type PushEnvelope,
} from "../../lib/notification-envelope.ts";
import {
  encodeWatermark,
  notificationCard,
  type NotificationRow,
} from "../../lib/notifications.ts";

// The published fixtures of the notification contract (#341): one set of JSON
// for the site, the API and the apps. `targets.json` is made of the real
// pipeline (a stored row, the card of the site, the mapper of the API) from the
// rows below, so it says what the server says; a test compares it and, with
// UPDATE_NOTIFICATION_FIXTURES=1, rewrites it. The other files are written by
// hand and checked against the same schemas and against the service.

export const fixtureDirectory = fileURLToPath(
  new URL("../../docs/contracts/notifications/v1/", import.meta.url),
);

/** A UUID that reads: the same one in every file that mentions the same thing. */
export const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const ids = {
  viewer: uid(1),
  anna: uid(2),
  boris: uid(3),
  bike: uid(10),
  ride: uid(11),
  intent: uid(16),
  entry: uid(12),
  article: uid(13),
  component: uid(14),
  listing: uid(15),
  comment: uid(20),
  rideComment: uid(21),
  entryComment: uid(22),
  articleComment: uid(23),
  componentComment: uid(24),
  notice: (n: number) => uid(100 + n),
} as const;

const empty: NotificationRow = {
  id: "",
  type: "",
  created_at: new Date("2026-10-04T09:00:00.000Z"),
  read_at: null,
  comment_id: "",
  ride_comment_id: "",
  entry_comment_id: "",
  component_comment_id: "",
  component_id: "",
  component_name: "",
  category_slug: "",
  slug: "",
  listing_id: "",
  listing_share: "",
  listing_title: "",
  listing_status: "",
  listing_expires: new Date("2026-10-07T09:00:00.000Z"),
  listing_expired: false,
  listing_due: false,
  entry_id: "",
  entry_kind: "",
  entry_share: "",
  entry_title: "",
  ride_id: "",
  ride_share_id: "",
  ride_title: "",
  intent_id: "",
  bike_id: "",
  share_id: "",
  bike_name: "",
  actor_id: "",
  username: "",
  name: "",
  avatar_id: "",
  event_occurs_at: null,
  event_revision: null,
  reasons: null,
};
const anna = {
  actor_id: ids.anna,
  username: "anna",
  name: "Анна",
  avatar_id: "",
};
const boris = {
  actor_id: ids.boris,
  username: "boris",
  name: "Борис",
  avatar_id: "",
};
const bike = {
  bike_id: ids.bike,
  share_id: "bk-gravel",
  bike_name: "Gravel Nuroad",
};
const ride = {
  ride_id: ids.ride,
  ride_share_id: "rd-saturday",
  ride_title: "Субботний круг",
};
const entry = {
  entry_id: ids.entry,
  entry_kind: "build",
  entry_share: "en-chain",
  entry_title: "Замена цепи",
};
const article = {
  entry_id: ids.article,
  entry_kind: "article",
  entry_share: "ar-drivetrain",
  entry_title: "Гид по трансмиссии",
};
const component = {
  component_id: ids.component,
  component_name: "Кассета CS-HG700",
  category_slug: "drivetrain",
  slug: "cs-hg700",
};
const date = new Date("2026-10-10T07:00:00.000Z");

export interface TargetCase {
  name: string;
  description: string;
  row: Partial<NotificationRow>;
}
/** One notice of every kind the server makes, with the fields an app routes by. */
export const targetCases: TargetCase[] = [
  {
    name: "bike_comment",
    description:
      "Новый комментарий к вашему велосипеду. Экран: велосипед, прокрутка к `commentId`.",
    row: { type: "comment", ...anna, ...bike, comment_id: ids.comment },
  },
  {
    name: "bike_reply",
    description: "Ответ на ваш комментарий к велосипеду.",
    row: { type: "reply", ...boris, ...bike, comment_id: ids.comment },
  },
  {
    name: "ride_comment",
    description: "Комментарий к вашей покатушке: покатушка и `commentId`.",
    row: {
      type: "ride_comment",
      ...anna,
      ...ride,
      ride_comment_id: ids.rideComment,
    },
  },
  {
    name: "journal_comment",
    description: "Комментарий к записи журнала.",
    row: {
      type: "journal_comment",
      ...anna,
      ...entry,
      entry_comment_id: ids.entryComment,
    },
  },
  {
    name: "article_comment",
    description:
      "Статья — запись журнала со своим типом `article_comment` и целью `article`; категория та же, что у записей.",
    row: {
      type: "journal_comment",
      ...anna,
      ...article,
      entry_comment_id: ids.articleComment,
    },
  },
  {
    name: "component_reply",
    description: "Ответ в обсуждении модели компонента.",
    row: {
      type: "component_reply",
      ...boris,
      ...component,
      component_comment_id: ids.componentComment,
    },
  },
  {
    name: "ride_invite",
    description:
      "Приглашение на конкретную дату: `occurrenceAt` — эта дата, `agreementRevision` — версия договорённостей. Приглашение не означает участие: ответ человек даёт сам.",
    row: {
      type: "ride_invite",
      ...anna,
      ...ride,
      event_occurs_at: date,
      event_revision: 1,
    },
  },
  {
    name: "ride_invite_historical",
    description:
      "Приглашение, созданное до учёта дат: `occurrenceAt` и `agreementRevision` — null. Приложение открывает покатушку по `id` и `path`.",
    row: { type: "ride_invite", ...anna, ...ride },
  },
  {
    name: "ride_changed",
    description:
      "Организатор изменил время, место или маршрут: прежние ответы на эту дату сброшены, нужно подтвердить заново. `agreementRevision` — новая версия.",
    row: {
      type: "ride_changed",
      ...anna,
      ...ride,
      event_occurs_at: date,
      event_revision: 3,
    },
  },
  {
    name: "ride_cancelled",
    description:
      "Отменена дата или вся серия: `occurrenceAt` — отменённая дата.",
    row: {
      type: "ride_cancelled",
      ...anna,
      ...ride,
      event_occurs_at: date,
      event_revision: 3,
    },
  },
  {
    name: "ride_response",
    description:
      "Организатору: участники обновили ответы на дату. Автора у такого уведомления нет, сводка читается на странице покатушки.",
    row: {
      type: "ride_response",
      ...ride,
      event_occurs_at: date,
      event_revision: 3,
    },
  },
  {
    name: "ride_reminder",
    description:
      "Напоминание принявшему участие за сутки: приходит в срок, не раньше.",
    row: {
      type: "ride_reminder",
      ...ride,
      event_occurs_at: date,
      event_revision: 3,
    },
  },
  {
    name: "market_expiring",
    description:
      "Срок объявления подходит к концу; `state` читается при показе, потому что объявление могли продлить или закрыть.",
    row: {
      type: "market_expiring",
      listing_id: ids.listing,
      listing_share: "ml-frame",
      listing_title: "Рама Canyon",
      listing_status: "active",
      listing_due: true,
    },
  },
  {
    name: "follow",
    description:
      "На вас подписались. Только на сайте и в приложении, во внешние каналы не уходит.",
    row: { type: "follow", ...boris },
  },
  {
    name: "like",
    description: "Лайк велосипеда. Только на сайте и в приложении.",
    row: { type: "like", ...boris, ...bike },
  },
  {
    name: "session_reuse",
    description:
      "Служебное: токен сессии предъявлен повторно, сессия завершена. Автора нет, цель — безопасность аккаунта.",
    row: { type: "session_reuse" },
  },
  {
    name: "ride_reply",
    description: "Ответ на ваш комментарий к покатушке.",
    row: {
      type: "ride_reply",
      ...boris,
      ...ride,
      ride_comment_id: ids.rideComment,
    },
  },
  {
    name: "journal_reply",
    description: "Ответ на ваш комментарий к записи журнала.",
    row: {
      type: "journal_reply",
      ...boris,
      ...entry,
      entry_comment_id: ids.entryComment,
    },
  },
  {
    name: "ride_like",
    description: "Лайк покатушки. Только на сайте и в приложении.",
    row: { type: "ride_like", ...boris, ...ride },
  },
  {
    name: "journal_like",
    description: "Лайк записи журнала. Только на сайте и в приложении.",
    row: { type: "journal_like", ...boris, ...entry },
  },
  {
    name: "bike_week",
    description: "Велосипед недели. Служебное уведомление сайта.",
    row: { type: "bike_week", ...bike },
  },
  {
    name: "plan_published",
    description:
      "Друг (или тот, на кого вы подписаны, или выбранный вами человек — как вы настроили круг) запланировал публичную покатушку. Цель — покатушка; `occurrenceAt` — её дата, `agreementRevision` — версия договорённостей на момент публикации. Серия публикаций одного автора за четверть часа — одно непрочитанное уведомление, указывающее на последнюю. Это объявление, а не приглашение: участие человек подтверждает сам.",
    row: {
      type: "plan_published",
      ...boris,
      ...ride,
      event_occurs_at: date,
      event_revision: 1,
    },
  },
  {
    name: "intent_published",
    description:
      "Друг опубликовал намерение покататься (видимость «сообщество», с будущим окном). Цель — `intent` с идентификатором намерения; экрана намерения в приложении, возможно, ещё нет: тогда оно открывает список уведомлений.",
    row: { type: "intent_published", ...boris, intent_id: ids.intent },
  },
  {
    name: "plan_nearby",
    description:
      "Новая публичная покатушка в районе, который вы выбрали («поездки рядом» включены отдельным согласием). Цель — покатушка; `occurrenceAt` и `agreementRevision` — как у плана друга. `reasons` называет, почему пришло (`nearby`; `intent`, если дата попадает в окно вашего намерения); места и расстояния в уведомлении нет, а автор не узнаёт, кто его получил. Категория — `nearby`, её push включается отдельно.",
    row: {
      type: "plan_nearby",
      ...boris,
      ...ride,
      event_occurs_at: date,
      event_revision: 1,
      reasons: ["nearby"],
    },
  },
];

/** The notice as the API sends it, for a stored row of the case. */
export function noticeOf(testCase: TargetCase, index: number): Notification {
  return toNotification(
    notificationCard({
      ...empty,
      id: ids.notice(index + 1),
      // The examples are one inbox, newest first, a minute apart.
      created_at: new Date(
        Date.parse("2026-10-04T09:00:00.000Z") - index * 60000,
      ),
      ...testCase.row,
    }),
  );
}

/** The content of `targets.json`. */
export function targetsFile() {
  return {
    version: 1,
    note: "Каждый пример — элемент `items` ответа GET /api/v1/me/notifications, как его отдаёт сервер. Файл собирается из настоящих строк тестом tests/notification-fixtures.test.ts.",
    cases: targetCases.map((testCase, index) => ({
      name: testCase.name,
      description: testCase.description,
      notification: noticeOf(testCase, index),
    })),
  };
}

// ---- The push envelope ------------------------------------------------------
const created = "2026-10-04T09:00:00.000Z";
const envelope = (
  n: number,
  fields: Omit<
    PushEnvelope,
    "v" | "deliveryId" | "eventId" | "bindingGeneration" | "createdAt"
  >,
): PushEnvelope => ({
  v: 1,
  deliveryId: uid(200 + n),
  eventId: ids.notice(n),
  bindingGeneration: 4,
  createdAt: created,
  ...fields,
});
const target = (
  fields: Partial<PushEnvelope["target"]> & { type: string },
) => ({
  id: null,
  commentId: null,
  occurrenceAt: null,
  agreementRevision: null,
  ...fields,
});
export const validEnvelopes: {
  name: string;
  description: string;
  envelope: PushEnvelope;
}[] = [
  {
    name: "reply_to_my_comment",
    description:
      "Ответ на комментарий к публичному велосипеду: название публичное, текст комментария в сообщение не входит. Срок — неделя, как у письма.",
    envelope: envelope(2, {
      category: "discussions",
      type: "reply",
      expiresAt: "2026-10-11T09:00:00.000Z",
      neutral: false,
      title: "Ответ на ваш комментарий",
      body: "К велосипеду «Gravel Nuroad»",
      group: `bike:${ids.bike}`,
      target: target({ type: "bike", id: ids.bike, commentId: ids.comment }),
    }),
  },
  {
    name: "invitation_to_a_closed_plan",
    description:
      "Приглашение в закрытый план: текст нейтральный (`neutral: true`), ни названия, ни места, ни даты в сообщении нет. Что за выезд — приложение читает у сервера, когда доступ проверен.",
    envelope: envelope(7, {
      category: "rides",
      type: "ride_invite",
      expiresAt: "2026-10-10T06:55:00.000Z",
      neutral: true,
      title: "Приглашение на покатушку",
      body: "Откройте ColaBike, чтобы посмотреть детали",
      group: `ride:${ids.ride}`,
      target: target({
        type: "ride",
        id: ids.ride,
        occurrenceAt: "2026-10-10T07:00:00.000Z",
        agreementRevision: 1,
      }),
    }),
  },
  {
    name: "ride_changed_public",
    description:
      "Изменились договорённости публичной покатушки: нужно подтвердить заново. Версия `agreementRevision` — новая; уведомление о старой версии приложение не показывает, когда знает новую.",
    envelope: envelope(9, {
      category: "rides",
      type: "ride_changed",
      expiresAt: "2026-10-10T06:55:00.000Z",
      neutral: false,
      title: "Изменились договорённости покатушки",
      body: "«Субботний круг»: проверьте условия и подтвердите участие заново",
      group: `ride:${ids.ride}`,
      target: target({
        type: "ride",
        id: ids.ride,
        occurrenceAt: "2026-10-10T07:00:00.000Z",
        agreementRevision: 3,
      }),
    }),
  },
  {
    name: "ride_cancelled",
    description:
      "Отмена даты: срок — сама дата, после неё уведомление бесполезно. Показывается в той же стопке, что и изменения этой покатушки, и заменяет их.",
    envelope: envelope(10, {
      category: "rides",
      type: "ride_cancelled",
      expiresAt: "2026-10-10T07:00:00.000Z",
      neutral: false,
      title: "Покатушка отменена",
      body: "«Субботний круг»",
      group: `ride:${ids.ride}`,
      target: target({
        type: "ride",
        id: ids.ride,
        occurrenceAt: "2026-10-10T07:00:00.000Z",
        agreementRevision: 3,
      }),
    }),
  },
  {
    name: "chat_message",
    description:
      "Новое сообщение в разговоре (Stream): текста сообщения здесь нет, только кто написал и в каком разговоре. `eventId` — идентификатор сообщения, а не уведомления: у чата нет строки в ящике и нет серверной пометки «прочитано» (непрочитанное хранит Stream). Цель — разговор по `ref` (cid). Стопка — разговор: новое сообщение заменяет прежнее.",
    envelope: envelope(14, {
      category: "chat",
      type: "chat_message",
      expiresAt: "2026-10-04T21:00:00.000Z",
      neutral: false,
      title: "Новое сообщение",
      body: "От: Анна Райдер",
      group: "chat:colabike:dm_3f1c0a9e7d5b4c2a8e6f1d0b9a7c5e3f2b4d6a8c",
      target: target({
        type: "chat",
        ref: "colabike:dm_3f1c0a9e7d5b4c2a8e6f1d0b9a7c5e3f2b4d6a8c",
      }),
    }),
  },
  {
    name: "ride_reminder",
    description:
      "Напоминание принявшему участие: приходит не раньше срока и истекает за пять минут до выезда.",
    envelope: envelope(12, {
      category: "rides",
      type: "ride_reminder",
      expiresAt: "2026-10-10T06:55:00.000Z",
      neutral: false,
      title: "Напоминание о покатушке",
      body: "«Субботний круг»: до выезда меньше суток",
      group: `ride:${ids.ride}`,
      target: target({
        type: "ride",
        id: ids.ride,
        occurrenceAt: "2026-10-10T07:00:00.000Z",
        agreementRevision: 3,
      }),
    }),
  },
];
const sample = validEnvelopes[0].envelope;
/** What an app must show although the server's own schema would not send it. */
export const toleratedEnvelopes: {
  name: string;
  description: string;
  envelope: Record<string, unknown>;
}[] = [
  {
    name: "unknown_field",
    description:
      "Поля со временем только добавляются: лишнее поле той же версии приложение пропускает и показывает уведомление.",
    envelope: { ...sample, futureField: { any: "value" } },
  },
  {
    name: "unknown_category",
    description:
      "Неизвестную категорию приложение показывает в общем канале, а не отбрасывает.",
    envelope: { ...sample, category: "vouchers" },
  },
  {
    name: "unknown_target_type",
    description:
      "Цель, которой приложение не знает, открывает список уведомлений. Сервер не шлёт новый тип цели приложению без поддерживающего экрана; это страховка.",
    envelope: { ...sample, target: { ...sample.target, type: "voucher" } },
  },
];
/** What an app must not show. */
export const droppedEnvelopes: {
  name: string;
  reason: string;
  now?: string;
  clientBindingGeneration?: number;
  envelope: Record<string, unknown>;
}[] = [
  {
    name: "unsupported_version",
    reason: "Неизвестная версия формата: показывать нельзя, разбирать — тоже.",
    envelope: { ...sample, v: 2 },
  },
  {
    name: "expired",
    reason:
      "Срок вышел до показа: уведомление не выводится утром, когда оно уже ничего не значит.",
    now: "2026-10-12T09:00:00.000Z",
    envelope: sample,
  },
  {
    name: "other_binding",
    reason:
      "Поколение привязки не текущее (выход из аккаунта, смена аккаунта, переустановка): ни показа, ни следов в шторке.",
    clientBindingGeneration: 5,
    envelope: sample,
  },
  {
    name: "text_too_long",
    reason: "Текст длиннее предела схемы: сообщение не наше или повреждено.",
    envelope: { ...sample, body: "я".repeat(161) },
  },
  {
    name: "no_target",
    reason: "Без цели нечего открывать: сообщение не наше или повреждено.",
    envelope: Object.fromEntries(
      Object.entries(sample).filter(([key]) => key !== "target"),
    ),
  },
  {
    name: "not_a_uuid",
    reason: "Идентификатор доставки не UUID: дедуплицировать нечем.",
    envelope: { ...sample, deliveryId: "42" },
  },
];

export function payloadFile() {
  return {
    version: 1,
    note: "Данные, которые транспорт несёт на телефон одной строкой JSON в части data: готового уведомления в сообщении нет, показывает его одно приложение. Файл фиксирует формат; живая доставка зависит от настройки владельца (#342).",
    limits: { envelopeBytes: ENVELOPE_MAX_BYTES, transportBytes: 4096 },
    valid: validEnvelopes,
    tolerated: toleratedEnvelopes,
    dropped: droppedEnvelopes,
  };
}

// ---- Settings ----------------------------------------------------------------
const settingsAfterDefaults: NotificationSettingsBody = {
  channels: {
    email: { available: true, verified: true, enabled: false },
    push: { available: false, enabled: false },
  },
  categories: [
    {
      key: "rides",
      label: "Покатушки и приглашения",
      email: { supported: true, enabled: false },
      push: { supported: true, enabled: true },
    },
    {
      key: "discussions",
      label: "Комментарии и ответы",
      email: { supported: true, enabled: false },
      push: { supported: true, enabled: true },
    },
    {
      key: "market",
      label: "Окончание срока объявлений",
      email: { supported: true, enabled: false },
      push: { supported: false, enabled: false },
    },
    {
      key: "plans",
      label: "Новые планы друзей",
      email: { supported: false, enabled: false },
      push: { supported: true, enabled: true },
    },
    {
      key: "intents",
      label: "Намерения друзей",
      email: { supported: false, enabled: false },
      push: { supported: true, enabled: true },
    },
    {
      key: "chat",
      label: "Сообщения",
      email: { supported: false, enabled: false },
      push: { supported: true, enabled: true },
    },
    {
      key: "nearby",
      label: "Рядом",
      email: { supported: false, enabled: false },
      push: { supported: true, enabled: false },
    },
  ],
  reminders: true,
  timeZone: null,
  quietHours: {
    enabled: false,
    from: "22:00",
    to: "07:00",
    allowCancellations: false,
  },
  pausedUntil: null,
  circle: { mode: "friends", members: [] },
  considering: false,
  mutes: [],
  updatedAt: null,
};
const withEmail: NotificationSettingsBody = {
  ...settingsAfterDefaults,
  channels: {
    ...settingsAfterDefaults.channels,
    email: { available: true, verified: true, enabled: true },
  },
  categories: settingsAfterDefaults.categories.map((category) =>
    category.key === "rides"
      ? { ...category, email: { supported: true, enabled: true } }
      : category,
  ),
  updatedAt: "2026-10-04T09:30:00.123Z",
};
const error = (
  status: number,
  code: string,
  message: string,
  details?: { path: string; message: string }[],
) => ({
  status,
  body: { error: { code, message, ...(details ? { details } : {}) } },
});

export const defaultSettings = settingsAfterDefaults;
export function preferencesFile() {
  return {
    version: 1,
    note: "Настройки аккаунта одни для сайта и приложения. `updatedAt` и `ETag` в примерах условные. Разрешение системы на этом телефоне и регистрация телефона здесь не хранятся: сервер не может их включить.",
    cases: [
      {
        name: "defaults_push_not_connected",
        description:
          "Новый аккаунт: письма и push выключены, доставка push на сервере пока не подключена (`push.available: false`) — приложение не показывает переключатель недоступного канала. Категории — только те, которые сервер производит и канал может передать.",
        request: { method: "GET", path: "/me/notification-settings" },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-1"' },
          body: settingsAfterDefaults,
        },
      },
      {
        name: "enable_email_for_rides",
        description:
          "Включить письма и категорию «Покатушки». Меняется только указанное; повтор того же запроса ничего не меняет.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          headers: { "If-Match": '"example-etag-1"' },
          body: {
            channels: { email: { enabled: true } },
            categories: [{ key: "rides", email: true }],
          },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-2"' },
          body: withEmail,
        },
      },
      {
        name: "reminders_off",
        description:
          "Напоминание о покатушке — одно для всех каналов, письмо тут ни при чём: переключатель работает и без почты.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { reminders: false },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-3"' },
          body: { ...withEmail, reminders: false },
        },
      },
      {
        name: "quiet_hours",
        description:
          "Тихие часы читаются по часам человека, поэтому нужен часовой пояс (название IANA, не смещение). Пока окно открыто, письма и push ждут его конца; сообщение, срок которого выходит раньше, не отправляется утром вовсе. Окно, которое заканчивается раньше, чем начинается, переходит через полночь. Внутри приложения уведомления появляются всегда.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: {
            timeZone: "Europe/Moscow",
            quietHours: { enabled: true, from: "23:00", to: "07:30" },
          },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-4"' },
          body: {
            ...settingsAfterDefaults,
            timeZone: "Europe/Moscow",
            quietHours: {
              enabled: true,
              from: "23:00",
              to: "07:30",
              allowCancellations: false,
            },
            updatedAt: "2026-10-04T09:40:00.123Z",
          },
        },
      },
      {
        name: "quiet_hours_need_a_zone",
        description:
          "Без часового пояса окно не включить: сервер не знает, чьи это часы.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { quietHours: { enabled: true } },
        },
        response: error(
          400,
          "invalid_request",
          "Чтобы включить тихие часы, укажите часовой пояс",
        ),
      },
      {
        name: "close_cancellation_breaks_quiet",
        description:
          "Явный выбор человека: отмена подтверждённого выезда, до которого меньше 12 часов, не ждёт конца тихих часов. Пауза этим не обходится. По умолчанию выключено.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { quietHours: { allowCancellations: true } },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-5"' },
          body: {
            ...settingsAfterDefaults,
            quietHours: {
              enabled: false,
              from: "22:00",
              to: "07:00",
              allowCancellations: true,
            },
            updatedAt: "2026-10-04T09:41:00.123Z",
          },
        },
      },
      {
        name: "pause",
        description:
          "Пауза: до указанного времени внешние каналы молчат, сказанное за это время потом не досылается. `null` снимает паузу. Не дальше чем на год вперёд.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { pausedUntil: "2026-10-10T18:00:00.000Z" },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-6"' },
          body: {
            ...settingsAfterDefaults,
            pausedUntil: "2026-10-10T18:00:00.000Z",
            updatedAt: "2026-10-04T09:42:00.123Z",
          },
        },
      },
      {
        name: "pause_lifted",
        description:
          "Снять паузу можно двумя способами: `pausedUntil: null` или `resume: true`. Второй — для клиентов, чьи запросы никогда не несут null (сгенерированные клиенты опускают пустые поля). Вместе с непустым `pausedUntil` — 400.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { resume: true },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-6b"' },
          body: {
            ...settingsAfterDefaults,
            updatedAt: "2026-10-04T09:42:30.123Z",
          },
        },
      },
      {
        name: "circle_selected",
        description:
          "Кому доверено сообщать о своих новых планах и намерениях: `friends` (взаимные подписки, по умолчанию), `follows`, `selected` или `off`. Выбранных людей добавляют и убирают списками идентификаторов; повтор ничего не меняет. Подписка и выбор не расширяют доступ: если событие человеку недоступно, уведомления нет.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: {
            circle: { mode: "selected", add: [ids.boris] },
            considering: true,
          },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-7"' },
          body: {
            ...settingsAfterDefaults,
            circle: {
              mode: "selected",
              members: [
                {
                  id: ids.boris,
                  username: "boris",
                  name: "Борис",
                  avatarUrl: null,
                },
              ],
            },
            considering: true,
            updatedAt: "2026-10-04T09:43:00.123Z",
          },
        },
      },
      {
        name: "mute_author_and_ride",
        description:
          "Заглушить автора (всё, что он делает), покатушку (всё о ней) или обсуждение (комментарии под объектом): внешние каналы молчат, в ящике сайта и приложения остаётся. `label` — название, если человек вправе его знать, иначе null. Сервер не говорит, существует ли объект.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: {
            mutes: {
              add: [
                { kind: "author", id: ids.boris },
                { kind: "ride", id: ids.ride },
              ],
            },
          },
        },
        response: {
          status: 200,
          headers: { ETag: '"example-etag-8"' },
          body: {
            ...settingsAfterDefaults,
            mutes: [
              { kind: "author", id: ids.boris, label: "Борис" },
              { kind: "ride", id: ids.ride, label: "Вечерний круг" },
            ],
            updatedAt: "2026-10-04T09:44:00.123Z",
          },
        },
      },
      {
        name: "push_connected_after_consent",
        availableSince: "#342",
        description:
          "Состояние после подключения доставки (#342): сервер скажет `push.available: true`, согласие аккаунта — `push.enabled`. После согласия включены «Покатушки» и «Комментарии», остальное — отдельно. Сейчас сервер так не отвечает.",
        response: {
          status: 200,
          body: {
            ...settingsAfterDefaults,
            channels: {
              ...settingsAfterDefaults.channels,
              push: { available: true, enabled: true },
            },
            updatedAt: "2026-10-04T10:00:00.000Z",
          },
        },
      },
      {
        name: "push_not_connected",
        description:
          "Push нельзя включить, пока доставка не подключена: 503. Выключить можно всегда.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { channels: { push: { enabled: true } } },
        },
        response: error(
          503,
          "service_unavailable",
          "Push-уведомления пока не подключены",
        ),
      },
      {
        name: "email_not_verified",
        description: "Письма включаются на подтверждённый адрес.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { channels: { email: { enabled: true } } },
        },
        response: error(
          403,
          "email_verification_required",
          "Подтвердите почту, чтобы получать внешние уведомления",
        ),
      },
      {
        name: "stale_version",
        description:
          "Изменение с `If-Match` применяется только к версии, которую клиент видел; иначе 412, клиент читает настройки снова.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          headers: { "If-Match": '"example-etag-0"' },
          body: { reminders: false },
        },
        response: error(
          412,
          "precondition_failed",
          "Объект изменился после того, как вы его прочитали. Прочитайте его снова.",
        ),
      },
      {
        name: "channel_cannot_carry_category",
        description:
          "Категория называет только каналы, которые могут её передавать: push для объявлений не существует.",
        request: {
          method: "PATCH",
          path: "/me/notification-settings",
          body: { categories: [{ key: "market", push: true }] },
        },
        response: error(400, "invalid_request", "Проверьте поля запроса.", [
          {
            path: "categories.0.push",
            message: "Этот канал не передаёт такую категорию",
          },
        ]),
      },
    ],
  };
}

// ---- Read-state --------------------------------------------------------------
// The newest notice of the examples: the mark of the whole inbox.
const newest = {
  createdAt: "2026-10-04T09:00:00.000000Z",
  id: ids.notice(1),
};
export const watermarkExample = encodeWatermark(newest);
export const watermarkPosition = newest;
export function readFile() {
  const mark = watermarkExample;
  return {
    version: 1,
    note: "Прочитанным делает только приложение: когда человек открыл уведомление или нажал «прочитано». Загрузка списка, показ в шторке и смахивание ничего не помечают. `watermark` непрозрачен: его берут из ответа и отдают обратно как есть.",
    cases: [
      {
        name: "count_with_watermark",
        request: { method: "GET", path: "/me/notifications/count" },
        response: {
          status: 200,
          body: { unread: 3, capped: false, watermark: mark },
        },
      },
      {
        name: "unread_rides_page",
        description:
          "Список с фильтрами: `unread=1`, `category`, курсор. `watermark` — отметка всего ящика на момент ответа, а не страницы.",
        request: {
          method: "GET",
          path: "/me/notifications?unread=1&category=rides&limit=20",
        },
        response: {
          status: 200,
          note: "items — элементы из targets.json",
          watermark: mark,
        },
      },
      {
        name: "mark_one",
        description:
          "Открытие уведомления: пометить его. Повтор — тоже 200, `marked: 0`.",
        request: {
          method: "PUT",
          path: `/me/notifications/${ids.notice(3)}/read`,
        },
        response: {
          status: 200,
          body: { marked: 1, unread: 2, capped: false },
        },
      },
      {
        name: "mark_one_again",
        request: {
          method: "PUT",
          path: `/me/notifications/${ids.notice(3)}/read`,
        },
        response: {
          status: 200,
          body: { marked: 0, unread: 2, capped: false },
        },
      },
      {
        name: "mark_selection",
        description:
          "Выбранные на экране, до 100. Чужой идентификатор не ошибка, а просто не засчитывается.",
        request: {
          method: "POST",
          path: "/me/notifications/read",
          body: { ids: [ids.notice(1), ids.notice(2)] },
        },
        response: {
          status: 200,
          body: { marked: 2, unread: 0, capped: false },
        },
      },
      {
        name: "read_all",
        description:
          "«Прочитать все» до отметки списка, который человек видел. Уведомление, пришедшее позже, остаётся непрочитанным.",
        request: {
          method: "POST",
          path: "/me/notifications/read-all",
          body: { watermark: mark },
        },
        response: {
          status: 200,
          body: { marked: 3, unread: 1, capped: false },
        },
      },
      {
        name: "read_all_in_category",
        request: {
          method: "POST",
          path: "/me/notifications/read-all",
          body: { watermark: mark, category: "reactions" },
        },
        response: {
          status: 200,
          body: { marked: 1, unread: 2, capped: false },
        },
      },
      {
        name: "not_my_notification",
        description:
          "Чужое, ещё не доставленное и несуществующее уведомление неотличимы.",
        request: {
          method: "PUT",
          path: `/me/notifications/${uid(999)}/read`,
        },
        response: error(404, "not_found", "Уведомление не найдено."),
      },
      {
        name: "unknown_watermark",
        description: "Отметку, которой сервер не выдавал, он не принимает.",
        request: {
          method: "POST",
          path: "/me/notifications/read-all",
          body: { watermark: "made-up" },
        },
        response: error(400, "invalid_request", "Проверьте поля запроса.", [
          {
            path: "watermark",
            message:
              "Отметка не распознана: возьмите её из списка или счётчика уведомлений.",
          },
        ]),
      },
    ],
    scenarios: [
      {
        name: "a_notice_arrives_after_the_list",
        description:
          "Гонка, ради которой нужна отметка: уведомление пришло, пока человек смотрел список.",
        steps: [
          {
            do: "GET /me/notifications/count",
            expect: "unread 3, watermark W",
          },
          { do: "server: a new comment arrives", expect: "it is newer than W" },
          {
            do: "POST /me/notifications/read-all {watermark: W}",
            expect: "marked 3, unread 1",
          },
          {
            do: "GET /me/notifications?unread=1",
            expect: "only the comment that arrived later",
          },
        ],
      },
    ],
  };
}
