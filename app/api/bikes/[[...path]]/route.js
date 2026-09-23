import * as original from '../../[...path]/route.js';
import { publicResponse } from '../../../../lib/public-response.js';
export const runtime = 'nodejs', dynamic = 'force-dynamic';
async function handler(req, { params }) {
  const { path = [] } = await params;
  return publicResponse(await original[req.method](req, { params: Promise.resolve({ path: ['bikes', ...path] }) }));
}
export const GET = handler, POST = handler, PATCH = handler, PUT = handler, DELETE = handler;
