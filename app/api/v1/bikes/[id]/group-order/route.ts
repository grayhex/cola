import { handleBikeGroupOrder } from "../../../../../../lib/api-v1/bike-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PUT = traced(handleBikeGroupOrder);
const unsupported = traced(methodNotAllowed("PUT, OPTIONS"));
export {
  unsupported as GET,
  unsupported as POST,
  unsupported as PATCH,
  unsupported as DELETE,
};
