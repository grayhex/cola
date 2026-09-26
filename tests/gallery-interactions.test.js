import test from "node:test";
import assert from "node:assert/strict";
import { createBikeReaction } from "../lib/bike-reactions.js";
import {
  readShowcaseQuery,
  writeShowcaseQuery,
} from "../lib/showcase-query.js";
import { accentText } from "../lib/appearance.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("reactions serialize requests and retain a newer unlike intent", async () => {
  const requests = [];
  const queue = createBikeReaction({ liked: false, likes: 4 }, (liked) => {
    const d = deferred();
    requests.push({ liked, ...d });
    return d.promise;
  });
  queue.toggle();
  assert.deepEqual(queue.snapshot(), {
    liked: true,
    likes: 5,
    pending: true,
    error: false,
  });
  queue.toggle();
  assert.equal(queue.snapshot().likes, 4);
  assert.equal(requests.length, 1);
  requests[0].resolve({ liked: true, likes: 8 });
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].liked, false);
  assert.equal(queue.snapshot().liked, false);
  assert.equal(queue.snapshot().likes, 7);
  requests[1].resolve({ liked: false, likes: 7 });
  await tick();
  assert.deepEqual(queue.snapshot(), {
    liked: false,
    likes: 7,
    pending: false,
    error: false,
  });
});
test("failure rolls back only its bike, with consistent state and a retry", async () => {
  const d = deferred();
  let calls = 0;
  const one = createBikeReaction({ liked: false, likes: 3 }, () =>
    ++calls === 1 ? d.promise : Promise.resolve({ liked: true, likes: 4 }),
  );
  const two = createBikeReaction({ liked: false, likes: 6 }, () =>
    Promise.resolve({ liked: true, likes: 7 }),
  );
  one.toggle();
  two.toggle();
  await tick();
  assert.equal(two.snapshot().pending, false);
  d.reject(new Error("offline"));
  await tick();
  assert.deepEqual(one.snapshot(), {
    liked: false,
    likes: 3,
    pending: false,
    error: true,
  });
  one.toggle();
  await tick();
  assert.equal(one.snapshot().error, false);
  assert.equal(one.snapshot().likes, 4);
});
test("rapid triple press coalesces; unknown count stays absent until confirmed", async () => {
  const d = deferred();
  let calls = 0;
  const q = createBikeReaction({}, () => {
    calls++;
    return d.promise;
  });
  q.toggle();
  q.toggle();
  q.toggle();
  assert.equal(q.snapshot().likes, undefined);
  d.resolve({ liked: true, likes: 1 });
  await tick();
  assert.equal(calls, 1);
  assert.equal(q.snapshot().liked, true);
});
test("obsolete failed request cannot revert newer intent", async () => {
  const d = deferred();
  const q = createBikeReaction({ liked: false, likes: 2 }, () => d.promise);
  q.toggle();
  q.toggle();
  d.reject(new Error("offline"));
  await tick();
  assert.equal(q.snapshot().liked, false);
  assert.equal(q.snapshot().likes, 2);
  assert.equal(q.snapshot().pending, false);
  assert.equal(q.snapshot().error, false);
});
test("showcase URL retains filters, sorting, pagination and unrelated parameters", () => {
  const search = writeShowcaseQuery("sort=popular&campaign=club", {
    filters: ["gravel", "mtb"],
    page: 3,
    query: "Cube",
  });
  assert.deepEqual(
    readShowcaseQuery(new URLSearchParams(search), { gravel: 1, mtb: 1 }),
    { sort: "popular", filters: ["gravel", "mtb"], page: 3, query: "Cube" },
  );
  assert.equal(new URLSearchParams(search).get("campaign"), "club");
  assert.deepEqual(
    readShowcaseQuery(
      new URLSearchParams("sort=evil&page=-1&category=mtb,mtb,bad"),
      { mtb: 1 },
    ),
    { sort: "new", page: 1, filters: ["mtb"], query: "" },
  );
});
test("accent chooses contrasting foreground", () => {
  assert.equal(accentText("#244CBA"), "#FFFFFF");
  assert.equal(accentText("#eeee00"), "#000000");
});
