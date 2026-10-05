import {
  handleDeleteBike,
  handlePatchBike,
} from "../../../../../lib/api-v1/bike-write-handlers.ts";
import { handleGetBike } from "../../../../../lib/api-v1/handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleGetBike);
export const PATCH = traced(handlePatchBike);
export const DELETE = traced(handleDeleteBike);
const unsupported = traced(
  methodNotAllowed("GET, PATCH, DELETE, HEAD, OPTIONS"),
);
export { unsupported as POST, unsupported as PUT };
