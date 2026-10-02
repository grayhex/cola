import { handleUnknownPath } from "../../../../lib/api-v1/handlers.ts";
import { traced } from "../../../../lib/observability.ts";

// Every address under /api/v1 that is not an operation of the contract: a
// typed 404 in the API's own error format, not the legacy catch-all's.
export const runtime = "nodejs",
  dynamic = "force-dynamic";

const unknown = traced(handleUnknownPath);
export {
  unknown as GET,
  unknown as POST,
  unknown as PUT,
  unknown as PATCH,
  unknown as DELETE,
};
