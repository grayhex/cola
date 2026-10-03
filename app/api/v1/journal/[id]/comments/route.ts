import { handleJournalComments } from "../../../../../../lib/api-v1/journal-handlers.ts";
import { handleCreateJournalComment } from "../../../../../../lib/api-v1/comment-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleJournalComments);
export const POST = traced(handleCreateJournalComment);
const unsupported = traced(methodNotAllowed("GET, POST, HEAD, OPTIONS"));
export { unsupported as PUT, unsupported as PATCH, unsupported as DELETE };
