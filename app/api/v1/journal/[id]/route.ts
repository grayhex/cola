import { handleGetJournalEntry } from "../../../../../lib/api-v1/journal-handlers.ts";
import {
  handleDeleteJournalEntry,
  handlePatchJournalEntry,
} from "../../../../../lib/api-v1/journal-write-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleGetJournalEntry);
export const PATCH = traced(handlePatchJournalEntry);
export const DELETE = traced(handleDeleteJournalEntry);
const unsupported = traced(
  methodNotAllowed("GET, PATCH, DELETE, HEAD, OPTIONS"),
);
export { unsupported as POST, unsupported as PUT };
