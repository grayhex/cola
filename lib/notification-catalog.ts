// The channel-neutral catalogue of notifications (#341): which events exist,
// which category each belongs to and which channels a category may use. The
// matrix in docs/modules/notifications.md says the rest (recipients, dedup key,
// term, target, visibility check); a test keeps both lists the same.
//
// A category is what a person switches: the same four words for the site, the
// API, the e-mail and, later, the push. An event is what the server records.

export type NotificationChannel = "email" | "push";

export interface NotificationCategory {
  /** What the settings screens call it. */
  label: string;
  /** A message of this category may be e-mailed (and so has a consent flag). */
  email: boolean;
  /** A message of this category may be pushed once the transport exists (#342). */
  push: boolean;
  /** The push flag a person starts with when they first consent to push. */
  pushDefault: boolean;
}

/**
 * The categories that exist today. `reactions` and `site` are shown in the
 * inbox only: no channel carries them, so there is nothing to switch.
 */
export const notificationCategories = {
  rides: {
    label: "Покатушки и приглашения",
    email: true,
    push: true,
    pushDefault: true,
  },
  discussions: {
    label: "Комментарии и ответы",
    email: true,
    push: true,
    pushDefault: true,
  },
  market: {
    label: "Окончание срока объявлений",
    email: true,
    push: false,
    pushDefault: false,
  },
  reactions: {
    label: "Подписки и лайки",
    email: false,
    push: false,
    pushDefault: false,
  },
  site: {
    label: "От ColaBike",
    email: false,
    push: false,
    pushDefault: false,
  },
} as const satisfies Record<string, NotificationCategory>;
export type NotificationCategoryKey = keyof typeof notificationCategories;
export const notificationCategoryKeys = Object.keys(
  notificationCategories,
) as NotificationCategoryKey[];

/**
 * Categories the owner's plan names but no code produces yet. They are listed
 * so that the matrix, the fixtures and the clients agree on the keys in
 * advance; they appear in the settings API only when the events exist.
 */
export const plannedNotificationCategories = {
  chat: { label: "Сообщения", issue: "#342" },
  plans: { label: "Новые планы друзей", issue: "#341 (события)" },
  intents: { label: "Намерения друзей", issue: "#341 (события)" },
  nearby: { label: "Рядом", issue: "#343" },
} as const;

export interface NotificationEvent {
  category: NotificationCategoryKey;
  /** The e-mail of an event of an e-mailable category: subject and one line. */
  email?: { subject: string; line: string };
}

/**
 * Every type the table `notifications` accepts. The text of an e-mail names
 * the kind of event and never quotes a comment, a place or a track.
 */
