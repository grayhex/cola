import { handleRideComments } from "../../../../../../lib/api-v1/journal-handlers.ts";
import { handleCreateRideComment } from "../../../../../../lib/api-v1/comment-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleRideComments);
export const POST = traced(handleCreateRideComment);
const unsupported = traced(methodNotAllowed("GET, POST, HEAD, OPTIONS"));
export { unsupported as PUT, unsupported as PATCH, unsupported as DELETE };
