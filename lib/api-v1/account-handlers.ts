import {
  adminDeletionMessage,
  confirmedPassword,
  deletionMethod,
  removeAccount,
  removeAccountFiles,
} from "../account-data.ts";
import { db, transaction } from "../db.ts";
import { redeemNativeCode } from "../native-auth.ts";
import { ApiError } from "./errors.ts";
import { parseJsonBody } from "./request.ts";
import { ok, safely } from "./respond.ts";
import { deleteAccountRequestSchema, parseNoQuery } from "./schemas.ts";
import { signedIn } from "./personal-handlers.ts";
import { limited, writer } from "./write.ts";

// The person's own account through /api/v1 (#354): how deleting it is
// confirmed, and the deletion itself. The deletion is the site's
// (`removeAccount`): the rows go by cascade (sessions, push addresses, the
// area of "rides near me", notices, follows), the Stream user by its durable
// job, the files after the commit. What this layer adds is the confirmation a
// phone can give: the password, or, for an account made through a provider,
// a fresh sign-in with it.

const WORD = "УДАЛИТЬ";
const noMethod =
  "У аккаунта нет пароля и входа через Яндекс. Задайте пароль через «Забыли пароль?» на сайте и повторите.";

/** GET /api/v1/account/deletion */
export function handleAccountDeletion(req: Request) {
  return safely(async () => {
    const viewer = await signedIn(req);
    parseNoQuery(new URL(req.url));
    const terms = await deletionMethod(db, viewer.id);
    if (!terms) throw new ApiError("unauthorized", "Войдите в аккаунт.");
    const reason = terms.admin
      ? ("admin" as const)
      : terms.method === null
        ? ("no_method" as const)
        : null;
    return ok({
      method: terms.method,
      allowed: reason === null,
      reason,
    });
  });
}

/** POST /api/v1/account/delete */
export function handleDeleteAccount(req: Request) {
  return safely(async () => {
    const viewer = await writer(req);
    parseNoQuery(new URL(req.url));
    const body = await parseJsonBody(req, deleteAccountRequestSchema, 4096);
    if (body.confirm !== WORD)
      throw new ApiError("invalid_request", "Введите слово УДАЛИТЬ.", {
        details: [{ path: "confirm", message: "Введите слово УДАЛИТЬ." }],
      });
    if (body.password !== undefined && body.reauth !== undefined)
      throw new ApiError(
        "invalid_request",
        "Нужен один способ подтверждения: пароль или повторный вход.",
      );
    const terms = await deletionMethod(db, viewer.id);
    if (!terms) throw new ApiError("unauthorized", "Войдите в аккаунт.");
    if (terms.admin) throw new ApiError("conflict", adminDeletionMessage);
    if (terms.method === null) throw new ApiError("conflict", noMethod);
    if (terms.method === "password" && body.password === undefined)
      throw new ApiError("invalid_request", "Введите текущий пароль.", {
        details: [{ path: "password", message: "Введите текущий пароль." }],
      });
    if (terms.method === "yandex" && body.reauth === undefined)
      throw new ApiError(
        "invalid_request",
        "У аккаунта нет пароля: подтвердите вход через Яндекс.",
        {
          details: [
            { path: "reauth", message: "Нужен повторный вход через Яндекс." },
          ],
        },
      );
    // The budget of the site, spent where a password or a code is tried: a
    // slip in the word or in the way to confirm costs nothing.
    await limited("account-delete:" + viewer.id, 5);
    if (terms.method === "yandex" && body.reauth !== undefined) {
      // The code is spent by the attempt, so this is its own transaction: a
      // refusal below must not give it back for another guess of the verifier.
      const who = await redeemNativeCode(
        db,
        body.reauth.code,
        body.reauth.codeVerifier,
      );
      if (who !== viewer.id)
        throw new ApiError(
          "invalid_credentials",
          "Подтверждение входа не подошло. Войдите через Яндекс ещё раз.",
        );
    }
    const result = await transaction(async (q) => {
      if (
        terms.method === "password" &&
        !(await confirmedPassword(q, viewer.id, body.password as string))
      )
        return "password" as const;
      return removeAccount(q, viewer.id);
    });
    if (result === "password")
      throw new ApiError("invalid_credentials", "Пароль не подходит.");
    if (!result.files)
      throw new ApiError(
        result.status === 409 ? "conflict" : "unauthorized",
        result.error ?? "Аккаунт недоступен.",
      );
    // The rows are gone; the files leave the disk now, the others by their queues.
    await removeAccountFiles(result.files);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
