// #378: what a guest's riding buttons lead to, and the words under them.
import test from "node:test";
import assert from "node:assert/strict";
import { copyBlocks } from "../lib/copy-blocks.ts";
import {
  addBikeHref,
  guestRidingHref,
  ridingHref,
  sectionLinks,
} from "../lib/navigation.ts";
import { uiCopy } from "../lib/ui-copy.ts";

test("a guest's riding links ask for registration, a member's go straight to the scenario", () => {
  assert.equal(ridingHref.intent, "/ride-intents?new=1");
  assert.equal(ridingHref.plan, "/account?tab=rides&action=plan");
  for (const kind of ["intent", "plan"] as const) {
    const guest = new URL(guestRidingHref[kind], "https://colabike.test");
    const member = new URL(ridingHref[kind], "https://colabike.test");
    // The same page and the same scenario, plus the one mark that chooses the form.
    assert.equal(guest.pathname, member.pathname);
    assert.equal(guest.searchParams.get("auth"), "register");
    assert.equal(member.searchParams.has("auth"), false);
    for (const [key, value] of member.searchParams)
      assert.equal(guest.searchParams.get(key), value);
    // Only a path of this site: nothing to follow out of it.
    assert.match(guestRidingHref[kind], /^\/[^/]/);
  }
});

test("the menu offers the guest the registering address and the member the plain one", () => {
  const plan = (user: Parameters<typeof sectionLinks>[1]) =>
    sectionLinks("rides", user).find((link) => link.label === "Запланировать");
  assert.equal(plan(null)?.href, guestRidingHref.plan);
  assert.equal(plan({ username: "rider" })?.href, ridingHref.plan);
  // «Добавить велосипед» is only offered to a member, and keeps the old address.
  const add = (user: Parameters<typeof sectionLinks>[1]) =>
    sectionLinks("bikes", user).find(
      (link) => link.label === "Добавить велосипед",
    );
  assert.equal(add(null), undefined);
  assert.equal(add({ username: "rider" })?.href, addBikeHref);
  assert.equal(addBikeHref, "/account?tab=bikes&action=add");
});

test("«нужна регистрация» is a site text of the administrator's, in a group of its own place", () => {
  assert.ok(uiCopy.includes("нужна регистрация"));
  const holders = copyBlocks.filter((block) =>
    block.keys.includes("нужна регистрация"),
  );
  // One place, not a copy in each group.
  assert.equal(holders.length, 1);
  assert.equal(holders[0].id, "account");
});
