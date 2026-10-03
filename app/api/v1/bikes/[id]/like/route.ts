import { handleBikeLike } from "../../../../../../lib/api-v1/toggle-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PUT = traced(handleBikeLike);
export const DELETE = traced(handleBikeLike);
const unsupported = traced(methodNotAllowed("PUT, DELETE, OPTIONS"));
export { unsupported as GET, unsupported as POST, unsupported as PATCH };
