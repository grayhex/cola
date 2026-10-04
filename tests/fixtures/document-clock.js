import { expect } from "@playwright/test";

// `performance.timeOrigin` is the moment the browser document began. A soft
// (client-side) navigation keeps the document, a real load starts a new one.
// WebKit rounds the value, so two reads of the same document can differ by a
// millisecond; a real load moves it by far more than the tolerance below.
export const TIME_ORIGIN_TOLERANCE_MS = 5;

export const documentClock = (page) =>
  page.evaluate(() => performance.timeOrigin);

/** The page is still the document it was when `clock` was read. */
export async function expectSameDocument(page, clock) {
  const now = await documentClock(page);
  expect(
    Math.abs(now - clock),
    "the document was replaced: this was a real load, not a client navigation",
  ).toBeLessThan(TIME_ORIGIN_TOLERANCE_MS);
}
