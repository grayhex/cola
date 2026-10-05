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
 * inbox only: no channel carries them, so there is nothing to switch. `plans`
 * and `intents` are discovery: who they come from is the circle of the
 * settings, and how many leave the site is a limit, not a switch. `nearby` is
 * discovery too, but from the area the person chose, and it is a switch.
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
  plans: {
    label: "Новые планы друзей",
    email: false,
    push: true,
    pushDefault: true,
  },
  intents: {
    label: "Намерения друзей",
    email: false,
    push: true,
    pushDefault: true,
  },
  chat: {
    label: "Сообщения",
    email: false,
    push: true,
    pushDefault: true,
  },
  // Rides in the area the person chose (#343). Off until chosen: the person has
  // already consented to the area itself and to push, and this is the third word.
  nearby: {
    label: "Рядом",
    email: false,
    push: true,
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
 * The categories whose events are rows of the bell, so the ones the inbox can
 * be filtered by. A chat message is pushed and never recorded there (Stream
 * keeps what is unread), so a filter by it is an error, not an empty list.
 */
export const notificationInboxCategoryKeys = notificationCategoryKeys.filter(
  (key) => key !== "chat",
);

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
  plan_published: { category: "plans" },
  intent_published: { category: "intents" },
  plan_nearby: { category: "nearby" },
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

/**
 * The e-mails about a person's own agreements (an invitation, a change, a
 * cancellation, a reminder, an answer to the organiser). They are not held to
 * the interval between two e-mails that keeps comments from becoming a stream:
 * "the ride moved" does not wait twenty minutes behind someone's reply.
 */
export const notificationEmailPersonalTypes = Object.entries(
  notificationEmailEvents,
)
  .filter(([, event]) => event.category === "rides")
  .map(([type]) => type);
export const notificationEmailPersonalSql = (typeColumn = "type") =>
  `${typeColumn} IN (${notificationEmailPersonalTypes.map((type) => `'${type}'`).join(",")})`;

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

// ---- Push -----------------------------------------------------------------
// The push queue (#342) reads the same catalogue: which events a phone can be
// told about, how long a message is worth sending, and which of them are
// personal (an invitation, an answer, a change of a ride) and which are
// discovery (a friend's new plan or intent). Discovery never goes ahead of the
// personal ones.

/** The events of the categories that push may carry. */
export const notificationPushTypes = notificationTypes.filter(
  (type) => notificationCategories[notificationEvents[type].category].push,
);
/** Categories that are about what others plan, not about the person's own affairs. */
export const notificationPushDiscoveryCategories: readonly NotificationCategoryKey[] =
  ["plans", "intents", "nearby"];
export const notificationPushDiscoveryTypes = notificationPushTypes.filter(
  (type) =>
    notificationPushDiscoveryCategories.includes(
      notificationEvents[type].category,
    ),
);
/**
 * How long a message is worth sending after the event. The ride's own date
 * shortens it further (nothing is sent for a ride that has begun).
 */
export const notificationPushTtlHours: Record<NotificationCategoryKey, number> =
  {
    rides: 168,
    discussions: 24,
    market: 0,
    plans: 24,
    intents: 12,
    chat: 12,
    nearby: 24,
    reactions: 0,
    site: 0,
  };
export function notificationPushTtlSql(typeColumn = "type") {
  const hours = [...new Set(Object.values(notificationPushTtlHours))].filter(
    Boolean,
  );
  const arms = hours.map(
    (value) =>
      `WHEN ${typeColumn} IN (${notificationPushTypes
        .filter(
          (type) =>
            notificationPushTtlHours[notificationEvents[type].category] ===
            value,
        )
        .map((type) => `'${type}'`)
        .join(",")}) THEN ${value}`,
  );
  return `CASE ${arms.join(" ")} ELSE 0 END`;
}
