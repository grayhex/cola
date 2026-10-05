import { handleDeleteJournalPhoto } from "../../../../../../../lib/api-v1/journal-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const DELETE = traced(handleDeleteJournalPhoto);
const unsupported = traced(methodNotAllowed("DELETE, OPTIONS"));
export {
  unsupported as GET,
  unsupported as POST,
  unsupported as PUT,
  unsupported as PATCH,
};
