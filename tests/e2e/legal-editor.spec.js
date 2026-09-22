import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "../fixtures/legal.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const password = "legal-editor-browser-123";
const termsLabel = "Принять пользовательское соглашение";
const privacyLabel = "Согласен с политикой обработки персональных данных";
async function fillRegistration(page) {
  await page.goto("/register");
  await page
    .getByLabel("Ваше имя", { exact: true })
    .fill("Документы " + randomUUID().slice(0, 6));
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(randomUUID() + "@legal-browser.test");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Подтвердите пароль", { exact: true }).fill(password);
  await expect(page.getByRole("checkbox", { name: termsLabel })).toBeEnabled();
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
async function user(page, db) {
  const r = await page.request.post("/api/auth/register", {
    headers: { origin },
    data: {
      name: "Legal editor",
      email: randomUUID() + "@legal-editor.test",
      password,
      ...testConsents,
    },
  });
  expect(r.status()).toBe(201);
  const { user } = await (await page.request.get("/api/me")).json();
  if (db)
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  return user;
}

test("registration requires two explicit consents with versioned links between password confirmation and submit", async ({
  page,
  context,
}, info) => {
  await fillRegistration(page);
  const terms = page.getByRole("checkbox", { name: termsLabel }),
    privacy = page.getByRole("checkbox", { name: privacyLabel });
  const submit = page.getByRole("button", {
    name: "Создать аккаунт",
    exact: true,
  });
  await expect(terms).not.toBeChecked();
  await expect(privacy).not.toBeChecked();
  await submit.click();
  await expect(page).toHaveURL(/register/);
  await terms.check();
  await submit.click();
  await expect(page).toHaveURL(/register/);
  await terms.uncheck();
  await privacy.check();
  await submit.click();
  await expect(page).toHaveURL(/register/);
  await privacy.uncheck();
  for (const [word, kind] of [
    ["соглашение", "terms"],
    ["политикой", "privacy"],
  ]) {
    const link = page
      .locator(".auth-form")
      .getByRole("link", { name: word, exact: true });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const popupPromise = context.waitForEvent("page");
    await link.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(new RegExp(`/legal/${kind}\\?revision=1`));
    await expect(popup.locator("main")).toContainText("TEST ONLY");
    await popup.close();
    await expect(terms).not.toBeChecked();
    await expect(privacy).not.toBeChecked();
  }
  const positions = await page.locator(".auth-form").evaluate((form) => {
    const confirm = form.querySelector('[name="confirmPassword"]'),
      consent = form.querySelector('[name="termsAccepted"]'),
      button = form.querySelector("button.full");
    return [
      !!(
        confirm.compareDocumentPosition(consent) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ),
      !!(
        consent.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ),
    ];
  });
  expect(positions).toEqual([true, true]);
  expect(
    await terms.evaluate((el) =>
      parseFloat(getComputedStyle(el.closest("label")).fontSize),
    ),
  ).toBeLessThanOrEqual(13);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("registration-consents.png"),
    fullPage: true,
  });
  await terms.check();
  await privacy.check();
  await submit.click();
  await expect(page).toHaveURL(/\/account$/);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const me = (await (await page.request.get("/api/me")).json()).user;
    const { rows } = await db.query(
      "SELECT kind,revision FROM user_legal_acceptances WHERE user_id=$1 ORDER BY kind",
      [me.id],
    );
    expect(rows).toEqual([
      { kind: "privacy", revision: 1 },
      { kind: "terms", revision: 1 },
    ]);
  } finally {
    await db.end();
  }
});

test("document fetch failure blocks registration, retries preserve fields and mode switching clears consents", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/legal", async (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: "fixture unavailable" } })
      : route.continue(),
  );
  await page.goto("/register");
  await page.getByLabel("Ваше имя").fill("Сохранить имя");
  await expect(
    page.getByRole("button", { name: "Создать аккаунт", exact: true }),
  ).toBeDisabled();
  fail = false;
  await page
    .getByRole("button", { name: "Повторить загрузку документов" })
    .click();
  await expect(page.getByRole("checkbox", { name: termsLabel })).toBeEnabled();
  await expect(page.getByLabel("Ваше имя")).toHaveValue("Сохранить имя");
  await page.getByRole("checkbox", { name: termsLabel }).check();
  await page.getByRole("checkbox", { name: privacyLabel }).check();
  await page.getByRole("button", { name: "Уже есть аккаунт? Войти" }).click();
  await expect(page.getByRole("checkbox", { name: termsLabel })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: termsLabel }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: privacyLabel }),
  ).not.toBeChecked();
});

