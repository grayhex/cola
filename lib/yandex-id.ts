import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { emailInput } from "./validation.ts";

// Yandex ID sign-in (#151): the OAuth 2.0 authorization code flow with PKCE
// (S256) as documented at https://yandex.ru/dev/id/doc/ru/codes/code-url and
// https://yandex.ru/dev/id/doc/ru/user-information. The access token is used
// once to read the account and is never stored. Only the stable account `id`
// identifies a person; `login` and the email can change and are not keys.

export class YandexIdError extends Error {
  declare status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface YandexIdConfig {
  clientId: string;
  secret: string;
  redirectUri: string;
}

/** The profile this app reads; nothing else of the Yandex account is kept. */
export interface YandexProfile {
  subject: string;
  name: string;
  /** Unverified: the documentation does not guarantee a confirmed address. */
  email: string | null;
}

const authorizeUrl = "https://oauth.yandex.ru/authorize";
const tokenUrl = "https://oauth.yandex.ru/token";
const infoUrl = "https://login.yandex.ru/info?format=json";
// login:info gives the account id, login and name; the address is optional,
// so a person may decline it and still sign in.
const scope = "login:info";
const optionalScope = "login:email";

/**
 * The provider is on only when explicitly enabled with both credentials;
 * otherwise sign-in with it is absent and the rest of the site is unaffected.
 */
export function yandexIdConfig(env = process.env): YandexIdConfig | null {
  if (
    env.YANDEX_ID_ENABLED !== "true" ||
    !env.YANDEX_ID_CLIENT_ID ||
    !env.YANDEX_ID_CLIENT_SECRET
  )
    return null;
  const base = env.APP_ORIGIN || "http://localhost:3000";
  const origin = new URL(base);
  if (
    origin.origin !== base ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(origin.hostname))
  )
    return null;
  return {
    clientId: env.YANDEX_ID_CLIENT_ID,
    secret: env.YANDEX_ID_CLIENT_SECRET,
    redirectUri: origin.origin + "/api/auth/yandex/callback",
  };
}

/** A partly filled configuration is a deployment mistake, not "disabled". */
export function yandexIdConfigProblem(env = process.env) {
  if (env.YANDEX_ID_ENABLED !== "true") return null;
  return env.YANDEX_ID_CLIENT_ID && env.YANDEX_ID_CLIENT_SECRET
    ? null
    : "YANDEX_ID_CLIENT_ID and YANDEX_ID_CLIENT_SECRET are required when YANDEX_ID_ENABLED=true";
}

const random = () => randomBytes(32).toString("base64url");

/** A fresh `state`/verifier pair: 256 random bits each, URL safe. */
export function newFlowSecrets() {
  const verifier = random();
  return {
    state: random(),
    browser: random(),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function yandexAuthorizeUrl(
  config: YandexIdConfig,
  state: string,
  challenge: string,
) {
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope,
    optional_scope: optionalScope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** What Yandex puts on the return URL: a code, or an error such as a refusal. */
export const yandexReturn = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,512}$/)
    .optional(),
  error: z.string().max(100).optional(),
});

async function readLimited(response: Response, limit = 65536) {
  const reader = response.body?.getReader();
  if (!reader) throw new YandexIdError("Пустой ответ Яндекс ID");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new YandexIdError("Ответ Яндекс ID превышает лимит");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function request(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  let response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new YandexIdError("Яндекс ID временно недоступен");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new YandexIdError(
      "Яндекс ID отклонил запрос (" + response.status + ")",
      response.status === 400 || response.status === 401 ? 400 : 502,
    );
  }
  try {
    return JSON.parse(await readLimited(response));
  } catch (e) {
    if (e instanceof YandexIdError) throw e;
    throw new YandexIdError("Некорректный ответ Яндекс ID");
  }
}

const tokenResponse = z.object({
  token_type: z.string().regex(/^bearer$/i),
  access_token: z.string().min(1).max(4096),
});

/** Exchanges the code; PKCE binds it to the verifier made for this flow. */
export async function exchangeYandexCode(
  config: YandexIdConfig,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
) {
  const basic = Buffer.from(config.clientId + ":" + config.secret).toString(
    "base64",
  );
  const parsed = tokenResponse.safeParse(
    await request(
      tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Basic " + basic,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
        }).toString(),
      },
      fetcher,
    ),
  );
  if (!parsed.success) throw new YandexIdError("Некорректный ответ Яндекс ID");
  return parsed.data.access_token;
}

const infoResponse = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  client_id: z.string(),
  login: z.string().max(200).optional(),
  display_name: z.string().max(200).nullish(),
  real_name: z.string().max(200).nullish(),
  default_email: z.string().max(320).nullish(),
});

/** The documented `Authorization: OAuth <token>` header, never the query. */
export async function fetchYandexProfile(
  config: YandexIdConfig,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YandexProfile> {
  const parsed = infoResponse.safeParse(
    await request(
      infoUrl,
      {
        headers: {
          Accept: "application/json",
          Authorization: "OAuth " + token,
        },
      },
      fetcher,
    ),
  );
  // A token issued to another application must not sign anyone in.
  if (
    !parsed.success ||
    parsed.data.client_id !== config.clientId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.data.id)
  )
    throw new YandexIdError("Некорректный ответ Яндекс ID");
  const name = (
    parsed.data.display_name ||
    parsed.data.real_name ||
    parsed.data.login ||
    ""
  )
    .trim()
    .slice(0, 60);
  const email = emailInput.safeParse(parsed.data.default_email?.trim() ?? "");
  return {
    subject: parsed.data.id,
    name,
    email: email.success ? email.data : null,
  };
}
