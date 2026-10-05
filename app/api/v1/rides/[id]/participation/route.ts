import {
  handleRideParticipation,
  handleRespondToRide,
} from "../../../../../../lib/api-v1/planning-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleRideParticipation);
export const PUT = traced(handleRespondToRide);
const unsupported = traced(methodNotAllowed("GET, PUT, HEAD, OPTIONS"));
export { unsupported as POST, unsupported as PATCH, unsupported as DELETE };
