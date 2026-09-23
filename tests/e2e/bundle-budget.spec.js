import { test, expect } from "@playwright/test";

// #79: a guest must not download the comment editor, the bike wizard or the
// owner's tools with the home page or the showcase. Sizes are the compressed
// bytes the browser receives from `next start`.
const budgets = [
  ["/", 220],
  ["/bikes", 250],
];
for (const [path, limitKb] of budgets)
  test(`guest JavaScript on ${path} stays within ${limitKb} KB gzip`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Bundle sizes do not depend on the browser; measured once in Chromium",
    );
    const scripts = [];
    page.on("requestfinished", (request) => {
      if (request.resourceType() === "script") scripts.push(request);
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const sizes = await Promise.all(
      scripts.map(async (request) => ({
        path: new URL(request.url()).pathname,
        bytes: (await request.sizes()).responseBodySize,
      })),
    );
    const totalKb = sizes.reduce((sum, s) => sum + s.bytes, 0) / 1024;
    const largest = sizes
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map((s) => `  ${s.path} ${Math.round(s.bytes / 1024)} KB`)
      .join("\n");
    expect(
      totalKb,
      `JavaScript on ${path}: ${Math.round(totalKb)} KB gzip, budget ${limitKb} KB.\n` +
        `Largest chunks:\n${largest}\n` +
        "Load heavy parts with next/dynamic (see issue #79).",
    ).toBeLessThanOrEqual(limitKb);
  });
