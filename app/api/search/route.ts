import { GET as original } from "../[...path]/route.ts";
import { publicResponse } from "../../../lib/public-response.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";

export async function GET(req: Request) {
  return publicResponse(
    await original(req, { params: Promise.resolve({ path: ["search"] }) }),
  );
}
