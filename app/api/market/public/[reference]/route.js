import { GET as original } from '../../[[...path]]/route.js';
import { publicReferenceRoute } from '../../../../../lib/public-reference-route.js';
export const runtime = 'nodejs', dynamic = 'force-dynamic';
export const GET = publicReferenceRoute(original, 'market', 'public');
