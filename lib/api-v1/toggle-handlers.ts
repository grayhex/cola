import { db, transaction } from "../db.ts";
import { CommunityError } from "../community-validation.ts";
import { setFollow } from "../follows.ts";
import { setSaved } from "../journal-discovery.ts";
import { limits } from "../limits.ts";
import { profileCounts } from "../profiles.ts";
import { vote } from "../showcase.ts";
import { ApiError } from "./errors.ts";
import { profileOf } from "./handlers.ts";
import { idOf } from "./journal-handlers.ts";
import { ok, safely } from "./respond.ts";
import { limited, writer } from "./write.ts";

// The first writing operations of /api/v1 (#305): switches that are idempotent
// by nature. `PUT` sets the state, `DELETE` clears it, a repeat changes
// nothing, and the answer is the state that results. The services are the
// legacy ones (`vote`, `setFollow`, `setSaved`), so permissions, blocking,
// locking and notifications are the same as on the site.

type IdParams = { params: Promise<{ id: string }> };

/** The legacy services answer `{ error, status }`; here it is an ApiError. */
function refused(error: string, status: number) {
  const code =
    status === 404
      ? "not_found"
      : status === 403
        ? "forbidden"
        : "invalid_request";
  return new ApiError(code, error);
}
/** The engines throw their own 404; the API answers it in its own envelope. */
async function found<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommunityError)
      throw refused(error.message, error.status);
    throw error;
  }
}
const enabledBy = (req: Request) => req.method === "PUT";

/** PUT/DELETE /api/v1/bikes/{id}/like */
export function handleBikeLike(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const bike = idOf((await params).id, "Велосипед не найден.");
    await limited("likes:" + viewer.id, 120);
    const result = await transaction((q) =>
      vote(q, bike, viewer.id, enabledBy(req)),
    );
    if (result.error !== undefined) throw refused(result.error, result.status);
    return ok({ liked: result.liked, likes: result.likes });
  });
}

/** PUT/DELETE /api/v1/users/{ref}/follow */
export function handleFollow(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  return safely(async () => {
    const viewer = await writer(req);
    const target = await profileOf((await params).ref, viewer.id);
    await limited("follow:" + viewer.id, limits.follows);
    const result = await transaction((q) =>
      setFollow(q, viewer.id, target.username, enabledBy(req)),
    );
    if (result.error !== undefined) throw refused(result.error, result.status);
    return ok({
      relationship: result.relationship,
      followers: Number((await profileCounts(db, target.id)).followers),
    });
  });
}

/** PUT/DELETE /api/v1/journal/{id}/save */
export function handleJournalSave(req: Request, { params }: IdParams) {
  return safely(async () => {
    const viewer = await writer(req);
    const entry = idOf((await params).id, "Запись не найдена.");
    // The legacy save route charges the budget of journal writes: one budget
    // for both transports.
    await limited("journal-write:" + viewer.id, 20);
    const result = await found(() =>
      transaction((q) => setSaved(q, entry, viewer.id, enabledBy(req))),
    );
    return ok({ saved: result.saved });
  });
}
