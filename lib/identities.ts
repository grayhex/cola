import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "./db.ts";
import { errorCode, errorConstraint } from "./errors.ts";
import {
  checkLegalAcceptance,
  recordLegalAcceptance,
} from "./legal-documents.ts";
import { digest, verifyPassword } from "./password.ts";
import { allocateUsername } from "./username-allocation.ts";
import { suggestUsername } from "./usernames.ts";
import { emailInput } from "./validation.ts";
import { usernameInput } from "./social-validation.ts";

// External identities (#151): provider accounts as login methods of a user.
// An identity is found by (provider, subject) only. Email never links, merges
// or creates anything by itself: a matching address sends the person to the
// existing method, and linking needs the password and a fresh provider login.

export type IdentityProvider = "yandex";
export const identityProviders: readonly IdentityProvider[] = ["yandex"];

const defaultReturn = "/account";

/**
 * Where to go after sign-in: a path of this site only. Anything that could
 * leave the origin (other schemes, `//host`, backslashes) falls back.
 */
export function safeReturnPath(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 300) return defaultReturn;
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    [...raw].some((c) => c.charCodeAt(0) < 32)
  )
    return defaultReturn;
  let url;
  try {
    url = new URL(raw, "http://cola.invalid");
  } catch {
    return defaultReturn;
  }
  if (url.origin !== "http://cola.invalid" || url.pathname.startsWith("/api/"))
    return defaultReturn;
  return url.pathname + url.search;
}

// ── Redirect state ───────────────────────────────────────────────────────

interface FlowRow {
  purpose: "login" | "link";
  code_verifier: string;
  user_id: string | null;
  session_hash: string | null;
  return_path: string;
}

export async function saveFlow(
  q: Queryable,
  flow: {
    provider: IdentityProvider;
    purpose: "login" | "link";
    state: string;
    browser: string;
    verifier: string;
    returnPath: string;
    userId?: string;
    sessionHash?: string | null;
  },
) {
  await q.query("DELETE FROM external_auth_flows WHERE expires_at<now()");
  await q.query(
    `INSERT INTO external_auth_flows(state_hash,provider,purpose,browser_hash,code_verifier,user_id,session_hash,return_path)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      digest(flow.state),
      flow.provider,
      flow.purpose,
      digest(flow.browser),
      flow.verifier,
      flow.userId ?? null,
      flow.sessionHash ?? null,
      flow.returnPath,
    ],
  );
}

/**
 * Takes the flow exactly once: a replayed, expired, forged or foreign-browser
 * `state` finds nothing. A different browser does not burn the real one's flow.
 */
export async function consumeFlow(
  q: Queryable,
  provider: IdentityProvider,
  state: string,
  browser: string | undefined,
) {
  if (!browser) return null;
  return (
    (
      await q.query<FlowRow>(
        `DELETE FROM external_auth_flows
         WHERE state_hash=$1 AND provider=$2 AND browser_hash=$3 AND expires_at>now()
         RETURNING purpose,code_verifier,user_id,session_hash,return_path`,
        [digest(state), provider, digest(browser)],
      )
    ).rows[0] || null
  );
}

// ── Sign-in ──────────────────────────────────────────────────────────────

/** The user behind a provider account, or null; blocked users are reported. */
export async function findIdentityUser(
  q: Queryable,
  provider: IdentityProvider,
  subject: string,
) {
  const row = (
    await q.query<{ user_id: string; blocked: boolean }>(
      `SELECT i.user_id,u.blocked FROM user_identities i JOIN users u ON u.id=i.user_id
       WHERE i.provider=$1 AND i.subject=$2`,
      [provider, subject],
    )
  ).rows[0];
  if (row && !row.blocked)
    await q.query(
      "UPDATE user_identities SET last_login_at=now() WHERE provider=$1 AND subject=$2",
      [provider, subject],
    );
  return row ? { userId: row.user_id, blocked: row.blocked } : null;
}

export async function emailTaken(q: Queryable, email: string) {
  return !!(await q.query("SELECT 1 FROM users WHERE email=$1", [email]))
    .rowCount;
}

// ── First sign-in ────────────────────────────────────────────────────────

interface PendingRow {
  provider: IdentityProvider;
  subject: string;
  name: string;
  email: string | null;
  return_path: string;
}

/** Parks a verified provider account until username and consents are given. */
export async function savePendingSignup(
  q: Queryable,
  signup: {
    provider: IdentityProvider;
    subject: string;
    name: string;
    email: string | null;
    returnPath: string;
  },
) {
  const token = randomBytes(32).toString("base64url");
  await q.query("DELETE FROM external_signups WHERE expires_at<now()");
  await q.query(
    `INSERT INTO external_signups(token_hash,provider,subject,name,email,return_path)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      digest(token),
      signup.provider,
      signup.subject,
      signup.name,
      signup.email,
      signup.returnPath,
    ],
  );
  return token;
}

