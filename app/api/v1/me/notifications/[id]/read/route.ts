import { handleNotificationRead } from "../../../../../../../lib/api-v1/notification-handlers.ts";
import { methodNotAllowed } from "../../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PUT = traced(handleNotificationRead);
const unsupported = traced(methodNotAllowed("PUT, OPTIONS"));
export {
  unsupported as GET,
  unsupported as POST,
  unsupported as PATCH,
  unsupported as DELETE,
};
