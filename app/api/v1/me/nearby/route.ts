import {
  handleNearby,
  handleNearbyForget,
  handleNearbySettings,
} from "../../../../../lib/api-v1/nearby-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleNearby);
export const PATCH = traced(handleNearbySettings);
export const DELETE = traced(handleNearbyForget);
const unsupported = traced(
  methodNotAllowed("GET, HEAD, PATCH, DELETE, OPTIONS"),
);
export { unsupported as POST, unsupported as PUT };
