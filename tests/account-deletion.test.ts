import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  adminDeletionMessage,
  confirmedPassword,
  deletionMethod,
  removeAccount,
} from "../lib/account-data.ts";
import { hashPassword } from "../lib/password.ts";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { insertRow } from "./support/rows.ts";

// How an account confirms its own deletion (#354), and the deletion that every
// way of confirming ends in: the password, or the provider for an account that
// has none; an administrator and a blocked person are never deleted this way.

const db = await testDatabase();
after(() => db.close());

const withPassword = async (overrides = {}) =>
  userRow(db, {
    password_hash: await hashPassword("a-long-enough-password"),
    ...overrides,
  });
const identity = (userId: string) =>
  insertRow(db, "user_identities", {
    user_id: userId,
    provider: "yandex",
    subject: "ya-" + userId,
  });

test("a password account confirms with its password", async () => {
  const user = await withPassword();
  assert.deepEqual(await deletionMethod(db, user.id), {
    admin: false,
    method: "password",
  });
  assert.equal(
    await confirmedPassword(db, user.id, "a-long-enough-password"),
    true,
  );
  assert.equal(
    await confirmedPassword(db, user.id, "another-password-1"),
    false,
  );
});

test("an account made through Yandex has no password and signs in again instead", async () => {
  const user = await userRow(db, { password_hash: null });
  await identity(user.id);
  assert.deepEqual(await deletionMethod(db, user.id), {
    admin: false,
    method: "yandex",
  });
  assert.equal(
    await confirmedPassword(db, user.id, "anything-at-all-1"),
    false,
    "no password matches a missing one",
  );
});

test("an account with neither way has none, and an administrator is told so", async () => {
  const bare = await userRow(db, { password_hash: null });
  assert.deepEqual(await deletionMethod(db, bare.id), {
    admin: false,
    method: null,
  });
  const admin = await withPassword({ role: "admin" });
  assert.deepEqual(await deletionMethod(db, admin.id), {
    admin: true,
    method: "password",
  });
  const refused = await removeAccount(db, admin.id);
  assert.equal(refused.status, 409);
  assert.equal(refused.error, adminDeletionMessage);
  assert.equal(
    (await db.query("SELECT 1 FROM users WHERE id=$1", [admin.id])).rows.length,
    1,
    "an administrator keeps the account",
  );
});

test("a blocked person is not here", async () => {
  const blocked = await withPassword({ blocked: true });
  assert.equal(await deletionMethod(db, blocked.id), null);
  const gone = await removeAccount(db, blocked.id);
  assert.equal(gone.status, 404);
});

test("the deletion takes the account and what hangs on it", async () => {
  const user = await withPassword();
  await identity(user.id);
  const result = await removeAccount(db, user.id);
  assert.equal(result.ok, true);
  assert.deepEqual(result.files, { filenames: [], media: [] });
  for (const table of ["users", "user_identities"])
    assert.equal(
      (
        await db.query(
          `SELECT 1 FROM ${table} WHERE ${table === "users" ? "id" : "user_id"}=$1`,
          [user.id],
        )
      ).rows.length,
      0,
      table,
    );
  assert.equal(await deletionMethod(db, user.id), null);
});
