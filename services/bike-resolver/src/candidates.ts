import { partialScore } from "./matcher.js";
import { CandidateRegistry } from "./candidate-registry.js";
import { SourceSearch } from "./search.js";
import type {
  BikeQuery,
  BikeManufacturerAdapter,
  ResolveResult,
} from "./domain.js";
import type { ManufacturerHttpClient } from "./http.js";
import type { ManualSources } from "./manual.js";
import type { SettingsStore } from "./settings.js";
import type { RetailStore } from "./stores/types.js";
export { partialScore };
// A bounded discovery pass over official, archive, store and web sources; every
// shown page has a parsable specification, a partial identity match needs an
// explicit choice and keeps its mismatch warnings. See search.ts.
export async function findCandidates(
  query: BikeQuery,
  adapters: BikeManufacturerAdapter[],
  http: ManufacturerHttpClient,
  manual: ManualSources,
  settings: SettingsStore,
  extra: { stores?: RetailStore[]; registry?: CandidateRegistry } = {},
): Promise<ResolveResult> {
  return new SourceSearch({
    adapters,
    http,
    manual,
    settings,
    stores: extra.stores ?? [],
    registry: extra.registry ?? new CandidateRegistry(),
  }).all(query);
}
