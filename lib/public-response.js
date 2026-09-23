import { db } from './db.js';
import { currentUser } from './auth.js';
import { hasPublicReferences, publicPayload } from './public-link-data.js';

export async function withPublicReferences(data) {
  const viewer = hasPublicReferences(data) ? await currentUser() : null;
  return publicPayload(db, data, viewer?.id || null);
}

// Transport adapter for the original catch-all API during the URL migration.
// Authorization, quotas, transactions and error statuses remain in its handler.
export async function publicResponse(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const data = await withPublicReferences(await response.json());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json(data, { status: response.status, headers });
}
