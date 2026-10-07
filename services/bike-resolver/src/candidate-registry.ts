import { createHash } from "node:crypto";
import { sourceIdentity } from "./source-url.js";
import type { BikeCandidate, Resolved, SourceKind } from "./domain.js";

// Opaque and deterministic: the same page always gets the same id.
export const candidateIdOf = (url: string) =>
  createHash("sha256").update(sourceIdentity(url)).digest("hex");

export interface RememberedCandidate {
  url: string;
  kind: SourceKind;
  storeId?: string;
  // What the person saw in the list; reused so that the choice is what is imported.
  resolved?: Resolved;
}
interface Entry extends RememberedCandidate {
  expires: number;
  resolvedExpires: number;
}
// Process-local, like temporary photo ids: a restart or expiry asks the person
// to search again. It maps an id from a previous result to the page it named;
// a client can never make the service fetch an address it was not offered.
export class CandidateRegistry {
  private items = new Map<string, Entry>();
  constructor(
    private ttlMs = 2 * 3600000,
    private resolvedTtlMs = 20 * 60000,
    private max = 400,
    private maxResolved = 40,
  ) {}
  remember(candidate: BikeCandidate, resolved?: Resolved) {
    if (!candidate.candidateId || !candidate.kind) return;
    const now = Date.now();
    this.items.delete(candidate.candidateId);
    this.items.set(candidate.candidateId, {
      url: candidate.url,
      kind: candidate.kind,
      ...(candidate.storeId ? { storeId: candidate.storeId } : {}),
      ...(resolved ? { resolved: structuredClone(resolved) } : {}),
      expires: now + this.ttlMs,
      resolvedExpires: now + this.resolvedTtlMs,
    });
    for (const [id, entry] of this.items)
      if (entry.expires < now) this.items.delete(id);
    while (this.items.size > this.max)
      this.items.delete(this.items.keys().next().value!);
    // Parsed copies are the heavy part: only the newest few are kept.
    let held = 0;
    for (const entry of [...this.items.values()].reverse())
      if (entry.resolved && ++held > this.maxResolved) delete entry.resolved;
  }
  get(id: string): RememberedCandidate | undefined {
    const entry = this.items.get(id);
    if (!entry || entry.expires < Date.now()) return undefined;
    const fresh = entry.resolved && entry.resolvedExpires > Date.now();
    return {
      url: entry.url,
      kind: entry.kind,
      ...(entry.storeId ? { storeId: entry.storeId } : {}),
      ...(fresh ? { resolved: structuredClone(entry.resolved!) } : {}),
    };
  }
}
