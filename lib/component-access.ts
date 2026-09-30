import type { CurrentUser as CurrentUserType } from "./contracts.ts";
import type { Queryable } from "./db.ts";
import { resolveComponentModel } from "./component-catalog.ts";
import { CommunityError } from "./community-validation.ts";
import { requireVerifiedEmail } from "./email-policy.ts";
import type { CurrentUser } from "./contracts.ts";

// Lock order matches uploads, account changes and catalog merge: users -> catalog.
export async function componentActor(
  q: Queryable,
  user: Pick<CurrentUserType, "id">,
  publish = false,
) {
  const actor = (
    await q.query<Pick<CurrentUser, "id" | "role" | "email_verified_at">>(
      "SELECT id,role,email_verified_at FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [user.id],
    )
  ).rows[0];
  if (!actor) throw new CommunityError("Пользователь недоступен", 403);
  if (publish) requireVerifiedEmail(actor);
  return actor;
}
export async function publicComponent(q: Queryable, id: string) {
  const model = await resolveComponentModel(q, id);
  if (!model) throw new CommunityError("Модель недоступна", 404);
  return model;
}
export async function lockComponent(q: Queryable, id: string) {
  await q.query<{ pg_advisory_xact_lock: unknown }>(
    "SELECT pg_advisory_xact_lock(145,0)",
  );
  return publicComponent(q, id);
}
export async function componentPhotoEligibility(
  q: Queryable,
  model: { id: string },
  user: Pick<CurrentUser, "id" | "role"> | null,
) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return !!(
    await q.query<{ "?column?": number }>(
      `SELECT 1 FROM components c JOIN component_models s ON s.id=c.model_id
     JOIN bikes b ON b.id=c.bike_id WHERE b.owner_id=$2
     AND coalesce(s.merged_into,s.id)=$1 LIMIT 1`,
      [model.id, user.id],
    )
  ).rowCount;
}

// Search has its own capability: no installation is required, but the entire
// canonical gallery (including hidden photos / merged models) must be empty.
export async function componentPhotoSearchEligibility(
  q: Queryable,
  model: { id: string },
  user: Pick<CurrentUser, "id" | "role"> | null,
) {
  if (!user) return false;
  const actor = (
    await q.query<{ role: string }>(
      "SELECT role FROM users WHERE id=$1 AND NOT blocked",
      [user.id],
    )
  ).rows[0];
  if (!actor) return false;
  if (actor.role === "admin") return true;
  return !(
    await q.query<{ "?column?": number }>(
      `SELECT 1 FROM component_photos p JOIN component_models s ON s.id=p.model_id
    WHERE coalesce(s.merged_into,s.id)=$1 LIMIT 1`,
      [model.id],
    )
  ).rowCount;
}
export async function authorizeComponentPhotoSearch(
  q: Queryable,
  id: string,
  user: Pick<CurrentUser, "id" | "role" | "email_verified_at">,
) {
  const model = await publicComponent(q, id);
  if (!(await componentPhotoSearchEligibility(q, model, user)))
    throw new CommunityError(
      "Поиск фото доступен при пустой галерее; дополнять её через поиск может администратор",
      403,
    );
  return model;
}
