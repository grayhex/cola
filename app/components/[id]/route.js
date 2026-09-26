import { db } from "../../../lib/db.js";
import { resolveComponentModel } from "../../../lib/component-catalog.js";
import { partLandingPath } from "../../../lib/experience-catalog.js";
export const dynamic = "force-dynamic";
// A real HTTP redirect, including for non-JS clients: a streamed page could
// already have sent 200 by the time its asynchronous lookup completes.
export async function GET(req, { params }) {
  const model = await resolveComponentModel(db, (await params).id);
  if (!model)
    return new Response("Модель не найдена", {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  return new Response(null, {
    status: 308,
    headers: {
      Location: partLandingPath(model.category_slug, model.slug),
      "Cache-Control": "private, no-store",
    },
  });
}
