// What the person sees after a provider round trip (#151): the callback
// redirects with `?identity=<code>`, the page maps it to one of these. Codes
// are fixed words, so the query string can never inject text.
const messages = {
  cancelled: "Вход через Яндекс отменён.",
  disabled: "Вход через Яндекс сейчас недоступен.",
  state:
    "Ссылка входа устарела или была открыта в другом браузере. Начните заново.",
  invalid: "Яндекс вернул некорректный ответ. Попробуйте ещё раз.",
  provider_error: "Не удалось получить данные из Яндекса. Попробуйте позже.",
  blocked: "Аккаунт заблокирован.",
  registration_closed:
    "Регистрация временно закрыта. Войти могут только уже связанные аккаунты.",
  email_exists:
    "Аккаунт с этим адресом уже есть. Войдите почтой и паролем и привяжите Яндекс в настройках аккаунта.",
  session: "Сессия изменилась. Войдите и повторите привязку.",
  linked: "Яндекс привязан к аккаунту.",
  taken: "Этот аккаунт Яндекса уже привязан к другому профилю.",
  already_linked: "К аккаунту уже привязан другой аккаунт Яндекса.",
  rate_limited: "Слишком много попыток. Попробуйте через 15 минут.",
} as const;

export type IdentityNotice = keyof typeof messages;

export function identityNotice(code: string | null | undefined) {
  return code && Object.hasOwn(messages, code)
    ? messages[code as IdentityNotice]
    : null;
}

/** Only these are successes; every other code is shown as an error. */
export const identitySuccess = (code: string | null | undefined) =>
  code === "linked";
