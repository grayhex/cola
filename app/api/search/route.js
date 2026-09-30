import { GET as original } from "../[...path]/route.js";
import { publicResponse } from "../../../lib/public-response.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
/** @param {Request} req */
export async function GET(req) {
  return publicResponse(
    await original(req, { params: Promise.resolve({ path: ["search"] }) }),
  );
}
