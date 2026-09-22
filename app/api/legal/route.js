import { db } from "../../../lib/db.js";
import { legalMetadata } from "../../../lib/legal-documents.js";
import { json } from "../../../lib/http.js";
import { traced } from "../../../lib/observability.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = traced(async () => json(await legalMetadata(db)));
