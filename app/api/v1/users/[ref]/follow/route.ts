import { handleFollow } from "../../../../../../lib/api-v1/toggle-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PUT = traced(handleFollow);
export const DELETE = traced(handleFollow);
const unsupported = traced(methodNotAllowed("PUT, DELETE, OPTIONS"));
export { unsupported as GET, unsupported as POST, unsupported as PATCH };
