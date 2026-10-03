import {
  handleDeleteRideComment,
  handleEditRideComment,
} from "../../../../../../../lib/api-v1/comment-write-handlers.ts";
import { methodNotAllowed } from "../../../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const PATCH = traced(handleEditRideComment);
export const DELETE = traced(handleDeleteRideComment);
const unsupported = traced(methodNotAllowed("PATCH, DELETE, OPTIONS"));
export { unsupported as GET, unsupported as POST, unsupported as PUT };
