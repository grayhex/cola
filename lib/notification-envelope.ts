import { z } from "zod";
import { notificationCategoryKeys } from "./notification-catalog.ts";

// The envelope of an external notification (#341): what a transport carries to
// a phone and what the app checks before it shows anything. It is the
// contract only: the sender and the device registry are #342, and nothing in
// this repository sends one yet. A transport carries it as one string (the
// JSON below) in the data part of its message, never as a ready-made
// notification, so the app builds the one notification there is.
//
// What is in it is bounded on purpose. There are identifiers, a category, the
// typed target and a short text, and nothing that opens anything: no token, no
// address, no place, no track, no text of a comment or of a private message.
// The text of an event about something private is neutral (`neutral: true`):
// the app asks the server for the content once access has been checked.

/** The bytes the envelope may take. A transport's own limit is 4096 for the whole message. */
export const ENVELOPE_MAX_BYTES = 3072;

const instant = z.iso.datetime();
/** Every key an app may meet; one it does not know goes to its general channel. */
const categories = [...notificationCategoryKeys] as [string, ...string[]];

/**
 * Where a tap leads, in ids: the app asks the server for the name, the state
 * and the right to see it. The same fields as the typed target of the API,
 * without names and addresses (a name is read when it is shown, not stored in
 * a message that cannot be taken back).
 */
export const pushTargetSchema = z.strictObject({
  type: z
    .string()
    .max(20)
    .describe(
      "bike, ride, journal, article, component, profile, market, account, bike-week; набор открыт.",
    ),
  id: z.uuid().nullable(),
  commentId: z.uuid().nullable(),
  occurrenceAt: instant.nullable(),
  agreementRevision: z.int().min(1).nullable(),
  ref: z
    .string()
    .min(1)
    .max(120)
    .nullable()
    .optional()
    .describe(
      "Идентификатор цели, который не UUID: у разговора это его cid в Stream (`colabike:dm_…`). Остальные цели его не несут.",
    ),
});

export const pushEnvelopeSchema = z.strictObject({
  v: z
    .literal(1)
    .describe("Версия формата. Неизвестную приложение не показывает."),
  deliveryId: z
    .uuid()
    .describe(
      "Одна доставка: приложение не показывает повтор с тем же идентификатором второй раз.",
    ),
  eventId: z
    .uuid()
    .describe(
      "Уведомление на сервере: ключ пометки «прочитано» и его строка в списке.",
    ),
  bindingGeneration: z
    .int()
    .min(1)
    .describe(
      "Поколение привязки телефона к аккаунту (реестр устройств, #342). Не секрет; отличается от текущего — не показывать.",
    ),
  category: z.enum(categories),
  type: z.string().max(40),
  createdAt: instant,
  expiresAt: instant.describe(
    "После этого момента уведомление бесполезно (прошедшая дата, закрытый набор); приложение его не показывает.",
  ),
  neutral: z
    .boolean()
    .describe(
      "true — текст общий, подробности приложение читает после проверки доступа: событие касается закрытого.",
    ),
  title: z.string().min(1).max(80),
  body: z.string().max(160).nullable(),
  group: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "Стабильный ключ стопки: новое по тому же объекту заменяет прежнее, а разные поездки не склеиваются.",
    ),
  target: pushTargetSchema,
});
export type PushEnvelope = z.infer<typeof pushEnvelopeSchema>;

/** The bytes of the JSON a transport carries. */
export const envelopeBytes = (envelope: PushEnvelope) =>
  Buffer.byteLength(JSON.stringify(envelope), "utf8");
