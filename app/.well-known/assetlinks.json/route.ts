import { assetLinks } from "../../../lib/android-app-links.ts";
import { traced } from "../../../lib/observability.ts";

export const runtime = "nodejs",
  dynamic = "force-dynamic";

// Public, the same for everyone, and fetched by the system without cookies or
// redirects. A misconfigured fingerprint is a deployment error, caught at
// startup in production; here it only means an empty list.
export const GET = traced(async () => {
  let body: ReturnType<typeof assetLinks>;
  try {
    body = assetLinks();
  } catch {
    body = [];
  }
  return Response.json(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
