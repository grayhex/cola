import {
  handlePushDevice,
  handlePushDeviceRegister,
  handlePushDeviceRevoke,
} from "../../../../../lib/api-v1/push-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handlePushDevice);
export const PUT = traced(handlePushDeviceRegister);
export const DELETE = traced(handlePushDeviceRevoke);
const unsupported = traced(methodNotAllowed("GET, HEAD, PUT, DELETE, OPTIONS"));
export { unsupported as POST, unsupported as PATCH };
