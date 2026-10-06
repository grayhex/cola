import { handleDeleteAccount } from "../../../../../lib/api-v1/account-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const POST = traced(handleDeleteAccount);
const unsupported = traced(methodNotAllowed("POST, OPTIONS"));
export {
  unsupported as GET,
  unsupported as PUT,
  unsupported as PATCH,
  unsupported as DELETE,
};