test("admin imports text, edits rich content, preserves drafts across tabs, publishes immutable versions and invalidates stale consent", async ({
  page,
  context,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const original = (
    await db.query("SELECT * FROM legal_documents ORDER BY kind")
  ).rows;
  const admin = await user(page, db);
  const visitor = await context.browser().newContext({ baseURL: origin });
  const reader = await visitor.newPage();
  try {
    await fillRegistration(reader);
    await reader.getByRole("checkbox", { name: termsLabel }).check();
    await reader.getByRole("checkbox", { name: privacyLabel }).check();
    const oldHref = await reader
      .locator(".auth-form")
      .getByRole("link", { name: "соглашение", exact: true })
      .getAttribute("href");
    await page.goto("/admin");
    await page.getByRole("button", { name: "Документы", exact: true }).click();
    const area = page.getByRole("region", { name: "Документы сайта" });
    await expect(
      area.getByRole("textbox", {
        name: "Пользовательское соглашение",
        exact: true,
      }),
    ).toBeVisible();
    page.on("dialog", (d) => d.accept());
    const source =
      "# Условия участия\n\n**Важное условие** и ++подчёркнутый текст++.\n\n1. Первый пункт\n2. Второй пункт\n\n[Наш сайт](https://example.test/rules)\n\n<script>window.legalXss=true</script>";
    await area
      .getByLabel(/Загрузить текст/)
      .setInputFiles({
        name: "terms.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(source),
      });
    await expect(
      area.getByRole("textbox", {
        name: "Пользовательское соглашение",
        exact: true,
      }),
    ).toContainText("Важное условие");
    await page.getByRole("button", { name: "Обзор", exact: true }).click();
    await page.getByRole("button", { name: "Документы", exact: true }).click();
    await area.getByRole("tab", { name: "Предпросмотр", exact: true }).click();
    const preview = area.locator(
      '[data-rich-editor] [role="tabpanel"]:visible',
    );
    await expect(preview.locator("strong")).toHaveText("Важное условие");
    await expect(preview.locator("u")).toHaveText("подчёркнутый текст");
    await expect(preview.locator("ol li")).toHaveCount(2);
    expect(await page.evaluate(() => window.legalXss)).toBeUndefined();
    await area
      .getByRole("button", { name: "Сохранить черновик документа" })
      .click();
    await expect(area.getByRole("status")).toContainText("Черновик сохранён");
    expect(await (await page.request.get("/legal/terms")).text()).not.toContain(
      "Условия участия",
    );
    await page.reload();
    await page.getByRole("button", { name: "Документы", exact: true }).click();
    await expect(
      area.getByRole("textbox", {
        name: "Пользовательское соглашение",
        exact: true,
      }),
    ).toContainText("Условия участия");
    await area
      .getByRole("button", { name: "Опубликовать документ", exact: true })
      .click();
    await expect(area.getByRole("status")).toContainText(
      "Документ опубликован",
    );
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("admin-legal-documents.png"),
      fullPage: true,
    });
    expect(await (await reader.request.get(oldHref)).text()).toContain(
      "TEST ONLY",
    );
    await reader
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await expect(reader.locator(".auth-form").getByRole("alert")).toContainText(
      "Документы обновились",
    );
    await expect(
      reader.getByRole("checkbox", { name: termsLabel }),
    ).not.toBeChecked();
    await expect(
      reader.getByRole("checkbox", { name: privacyLabel }),
    ).not.toBeChecked();
    await expect(reader.getByLabel("Пароль", { exact: true })).toHaveValue(
      password,
    );
    await expect(
      reader
        .locator(".auth-form")
        .getByRole("link", { name: "соглашение", exact: true }),
    ).toHaveAttribute("href", "/legal/terms?revision=2");
    // Optimistic concurrency: another admin save must not overwrite this editor's draft.
    let doc = (
      await (await page.request.get("/api/admin/legal")).json()
    ).documents.find((d) => d.kind === "terms");
    const other = await page.request.put("/api/admin/legal", {
      headers: { origin },
      data: { kind: "terms", version: doc.version, body: "Other admin draft" },
    });
    expect(other.status()).toBe(200);
    await area
      .getByRole("textbox", {
        name: "Пользовательское соглашение",
        exact: true,
      })
      .fill("Мой несохранённый текст");
    await area
      .getByRole("button", { name: "Сохранить черновик документа" })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      "другим администратором",
    );
    await expect(
      area.getByRole("textbox", {
        name: "Пользовательское соглашение",
        exact: true,
      }),
    ).toHaveText("Мой несохранённый текст");
    // Public page uses the same sanitized rich renderer, not raw HTML.
    await reader.goto("/legal/terms");
    await expect(reader.locator("main strong")).toHaveText("Важное условие");
    await expect(reader.locator("main u")).toHaveText("подчёркнутый текст");
    expect(await reader.evaluate(() => window.legalXss)).toBeUndefined();
  } finally {
    await visitor.close();
    for (const d of original)
      await db.query(
        "UPDATE legal_documents SET draft_body=$2,draft_version=$3,published_revision=$4,updated_at=$5 WHERE kind=$1",
        [
          d.kind,
          d.draft_body,
          d.draft_version,
          d.published_revision,
          d.updated_at,
        ],
      );
    await db.query("DELETE FROM legal_document_versions WHERE revision>1");
    await db.end();
  }
});

