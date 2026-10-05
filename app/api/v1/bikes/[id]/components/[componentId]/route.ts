import {
  handleDeleteBikeComponent,
  handlePatchBikeComponent,
} from "../../../../../../../lib/api-v1/bike-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PATCH = traced(handlePatchBikeComponent);
export const DELETE = traced(handleDeleteBikeComponent);
const unsupported = traced(methodNotAllowed("PATCH, DELETE, OPTIONS"));
export { unsupported as GET, unsupported as POST, unsupported as PUT };
