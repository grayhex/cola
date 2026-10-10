import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSchema } from "@tiptap/core";
import { bugReportInput, allowBugReport } from "../lib/bug-reports.ts";
import { bugReportMail } from "../lib/mail-templates.ts";
import {
  bugReportRecipient,
  sendMail,
  MailUnavailableError,
} from "../lib/mail.ts";
import {
  cleanRichDocument,
  richExtensions,
  parseRichText,
  serializeRichText,
  richPlainText,
} from "../lib/rich-text.ts";
import { linkAccent, contrastRatio } from "../lib/appearance.ts";
import { homeMetadata, communityDescription } from "../lib/social-metadata.ts";
import { defaultSettings } from "../lib/site-defaults.ts";
import { componentIdentity } from "../services/bike-resolver/src/component-identity.ts";
import { factoryEntries } from "../lib/factory-components.ts";
import { present } from "./support/assertions.ts";
const report = {
  description: '<script>secret & "text"</script>',
  reproduction: "Нажал кнопку",
  contact: "",
  diagnostics: {
    path: "/register",
    theme: "light",
    width: 390,
    height: 844,
    browser: "Other",
  },
};
test("bug reports accept only bounded visible input and whitelisted diagnostics", () => {
  assert.ok(bugReportInput.safeParse(report).success);
  for (const input of [
    { ...report, to: "attacker@example.test" },
    { ...report, description: " " },
    { ...report, description: "x".repeat(4001) },
    { ...report, contact: "me@example.test\r\nBcc: other@example.test" },
    ...[
      "/login?token=secret",
      "/login#token",
      "//external.test",
      "/\nheader",
    ].map((path) => ({
      ...report,
      diagnostics: { ...report.diagnostics, path },
    })),
    { ...report, diagnostics: { ...report.diagnostics, cookies: "secret" } },
  ])
    assert.equal(bugReportInput.safeParse(input).success, false);
  assert.equal(
    bugReportRecipient({
      NODE_ENV: "test",
      BUG_REPORT_TO: "owner@example.test",
    }),
    "owner@example.test",
  );
  for (const BUG_REPORT_TO of [
    "a@example.test,b@example.test",
    "a@example.test\r\nBcc: b@example.test",
    "invalid",
  ])
    assert.equal(bugReportRecipient({ NODE_ENV: "test", BUG_REPORT_TO }), null);
});
test("bug reports use separate IP, user and global budgets", async () => {
  for (const denied of ["ip", "user", "global"]) {
    const calls: [string, number][] = [];
    assert.equal(
      await allowBugReport("digest", "viewer", async (key, limit) => {
        calls.push([key, limit]);
        return !key.startsWith("bug-reports:" + denied);
      }),
      false,
    );
    assert.ok(
      calls.some(
        ([key, limit]) =>
          key.startsWith("bug-reports:" + denied) &&
          limit === (denied === "global" ? 100 : 5),
      ),
    );
  }
});
test("bug report capture has a fixed sender and recipient, escaped text and no hidden contact; failures reject", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cola-bug-report-"));
  try {
    const input = bugReportInput.parse(report);
    const mail = bugReportMail(input, {
      id: "report-1",
      requestId: "request-1",
      at: "2026-10-10T12:00:00Z",
      build: "build-1",
      accountId: null,
    });
    await sendMail(
      { to: "owner@example.test", ...mail },
      {
        NODE_ENV: "test",
        MAIL_CAPTURE_DIR: dir,
        MAIL_FROM: "Cola <fixed@example.test>",
      },
    );
    const captured = JSON.parse(
      await readFile(path.join(dir, (await readdir(dir))[0]), "utf8"),
    );
    assert.equal(captured.to, "owner@example.test");
    assert.equal(captured.from, "Cola <fixed@example.test>");
    assert.match(captured.html, /&lt;script&gt;secret &amp; &quot;text&quot;/);
    assert.match(captured.text, /Email для ответа: Не указан/);
    assert.doesNotMatch(
      JSON.stringify(captured),
      /cookie|authorization|SMTP_URL|password/i,
    );
    await assert.rejects(
      sendMail({ to: "owner@example.test", ...mail }, { NODE_ENV: "test" }),
      MailUnavailableError,
    );
    await assert.rejects(
      sendMail(
        { to: "owner@example.test", ...mail },
        {
          NODE_ENV: "test",
          SMTP_URL: "smtp://127.0.0.1:1?tls=none",
          MAIL_FROM: "fixed@example.test",
        },
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("safe article tables round-trip empty cells, links, pipes and long content; complex cells remain readable", () => {
  const source =
    "| Модель | Для кого |\n| --- | --- |\n| A \\| B | [Сайт](https://example.test) |\n| | " +
    "Длинное описание ".repeat(20) +
    " |";
  const doc = parseRichText(source);
  getSchema(richExtensions()).nodeFromJSON(doc).check();
  assert.equal(doc.content?.[0].type, "table");
  assert.deepEqual(parseRichText(serializeRichText(doc)), doc);
  for (const text of [
    String.raw`C:\| A`,
    String.raw`C:\folder`,
    String.raw`A \\| B`,
  ]) {
    const literal = parseRichText("| A | B |\n| --- | --- |\n| text | next |");
    const cell = literal.content?.[0].content?.[1].content?.[0].content?.[0];
    assert.ok(cell);
    cell.content = [{ type: "text", text }];
    assert.deepEqual(parseRichText(serializeRichText(literal)), literal);
  }
  assert.match(richPlainText(source), /Модель \| Для кого/);
  const unsafe = parseRichText(
    "| A | B |\n| --- | --- |\n| [bad](javascript:alert%281%29) | <img src=x onerror=alert(1)> |",
  );
  assert.doesNotMatch(
    JSON.stringify(unsafe),
    /"href":"javascript:|"type":"image"|"onerror":/,
  );
  const fallback = cleanRichDocument({
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: "tableCell",
            attrs: { colspan: 2, onclick: "secret" },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "One" }] },
            ],
          },
          {
            type: "tableCell",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Two" }] },
            ],
          },
        ],
      },
    ],
  });
  assert.match(JSON.stringify(fallback), /One \| Two/);
  assert.match(JSON.stringify(fallback), /Таблица преобразована/);
  assert.doesNotMatch(JSON.stringify(fallback), /onclick|colspan/);
});
test("text accent stays AA across themes and black/white user choices", () => {
  for (const accent of [
    "#000000",
    "#FFFFFF",
    "#FF0000",
    "#F3B51B",
    "#00FF00",
    "#0000FF",
  ])
    for (const theme of ["light", "dark"] as const)
      for (const surface of theme === "light"
        ? ["#FFFFFF", "#F3F4F6"]
        : ["#030712", "#111827", "#1F2937"])
        assert.ok(
          contrastRatio(linkAccent(accent, theme), surface) >= 4.5,
          `${accent} / ${theme} / ${surface}`,
        );
});
test("home metadata has absolute canonical/image URLs and keeps the owner's description", () => {
  const env = {
    NODE_ENV: "test" as const,
    PUBLIC_SITE_URL: "https://cola.example.test",
  };
  const old = homeMetadata(
    {
      ...defaultSettings,
      siteDescription: "Витрина велосипедов, комплектаций и авторских сборок.",
    },
    env,
  );
  assert.equal(old.description, communityDescription);
  assert.equal(old.alternates.canonical, "https://cola.example.test/");
  assert.equal(
    old.openGraph.images[0].url,
    "https://cola.example.test/api/social-preview/home/image",
  );
  assert.equal(
    homeMetadata(
      { ...defaultSettings, siteDescription: "Авторское описание" },
      env,
    ).description,
    "Авторское описание",
  );
});
test("factory source artefacts are cleaned narrowly while original specifications reach saved notes", () => {
  const cases = [
    ["tire", "Schwalbe G-One RS Evo Width", "Schwalbe G-One RS Evo"],
    [
      "cockpit",
      "Canyon Cockpit CP0039 One-piece carbon cockpit with specialist gravel ergonomics and design, and versatile Gear Groove interface for mounting a range",
      "Canyon Cockpit CP0039",
    ],
    [
      "fork",
      "FOX FLOAT 36 Factory, GRIP X2 damper, HS and LS rebound and compression adjustment, 15x110mm QR axle, 44mm offset, S1:150mm of travel, S2-S6:160mm of",
      "FOX FLOAT 36 Factory",
    ],
  ];
  for (const [type, description, name] of cases) {
    const part = {
      type,
      description,
      raw: { label: type, value: description },
      attributes: {},
    };
    assert.equal(present(componentIdentity(part)).name, name);
    assert.equal(present(componentIdentity(part)).description, description);
    const entries = factoryEntries({ components: [part] });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].value.name, name);
    assert.ok(JSON.stringify(entries[0]).includes(description));
  }
});
