import { GET as original } from "../../[[...path]]/route.ts";
import { publicReferenceRoute } from "../../../../../lib/public-reference-route.ts";
export const runtime = "nodejs",
  dynamic = "force-dynamic";
export const GET = publicReferenceRoute(original, "journal", "public");
