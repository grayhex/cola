import { transaction } from "../../../../lib/db.ts";
import { handleChatWebhook } from "../../../../lib/chat-webhook.ts";
import { traced } from "../../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

export const POST = traced((req: Request) =>
  handleChatWebhook(req, { transaction }),
);
const refuse = traced(
  async () => new Response(null, { status: 405, headers: { Allow: "POST" } }),
);
export { refuse as GET, refuse as PUT, refuse as PATCH, refuse as DELETE };
