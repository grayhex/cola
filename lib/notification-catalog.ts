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
> = {
  comment: {
    category: "discussions",
    subject: "Комментарий к велосипеду",
    line: "У вашего велосипеда появился новый комментарий.",
  },
  reply: {
    category: "discussions",
    subject: "Ответ на комментарий",
    line: "На ваш комментарий ответили.",
  },
  ride_comment: {
    category: "discussions",
    subject: "Комментарий к покатушке",
    line: "У вашей покатушки появился новый комментарий.",
  },
  ride_reply: {
    category: "discussions",
    subject: "Ответ в обсуждении покатушки",
    line: "На ваш комментарий к покатушке ответили.",
  },
  journal_comment: {
    category: "discussions",
    subject: "Комментарий к публикации",
    line: "У вашей публикации появился новый комментарий.",
  },
  journal_reply: {
    category: "discussions",
    subject: "Ответ в обсуждении публикации",
    line: "На ваш комментарий к публикации ответили.",
  },
  component_reply: {
    category: "discussions",
    subject: "Ответ в обсуждении компонента",
    line: "На ваш комментарий к компоненту ответили.",
  },
  ride_invite: {
    category: "rides",
    subject: "Приглашение на покатушку",
    line: "Вас пригласили на покатушку. Ответьте на странице поездки: приглашение само по себе не означает участие.",
  },
  market_expiring: {
    category: "market",
    subject: "Срок объявления на ColaBike",
    line: "Срок вашего объявления подходит к концу или уже истёк. Проверьте его актуальность.",
  },
};

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
export function notificationEmailEnqueueSql(enabledParameter: string) {
  return `SELECT cola_queue_notification_email(id,recipient_id,${notificationEmailCategorySql()}) FROM created WHERE ${enabledParameter}`;
}
