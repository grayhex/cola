import { handleChatChannels } from "../../../../../lib/api-v1/chat-handlers.ts";
import { methodNotAllowed } from "../../../../../lib/api-v1/respond.ts";
import { traced } from "../../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const POST = traced(handleChatChannels);
const unsupported = traced(methodNotAllowed("POST, OPTIONS"));
export {
  unsupported as GET,
  unsupported as PUT,
  unsupported as PATCH,
  unsupported as DELETE,
};
