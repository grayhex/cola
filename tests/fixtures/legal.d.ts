import type { Page } from "@playwright/test";
import type { Queryable } from "../../lib/db.ts";
export const testConsents: Readonly<{
  termsAccepted: true;
  privacyAccepted: true;
  termsRevision: 1;
  privacyRevision: 1;
}>;
export function legalRequestsAfterSignup(page: Page): string[];
export function seedLegalDocuments(q: Queryable): Promise<void>;
