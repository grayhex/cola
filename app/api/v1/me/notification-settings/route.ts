import {
  handleNotificationSettings,
  handleNotificationSettingsUpdate,
} from "../../../../../lib/api-v1/notification-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const GET = traced(handleNotificationSettings);
export const PATCH = traced(handleNotificationSettingsUpdate);
const unsupported = traced(methodNotAllowed("GET, HEAD, PATCH, OPTIONS"));
export { unsupported as POST, unsupported as PUT, unsupported as DELETE };
