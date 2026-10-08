import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPhotoFile,
  oversizedPhotoMessage,
  photoFileBytes,
  photoLimitText,
  photoTooLargeMessage,
  photosPerBike,
  sendBikePhoto,
  tooManyPhotos,
} from "../lib/photo-upload.ts";
import { limits } from "../lib/limits.ts";

// #366: one rule for the bike page, the wizard and the server. A file is
// refused when it is strictly larger than the limit; every refusal says which
// rule, so that size is never mixed up with format, count or pixels.
const file = (size: number, type = "image/png", name = "photo.png") => ({
  name,
  size,
  type,
});

test("the limit is 10 × 1024 × 1024 bytes everywhere", () => {
  assert.equal(photoFileBytes, 10 * 1024 * 1024);
  assert.equal(limits.fileBytes, photoFileBytes);
  assert.equal(limits.photosPerBike, photosPerBike);
  assert.equal(photoLimitText, "10 МБ");
});

test("a file is refused only when strictly larger than the limit", () => {
  assert.equal(checkPhotoFile(file(photoFileBytes - 1)), null);
  assert.equal(checkPhotoFile(file(photoFileBytes)), null);
  const refused = checkPhotoFile(
    file(photoFileBytes + 1, "image/png", "a.png"),
  );
  assert.equal(refused?.kind, "size");
  assert.match(
    refused?.message ?? "",
    /^Фото «a\.png» слишком большое: 10,01 МБ\. Максимальный размер — 10 МБ\./,
  );
});

test("size, format and count are different problems with their own words", () => {
  const format = checkPhotoFile(file(10, "image/svg+xml", "logo.svg"));
  assert.equal(format?.kind, "format");
  assert.match(format?.message ?? "", /«logo\.svg».*JPEG, PNG и WebP/);
  assert.doesNotMatch(format?.message ?? "", /МБ/);
  // A wrong type that is also huge is a format problem: the file never fits.
  assert.equal(
    checkPhotoFile(file(photoFileBytes * 2, "application/pdf"))?.kind,
    "format",
  );
  const count = tooManyPhotos("c.png");
  assert.equal(count.kind, "count");
  assert.match(count.message, /до 12 фото/);
  assert.doesNotMatch(count.message, /МБ/);
});

test("the size in the message is rounded up, never down to the limit", () => {
  assert.match(oversizedPhotoMessage("x.png", photoFileBytes + 1), /10,01 МБ/);
  assert.match(oversizedPhotoMessage("x.png", 25 * 1024 * 1024), /25 МБ/);
  assert.match(photoTooLargeMessage(), /Максимальный размер — 10 МБ/);
});

async function answering(
  response: Response | Error,
  run: (calls: RequestInit[]) => Promise<void>,
) {
  const real = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls.push(init ?? {});
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}
const picture = (size = 1000, name = "p.png") =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

test("a refused file is never sent", async () => {
  await answering(new Response(null, { status: 201 }), async (calls) => {
    const big = await sendBikePhoto(
      "b1",
      picture(photoFileBytes + 1, "huge.png"),
    );
    assert.equal(big.ok, false);
    assert.equal(big.ok === false && big.retryable, false);
    assert.equal(calls.length, 0);
  });
});

test("the answer of the server or of a proxy in front of it is understood", async () => {
  const cases: [string, Response, boolean, RegExp][] = [
    [
      "413 in JSON from the site",
      Response.json({ error: "Фото слишком большое." }, { status: 413 }),
      false,
      /Сервер не принял фото «p\.png».*больше допустимого размера запроса/,
    ],
    [
      "413 in HTML from a proxy",
      new Response("<html><h1>413 Request Entity Too Large</h1></html>", {
        status: 413,
        headers: { "Content-Type": "text/html" },
      }),
      false,
      /Сервер не принял фото «p\.png»/,
    ],
    [
      "413 without a body",
      new Response(null, { status: 413 }),
      false,
      /«p\.png»/,
    ],
    [
      "400 in JSON keeps the words of the server",
      Response.json(
        { error: "Не удалось прочитать изображение" },
        { status: 400 },
      ),
      false,
      /«p\.png» не загружено: Не удалось прочитать изображение/,
    ],
    [
      "429 can be retried",
      new Response("slow down", { status: 429 }),
      true,
      /слишком много загрузок/,
    ],
    [
      "502 in HTML can be retried and says its status",
      new Response("<html>bad gateway</html>", { status: 502 }),
      true,
      /сервер ответил с ошибкой \(502\)/,
    ],
  ];
  for (const [name, response, retryable, words] of cases)
    await answering(response, async (calls) => {
      const sent = await sendBikePhoto("b1", picture());
      assert.equal(sent.ok, false, name);
      if (sent.ok) return;
      assert.equal(sent.retryable, retryable, name);
      assert.match(sent.problem.message, words, name);
      assert.doesNotMatch(sent.problem.message, /<html|<h1/, name);
      assert.equal(calls.length, 1, name);
    });
});

test("no connection is a retryable failure with words; success is ok", async () => {
  await answering(new TypeError("Failed to fetch"), async () => {
    const sent = await sendBikePhoto("b1", picture());
    assert.equal(sent.ok, false);
    assert.ok(!sent.ok && sent.retryable);
    assert.ok(!sent.ok && /нет связи с сервером/.test(sent.problem.message));
  });
  await answering(
    Response.json({ id: "x" }, { status: 201 }),
    async (calls) => {
      assert.deepEqual(await sendBikePhoto("b1", picture()), {
        ok: true,
        id: "x",
      });
      assert.equal(
        (calls[0].headers as Record<string, string>)["Content-Type"],
        "image/png",
      );
    },
  );
  // The photo is in whatever the answer says; only its id may be unknown.
  await answering(new Response("created", { status: 201 }), async () => {
    assert.deepEqual(await sendBikePhoto("b1", picture()), {
      ok: true,
      id: null,
    });
  });
});
