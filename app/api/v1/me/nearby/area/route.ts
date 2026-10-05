import {
  handleNearbyArea,
  handleNearbyAreaRemove,
} from "../../../../../../lib/api-v1/nearby-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PUT = traced(handleNearbyArea);
export const DELETE = traced(handleNearbyAreaRemove);
const unsupported = traced(methodNotAllowed("PUT, DELETE, OPTIONS"));
export { unsupported as GET, unsupported as POST, unsupported as PATCH };
