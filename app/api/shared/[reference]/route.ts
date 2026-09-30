import { GET as original } from "../../[...path]/route.ts";
import { db } from "../../../../lib/db.ts";
import { legacyShare } from "../../../../lib/public-link-data.ts";
import { publicResponse } from "../../../../lib/public-response.ts";
import { CommunityError } from "../../../../lib/community-validation.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  try {
    const reference = await legacyShare(db, "bike", (await params).reference);
    return publicResponse(
      await original(req, {
        params: Promise.resolve({ path: ["shared", reference] }),
      }),
    );
  } catch (error) {
    if (error instanceof CommunityError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}
