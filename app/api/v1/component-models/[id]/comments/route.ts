import { handleComponentComments } from "../../../../../../lib/api-v1/journal-handlers.ts";
import { handleCreateComponentComment } from "../../../../../../lib/api-v1/comment-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleComponentComments);
export const POST = traced(handleCreateComponentComment);
const unsupported = traced(methodNotAllowed("GET, POST, HEAD, OPTIONS"));
export { unsupported as PUT, unsupported as PATCH, unsupported as DELETE };
