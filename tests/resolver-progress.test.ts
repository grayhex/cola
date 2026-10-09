import test from "node:test";
import assert from "node:assert/strict";
import {
  currentStage,
  outcomeOf,
  outcomeText,
  recognizedCount,
  ribbonOf,
  ribbonText,
  significantEvents,
  traceLabels,
} from "../lib/resolver-progress.ts";
import { resolverEvents, safeTrace } from "../lib/resolver-stream.ts";
import type { TraceEvent } from "../lib/resolver-stream.ts";

// #374: the wizard's status of a search says only what the stream said.
const event = (name: string, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  type: "event",
  event: name,
  elapsedMs: 0,
  ...extra,
});

test("every event the stream may carry has a phrase", () => {
  for (const name of resolverEvents)
    assert.ok(traceLabels[name], `${name} has no label`);
});

test("before the first event the phrase is the calm start; a site is named only by the event that names it", () => {
  assert.deepEqual(currentStage([]), { text: "Начинаем поиск" });
  const events = [
    event("resolve_started"),
    event("document_fetch_started", { host: "shop.example" }),
  ];
  assert.deepEqual(currentStage(events), {
    text: "Загружаем страницу",
    host: "shop.example",
  });
  // The next event does not name a site: no site is carried over to it.
  const later = [...events, event("normalization_started")];
  assert.deepEqual(currentStage(later), { text: "Определяем компоненты" });
});

test("a source that is new to the page appears with no change to the page", () => {
  // The names come from the events; none is known beforehand.
  for (const host of ["never-seen-before.example", "brand-new-store.example"])
    assert.equal(
      currentStage([event("source_connected", { host })]).host,
      host,
    );
});

test("a failed source is not «found»: the phrase says the search moves on, with the reason", () => {
  const stage = currentStage([
    event("document_fetch_started", { host: "a.example" }),
    event("source_failed", { host: "a.example", reason: "timeout" }),
  ]);
  assert.equal(stage.text, "Источник не дал комплектацию, ищем дальше");
  assert.equal(stage.host, "a.example");
  assert.equal(stage.note, "не ответил вовремя");
  // A reason the page has no words for is shown as it came, not hidden.
  assert.equal(
    currentStage([event("source_failed", { reason: "js_shell" })]).note,
    "js_shell",
  );
  assert.equal(currentStage([event("source_failed")]).note, undefined);
});

test("the number of variants rides on the phrase that found them", () => {
  assert.deepEqual(currentStage([event("candidate_found", { count: 5 })]), {
    text: "Найдены варианты",
    note: "5",
  });
});

test("the count of components is what the last normalized page said, never a sum or a mix", () => {
  assert.equal(recognizedCount([]), null);
  assert.equal(recognizedCount([event("normalization_started")]), null);
  assert.deepEqual(
    recognizedCount([
      event("components_recognized", { count: 12, total: 15 }),
      event("document_fetch_started", { host: "b.example" }),
      event("components_recognized", { count: 3, total: 4 }),
    ]),
    { count: 3, total: 4 },
  );
  assert.deepEqual(
    recognizedCount([event("components_recognized", { count: 0 })]),
    { count: 0, total: undefined },
  );
});

test("the ribbon drops quiet events, merges repeats in a row and keeps a short tail with stable keys", () => {
  const events = [
    event("resolve_started"),
    event("cache_checked"),
    event("source_started"),
    event("document_fetched", { host: "a.example" }),
    event("document_fetched", { host: "b.example" }),
    event("document_fetched", { host: "c.example" }),
    event("fields_extracted", { count: 0 }),
    event("fields_extracted", { count: 7, strategy: "json-ld" }),
    event("components_recognized", { count: 7, total: 9 }),
    event("completed"),
  ];
  assert.equal(significantEvents(events).length, 6);
  const items = ribbonOf(events);
  assert.deepEqual(
    items.map((item) => [item.text, item.repeats]),
    [
      ["Начинаем поиск", 1],
      ["Страница загружена", 3],
      ["Извлечены характеристики", 1],
      ["Компоненты распознаны", 1],
    ],
  );
  assert.equal(
    ribbonText(items),
    "Начинаем поиск · Страница загружена ×3 · Извлечены характеристики · Компоненты распознаны",
  );
  // The tail is bounded, and the first event of a group keeps its key as the
  // events slide past it.
  const long = Array.from({ length: 40 }, (_, i) =>
    event(i % 2 ? "candidate_found" : "discovery_started", { count: i }),
  );
  assert.equal(ribbonOf(long).length, 6);
  assert.equal(ribbonOf(long, 4).length, 4);
  const before = ribbonOf(long.slice(0, 39)).map((item) => item.key);
  const after = ribbonOf(long).map((item) => item.key);
  assert.deepEqual(after.slice(0, -1), before.slice(1));
  assert.deepEqual(ribbonOf([]), []);
});

test("events that arrive through the stream's own validator are what the status reads", () => {
  // The browser reads lines with safeTrace; a line with a site outside the
  // allowed form carries no site, so none can be shown.
  const good = safeTrace({
    type: "event",
    event: "source_connected",
    elapsedMs: 120,
    host: "shop.example",
  });
  const bad = safeTrace({
    type: "event",
    event: "source_connected",
    elapsedMs: 120,
    host: "<img src=x onerror=alert(1)>",
  });
  assert.ok(good && bad);
  assert.equal(currentStage([good]).host, "shop.example");
  assert.equal(currentStage([bad]).host, undefined);
  assert.equal(safeTrace({ type: "event", event: "made_up" }), null);
});

test("how a search ended: every status of the result has its words, a part is a part", () => {
  assert.equal(
    outcomeOf({ status: "resolved", quality: { level: "full" } }),
    "resolved",
  );
  assert.equal(outcomeOf({ status: "resolved" }), "resolved");
  assert.equal(
    outcomeOf({ status: "resolved", quality: { level: "partial" } }),
    "partial",
  );
  for (const status of [
    "ambiguous",
    "not_found",
    "unsupported_brand",
    "upstream_unavailable",
    "parse_error",
  ])
    assert.equal(outcomeOf({ status }), status);
  assert.equal(outcomeOf({ status: "something_new" }), "not_found");
  for (const text of Object.values(outcomeText)) assert.ok(text.length > 5);
  // No outcome words claim completeness for a search that found nothing.
  for (const key of [
    "not_found",
    "upstream_unavailable",
    "parse_error",
    "cancelled",
    "failed",
  ] as const)
    assert.doesNotMatch(outcomeText[key], /готова|найдена комплектация/i);
});
