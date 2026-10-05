import { handleOwnRideIntents } from "../../../../../lib/api-v1/planning-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleOwnRideIntents);
const unsupported = traced(methodNotAllowed("GET, HEAD, OPTIONS"));
export {
  unsupported as POST,
  unsupported as PUT,
  unsupported as PATCH,
  unsupported as DELETE,
};