// Select with real editing keys, without guessing Mod from the Linux host or
// about:blank's platform. fill() leaves the caret at the end of these plain texts.
async function selectEditorText(field, text) {
  await expect(field).toHaveText(text);
  await field.press("ArrowRight");
  for (const character of text) await field.press("Shift+ArrowLeft");
  await expect
    .poll(() => field.evaluate((el) => el.ownerDocument.getSelection()?.toString()))
    .toBe(text);
}

test("one WYSIWYG editor: toolbar, undo/redo, safe links and discussion save/reload", async ({
  page,
  isMobile,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function format(composer, name) {
    const button = composer.getByRole("button", { name, exact: true });
    if (isMobile) await button.tap();
    else await button.click();
  }
  await user(page);
  await page.goto("/articles/new");
  await page.getByLabel("Заголовок статьи").fill("Общий rich редактор");
  await page
    .getByLabel("Текст статьи", { exact: true })
    .fill("Форматированный текст");
  const writer = page.locator('[data-rich-editor="Текст статьи"]');
  await selectEditorText(
    page.getByLabel("Текст статьи", { exact: true }),
    "Форматированный текст",
  );
  await format(writer, "Полужирный");
  await expect(writer.locator('[contenteditable="true"] strong')).toHaveText(
    "Форматированный текст",
  );
  await format(writer, "Подчёркнутый");
  await expect(writer.locator('[contenteditable="true"] u')).toHaveText(
    "Форматированный текст",
  );
  await expect(writer.locator('[contenteditable="true"] strong')).toContainText(
    "Форматированный текст",
  );
  await format(writer, "Отменить действие");
  await expect(writer.locator('[contenteditable="true"] u')).toHaveCount(0);
  await format(writer, "Повторить действие");
  await expect(writer.locator('[contenteditable="true"] u')).toHaveText(
    "Форматированный текст",
  );
  await format(writer, "Ссылка");
  await writer.getByLabel("Адрес ссылки").fill("javascript:alert(1)");
  await writer.getByRole("button", { name: "Применить ссылку" }).click();
  await expect(writer.getByRole("alert")).toContainText("HTTP/HTTPS");
  await writer.getByLabel("Адрес ссылки").fill("https://example.test/rules");
  await writer.getByRole("button", { name: "Применить ссылку" }).click();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page).toHaveURL(/articles\/[a-f0-9-]+$/);
  await expect(page.locator(".article-prose strong")).toHaveText(
    "Форматированный текст",
  );
  await expect(page.locator(".article-prose u")).toHaveText(
    "Форматированный текст",
  );
  await expect(page.locator(".article-prose a")).toHaveAttribute(
    "href",
    "https://example.test/rules",
  );
  const comment = page.locator('[data-rich-editor="Ваш комментарий"]');
  await comment
    .getByRole("textbox", { name: "Ваш комментарий", exact: true })
    .fill("Мой ответ");
  await selectEditorText(
    comment.getByRole("textbox", { name: "Ваш комментарий", exact: true }),
    "Мой ответ",
  );
  await format(comment, "Курсив");
  await comment.getByRole("button", { name: "Отправить комментарий" }).click();
  await expect(page.locator(".comment-body em")).toHaveText("Мой ответ");
  await page.reload();
  await expect(page.locator(".comment-body em")).toHaveText("Мой ответ");
  expect(errors).toEqual([]);
});