export async function readPendingSignup(
  q: Queryable,
  token: string | undefined,
) {
  if (!token) return null;
  return (
    (
      await q.query<PendingRow>(
        "SELECT provider,subject,name,email,return_path FROM external_signups WHERE token_hash=$1 AND expires_at>now()",
        [digest(token)],
      )
    ).rows[0] || null
  );
}

export const completionInput = z.object({
  name: z.string().trim().max(60).optional(),
  username: z.preprocess(
    (v) => (v === "" ? undefined : v),
    usernameInput.optional(),
  ),
  email: z.preprocess((v) => (v === "" ? undefined : v), emailInput.optional()),
});

export type CompletionResult =
  | {
      ok: true;
      userId: string;
      email: string;
      name: string;
      username: string;
      returnPath: string;
    }
  | { ok: false; status: number; code: string; error: string };

const failure = (status: number, code: string, error: string) =>
  ({ ok: false, status, code, error }) as const;

/**
 * Creates the account of a first provider sign-in. The pending row is taken
 * inside the same transaction as the account, so one completion wins and a
 * failed attempt (taken username, outdated documents) leaves it to retry.
 * `transaction` runs the callback with a client and rolls back on a throw.
 */
export async function completeSignup(
  transaction: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>,
  token: string,
  input: z.infer<typeof completionInput>,
  rawConsents: unknown,
): Promise<CompletionResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(async (q) => {
        const pending = (
          await q.query<PendingRow>(
            `DELETE FROM external_signups WHERE token_hash=$1 AND expires_at>now()
             RETURNING provider,subject,name,email,return_path`,
            [digest(token)],
          )
        ).rows[0];
        if (!pending)
          throw new Rollback(
            failure(
              410,
              "signup_expired",
              "Время входа истекло. Войдите через Яндекс заново.",
            ),
          );
        // The address the provider returned wins; otherwise the person gives
        // one, and it stays unverified until the usual link is opened.
        const email = pending.email ?? input.email;
        if (!email)
          throw new Rollback(
            failure(400, "email_required", "Укажите адрес электронной почты."),
          );
        const name = input.name || pending.name;
        if (!name)
          throw new Rollback(failure(400, "name_required", "Введите имя."));
        const accepted = await checkLegalAcceptance(q, rawConsents);
        const username =
          input.username ||
          (await allocateUsername(q, suggestUsername(name, email)));
        const userId = randomUUID();
        try {
          await q.query(
            "INSERT INTO users(id,email,name,username) VALUES($1,$2,$3,$4)",
            [userId, email, name, username],
          );
          await q.query(
            "INSERT INTO user_identities(user_id,provider,subject) VALUES($1,$2,$3)",
            [userId, pending.provider, pending.subject],
          );
        } catch (e) {
          if (errorCode(e) !== "23505") throw e;
          const constraint = errorConstraint(e);
          if (constraint === "users_email_key")
            throw new Rollback(
              failure(409, "email_exists", emailExistsMessage),
            );
          if (constraint === "user_identities_provider_subject_key")
            throw new Rollback(
              failure(
                409,
                "identity_exists",
                "Этот аккаунт Яндекса уже зарегистрирован. Войдите через Яндекс.",
              ),
            );
          if (constraint === "users_username_ci")
            throw new UsernameConflict(!input.username);
          throw e;
        }
        await recordLegalAcceptance(q, userId, accepted);
        return {
          ok: true as const,
          userId,
          email,
          name,
          username,
          returnPath: pending.return_path,
        };
      });
    } catch (e) {
      if (e instanceof Rollback) return e.result;
      // A derived username lost a race: allocate again; a chosen one is reported.
      if (e instanceof UsernameConflict) {
        if (e.derived && attempt < 3) continue;
        return failure(
          409,
          "username_taken",
          "Это имя пользователя уже занято. Выберите другое.",
        );
      }
      throw e;
    }
  }
}

