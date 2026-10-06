import { handleBlock } from "../../../../../../lib/api-v1/safety-handlers.ts";
import { methodNotAllowed } from "../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PUT = traced(handleBlock);
export const DELETE = traced(handleBlock);
const unsupported = traced(methodNotAllowed("PUT, DELETE, OPTIONS"));
export { unsupported as GET, unsupported as POST, unsupported as PATCH };
