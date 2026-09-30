import * as original from "../../[...path]/route.ts";
import { publicResponse } from "../../../../lib/public-response.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";

async function handler(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await params;
  return publicResponse(
    await original[req.method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE"](
      req,
      {
        params: Promise.resolve({ path: ["bikes", ...path] }),
      },
    ),
  );
}
export const GET = handler,
  POST = handler,
  PATCH = handler,
  PUT = handler,
  DELETE = handler;
