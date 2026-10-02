import { handleRevokeCurrentSession } from "../../../../../../lib/api-v1/auth-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const DELETE = traced(handleRevokeCurrentSession);
const unsupported = traced(methodNotAllowed("DELETE, OPTIONS"));
export {
  unsupported as GET,
  unsupported as POST,
  unsupported as PUT,
  unsupported as PATCH,
};
