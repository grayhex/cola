import { handleCreateBike } from "../../../../lib/api-v1/bike-write-handlers.ts";
import { handleListBikes } from "../../../../lib/api-v1/handlers.ts";
import { methodNotAllowed } from "../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleListBikes);
export const POST = traced(handleCreateBike);
const unsupported = traced(methodNotAllowed("GET, POST, HEAD, OPTIONS"));
export { unsupported as PUT, unsupported as PATCH, unsupported as DELETE };
