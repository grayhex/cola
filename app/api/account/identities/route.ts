import { currentUser } from "../../../../lib/auth.ts";
import { db } from "../../../../lib/db.ts";
import { fail, json } from "../../../../lib/http.ts";
import { listIdentities } from "../../../../lib/identities.ts";
import { traced } from "../../../../lib/observability.ts";
import { yandexIdConfig } from "../../../../lib/yandex-id.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The sign-in methods of the signed-in account (#151): the password and the
// provider accounts. A provider is listed as `enabled` only when configured.
export const GET = traced(async function GET() {
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  const { hasPassword, identities } = await listIdentities(db, user.id);
  const linked = new Map(identities.map((i) => [i.provider, i.linkedAt]));
  return json({
    hasPassword,
    providers: [
      {
        provider: "yandex",
        enabled: !!yandexIdConfig(),
        linked: linked.has("yandex"),
        linkedAt: linked.get("yandex") ?? null,
      },
    ],
  });
});