// Thrown inside the transaction to undo it and report a refused completion.
class Rollback extends Error {
  declare result: Extract<CompletionResult, { ok: false }>;
  constructor(result: Extract<CompletionResult, { ok: false }>) {
    super(result.code);
    this.result = result;
  }
}

class UsernameConflict extends Error {
  declare derived: boolean;
  constructor(derived: boolean) {
    super("username_taken");
    this.derived = derived;
  }
}

export const emailExistsMessage =
  "Аккаунт с этим адресом уже есть. Войдите почтой и паролем и привяжите Яндекс в настройках аккаунта.";

// ── Account settings ─────────────────────────────────────────────────────

export async function listIdentities(q: Queryable, userId: string) {
  const user = (
    await q.query<{ has_password: boolean }>(
      "SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  const { rows } = await q.query<{
    provider: IdentityProvider;
    created_at: Date;
  }>(
    "SELECT provider,created_at FROM user_identities WHERE user_id=$1 ORDER BY created_at",
    [userId],
  );
  return {
    hasPassword: !!user?.has_password,
    identities: rows.map((r) => ({
      provider: r.provider,
      linkedAt: r.created_at,
    })),
  };
}

/** Is this the account's password? A password-less account never matches. */
export async function confirmPassword(
  q: Queryable,
  userId: string,
  password: string,
) {
  const user = (
    await q.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM users WHERE id=$1 AND NOT blocked",
      [userId],
    )
  ).rows[0];
  if (!user) return "wrong" as const;
  if (!user.password_hash) return "no_password" as const;
  return (await verifyPassword(password, user.password_hash))
    ? ("ok" as const)
    : ("wrong" as const);
}

export type LinkResult = "linked" | "taken" | "already_linked";

export async function linkIdentity(
  q: Queryable,
  userId: string,
  provider: IdentityProvider,
  subject: string,
): Promise<LinkResult> {
  try {
    await q.query(
      "INSERT INTO user_identities(user_id,provider,subject) VALUES($1,$2,$3)",
      [userId, provider, subject],
    );
    return "linked";
  } catch (e) {
    if (errorCode(e) !== "23505") throw e;
    return errorConstraint(e) === "user_identities_provider_subject_key"
      ? "taken"
      : "already_linked";
  }
}

export type UnlinkResult = "unlinked" | "not_linked" | "last_method";

/**
 * Removes a provider from the account. The user row is locked so two
 * simultaneous unlinks cannot both pass the "something else remains" check.
 * The password must be confirmed by the caller first.
 */
export async function unlinkIdentity(
  q: Queryable,
  userId: string,
  provider: IdentityProvider,
): Promise<UnlinkResult> {
  const user = (
    await q.query<{ has_password: boolean }>(
      "SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id=$1 FOR UPDATE",
      [userId],
    )
  ).rows[0];
  const { rows } = await q.query<{ provider: IdentityProvider }>(
    "SELECT provider FROM user_identities WHERE user_id=$1",
    [userId],
  );
  if (!rows.some((r) => r.provider === provider)) return "not_linked";
  // Methods left after the removal: the password and the other providers.
  if (!user?.has_password && rows.length < 2) return "last_method";
  await q.query(
    "DELETE FROM user_identities WHERE user_id=$1 AND provider=$2",
    [userId, provider],
  );
  return "unlinked";
}
