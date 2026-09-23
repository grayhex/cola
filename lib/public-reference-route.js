import { db } from './db.js';
import { legacyShare } from './public-link-data.js';
import { CommunityError } from './community-validation.js';
export function publicReferenceRoute(handler, kind, prefix) {
  return async (req, { params }) => {
    try {
      const reference = await legacyShare(db, kind, (await params).reference);
      return await handler(req, { params: Promise.resolve({ path: [prefix, reference] }) });
    } catch (error) {
      if (error instanceof CommunityError)
        return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
      throw error;
    }
  };
}
