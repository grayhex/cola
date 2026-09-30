import { db } from "./db.ts";
import { legacyShare } from "./public-link-data.ts";
import { CommunityError } from "./community-validation.ts";
export function publicReferenceRoute(
  handler: (
    req: Request,
    context: { params: Promise<{ path?: string[] }> },
  ) => Promise<Response>,
  kind: string,
  prefix: string,
) {
  return async (
    req: Request,
    { params }: { params: Promise<{ reference: string }> },
  ) => {
    try {
      const reference = await legacyShare(db, kind, (await params).reference);
      return await handler(req, {
        params: Promise.resolve({ path: [prefix, reference] }),
      });
    } catch (error) {
      if (error instanceof CommunityError)
        return Response.json(
          { error: error.message },
          { status: error.status, headers: { "Cache-Control": "no-store" } },
        );
      throw error;
    }
  };
}