export const notificationEvents = {
  follow: { category: "reactions" },
  like: { category: "reactions" },
  comment: {
    category: "discussions",
    email: {
      subject: "Комментарий к велосипеду",
      line: "У вашего велосипеда появился новый комментарий.",
    },
  },
  reply: {
    category: "discussions",
    email: {
      subject: "Ответ на комментарий",
      line: "На ваш комментарий ответили.",
    },
  },
  ride_like: { category: "reactions" },
  ride_comment: {
    category: "discussions",
    email: {
      subject: "Комментарий к покатушке",
      line: "У вашей покатушки появился новый комментарий.",
    },
  },
  ride_reply: {
    category: "discussions",
    email: {
      subject: "Ответ в обсуждении покатушки",
      line: "На ваш комментарий к покатушке ответили.",
    },
  },
  journal_like: { category: "reactions" },
  journal_comment: {
    category: "discussions",
    email: {
      subject: "Комментарий к публикации",
      line: "У вашей публикации появился новый комментарий.",
    },
  },
  journal_reply: {
    category: "discussions",
    email: {
      subject: "Ответ в обсуждении публикации",
      line: "На ваш комментарий к публикации ответили.",
    },
  },
  component_reply: {
    category: "discussions",
    email: {
      subject: "Ответ в обсуждении компонента",
      line: "На ваш комментарий к компоненту ответили.",
    },
  },
  ride_invite: {
    category: "rides",
    email: {
      subject: "Приглашение на покатушку",
      line: "Вас пригласили на покатушку. Ответьте на странице поездки: приглашение само по себе не означает участие.",
    },
  },
  ride_changed: {
    category: "rides",
    email: {
      subject: "Изменились договорённости покатушки",
      line: "Организатор изменил время, место или маршрут. Проверьте актуальные условия и подтвердите участие заново.",
    },
  },
  ride_cancelled: {
    category: "rides",
    email: {
      subject: "Покатушка отменена",
      line: "Организатор отменил этот выезд. Актуальное состояние — на странице покатушки.",
    },
  },
  ride_response: {
    category: "rides",
    email: {
      subject: "Участники обновили ответы",
      line: "Ответы на вашу покатушку изменились. Актуальная сводка участников — на странице поездки.",
    },
  },
  ride_reminder: {
    category: "rides",
    email: {
      subject: "Напоминание о покатушке",
      line: "До подтверждённой вами покатушки осталось меньше суток. Проверьте актуальные договорённости перед выездом.",
    },
  },
  market_expiring: {
    category: "market",
    email: {
      subject: "Срок объявления на ColaBike",
      line: "Срок вашего объявления подходит к концу или уже истёк. Проверьте его актуальность.",
    },
  },
  session_reuse: { category: "site" },
  bike_week: { category: "site" },
} as const satisfies Record<string, NotificationEvent>;
export type NotificationType = keyof typeof notificationEvents;
export const notificationTypes = Object.keys(
  notificationEvents,
) as NotificationType[];

/** The category of a stored type; a type the catalogue does not know is the site's. */
export function notificationCategoryOf(type: string): NotificationCategoryKey {
  return Object.hasOwn(notificationEvents, type)
    ? notificationEvents[type as NotificationType].category
    : "site";
}
/** The stored types of a category: what a category filter selects. */
export function notificationTypesOf(category: NotificationCategoryKey) {
  return notificationTypes.filter(
    (type) => notificationEvents[type].category === category,
  );
}

// ---- E-mail ---------------------------------------------------------------
// The e-mail outbox (#148) keeps its own three categories and its own SQL. It
// reads them from the catalogue above, so a new event is added in one place.

export const notificationEmailCategories = [
  "discussions",
  "rides",
  "market",
] as const;
export type NotificationEmailCategory =
  (typeof notificationEmailCategories)[number];
export const notificationEmailEvents: Record<
  string,
  { category: NotificationEmailCategory; subject: string; line: string }
> = Object.fromEntries(
  notificationTypes.flatMap((type) => {
    const event: NotificationEvent = notificationEvents[type];
    return event.email &&
      (notificationEmailCategories as readonly string[]).includes(
        event.category,
      )
      ? [
          [
            type,
            {
              category: event.category as NotificationEmailCategory,
              ...event.email,
            },
          ],
        ]
      : [];
  }),
);

// A newly inserted event and its delivery are one database statement, even when
// the caller uses an autocommit pool. No SMTP means no new external backlog.
export function notificationEmailCategorySql(typeColumn = "type") {
  const categories = notificationEmailCategories
    .map(
      (category) =>
        `WHEN ${typeColumn} IN (${Object.entries(notificationEmailEvents)
          .filter(([, event]) => event.category === category)
          .map(([type]) => `'${type}'`)
          .join(",")}) THEN '${category}'`,
    )
    .join(" ");
  return `CASE ${categories} ELSE NULL END`;
}
export function notificationEmailEnqueueSql(
  enabledParameter: string,
  { available, expires }: { available?: string; expires?: string } = {},
) {
  const timing =
    available || expires
      ? `,${available || "now()"},${expires || "now()+interval '7 days'"}`
      : "";
  return `SELECT cola_queue_notification_email(id,recipient_id,${notificationEmailCategorySql()}${timing}) FROM created WHERE ${enabledParameter}`;
}
