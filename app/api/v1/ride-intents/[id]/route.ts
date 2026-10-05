import {
  handleGetRideIntent,
  handleReplaceRideIntent,
  handleDeleteRideIntent,
} from "../../../../../lib/api-v1/planning-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleGetRideIntent);
export const PUT = traced(handleReplaceRideIntent);
export const DELETE = traced(handleDeleteRideIntent);
const unsupported = traced(methodNotAllowed("GET, PUT, DELETE, HEAD, OPTIONS"));
export { unsupported as POST, unsupported as PATCH };
