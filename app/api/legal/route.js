import { db } from "../../../lib/db.ts";
import { legalMetadata } from "../../../lib/legal-documents.ts";
import { json } from "../../../lib/http.ts";
import { traced } from "../../../lib/observability.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = traced(async () => json(await legalMetadata(db)));
