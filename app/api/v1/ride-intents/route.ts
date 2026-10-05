import {
  handleCommunityRideIntents,
  handleCreateRideIntent,
} from "../../../../lib/api-v1/planning-handlers.ts";
import { methodNotAllowed } from "../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleCommunityRideIntents);
export const POST = traced(handleCreateRideIntent);
const unsupported = traced(methodNotAllowed("GET, POST, HEAD, OPTIONS"));
export { unsupported as PUT, unsupported as PATCH, unsupported as DELETE };
