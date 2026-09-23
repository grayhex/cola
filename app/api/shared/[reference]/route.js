import { GET as original } from '../../[...path]/route.js';
import { db } from '../../../../lib/db.js';
import { legacyShare } from '../../../../lib/public-link-data.js';
import { publicResponse } from '../../../../lib/public-response.js';
import { CommunityError } from '../../../../lib/community-validation.js';
export const runtime = 'nodejs', dynamic = 'force-dynamic';
export async function GET(req, { params }) {
  try {
    const reference = await legacyShare(db, 'bike', (await params).reference);
    return publicResponse(await original(req, { params: Promise.resolve({ path: ['shared', reference] }) }));
  } catch (error) {
    if (error instanceof CommunityError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    throw error;
  }
}
