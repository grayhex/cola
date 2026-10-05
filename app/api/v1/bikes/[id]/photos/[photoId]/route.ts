import { handleDeleteBikePhoto } from "../../../../../../../lib/api-v1/bike-photo-handlers.ts";
import { methodNotAllowed } from "../../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const DELETE = traced(handleDeleteBikePhoto);
const unsupported = traced(methodNotAllowed("DELETE, OPTIONS"));
export {
  unsupported as GET,
  unsupported as POST,
  unsupported as PUT,
  unsupported as PATCH,
};
