import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  isGeneratedUsername,
  personName,
  reservedUsernames,
  suggestUsername,
  usernameCandidates,
  usernameFrom,
  usernameLabel,
  usernamePattern,
} from "../lib/usernames.ts";
import { allocateUsername } from "../lib/username-allocation.ts";
import { registrationInput } from "../lib/social-validation.ts";

test("usernames are transliterated from Russian and Latin names", () => {
  assert.equal(usernameFrom("Иван Петров"), "ivan-petrov");
  assert.equal(usernameFrom("Юлия Щукина"), "yuliya-shchukina");
  assert.equal(usernameFrom("Алёна Йорк"), "alena-york");
  // Decomposed input keeps "й" as a letter, not "и" plus a mark.
  assert.equal(usernameFrom("Йорк".normalize("NFD")), "york");
  assert.equal(usernameFrom("Хрущёв-Цой"), "khrushchev-tsoy");
  assert.equal(usernameFrom("José Müller"), "jose-muller");
  assert.equal(usernameFrom("  Ян  "), "yan");
  assert.equal(usernameFrom("Ли"), "");
  assert.equal(usernameFrom("李雷"), "");
  const long = usernameFrom("Константин Константинопольский-Задунайский");
  assert(long.length <= 30 && usernamePattern.test(long), long);
  assert(!long.endsWith("-"));
});

test("a suggestion falls back to the address and then to a neutral handle", () => {
  assert.equal(suggestUsername("Мария", "m@example.test"), "mariya");
  assert.equal(suggestUsername("李雷", "li.lei+bikes@example.test"), "li-lei");
  assert.equal(suggestUsername("", ""), "rider");
});

test("candidates stay valid, short enough and never reserved", () => {
  const admin = usernameCandidates("admin");
  assert.equal(admin[0], "admin-2");
  const base = "a".repeat(30);
  const list = usernameCandidates(base);
  assert.equal(list[0], base);
  assert(list.every((c) => usernamePattern.test(c)));
  assert(list.includes("a".repeat(28) + "-2"));
  assert.deepEqual(usernameCandidates("._-").slice(0, 2), ["._-", "rider-2"]);
});

test("allocation takes the first free candidate, ignoring case", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE users(username text NOT NULL); CREATE UNIQUE INDEX users_username_ci ON users(lower(username));",
    );
    assert.equal(await allocateUsername(db, "ivan"), "ivan");
    await db.exec("INSERT INTO users VALUES ('ivan'),('Ivan-2'),('ivan-4');");
    assert.equal(await allocateUsername(db, "ivan"), "ivan-3");
    // Exhaust every readable candidate, including a stem whose truncation
    // lands on a separator. The random fallback keeps the six-digit contract.
    for (const base of ["rider", "a".repeat(22) + "-" + "a".repeat(7)]) {
      const candidates = usernameCandidates(base);
      await db.query("INSERT INTO users SELECT unnest($1::text[])", [
        candidates,
      ]);
      const fallback = await allocateUsername(db, base);
      assert.match(fallback, /^(?:rider|a{22})-[0-9]{6}$/);
      assert(usernamePattern.test(fallback));
      assert(!candidates.includes(fallback));
    }
  } finally {
    await db.close();
  }
});

test("generated handles are never shown on cards", () => {
  const generated = "rider-8f6827b60c56484d9fe02fbe";
  assert(isGeneratedUsername(generated));
  assert(!isGeneratedUsername("rider-8f68"));
  assert.equal(usernameLabel({ username: generated }), "");
  assert.equal(usernameLabel({ username: "olga" }), "@olga");
  assert.equal(personName({ name: "Ольга", username: generated }), "Ольга");
  assert.equal(personName({ name: "", username: "olga" }), "@olga");
});

test("registration accepts an optional username with the profile rules", () => {
  const base = {
    email: "new@example.test",
    password: "long-enough-secret",
    name: "Новый",
  };
  assert.equal(registrationInput.parse(base).username, undefined);
  assert.equal(
    registrationInput.parse({ ...base, username: "" }).username,
    undefined,
  );
  assert.equal(
    registrationInput.parse({ ...base, username: " Olga.K " }).username,
    "olga.k",
  );
  for (const username of ["admin", "ab", "имя", "a".repeat(31)])
    assert.throws(() => registrationInput.parse({ ...base, username }));
});

test("the reserved list matches the database constraint", async () => {
  const sql = await readFile(
    new URL("../db/009_social_core.sql", import.meta.url),
    "utf8",
  );
  const list = sql.match(/username NOT IN \(([^)]*)\)/)[1];
  assert.deepEqual(
    new Set(list.match(/'([^']+)'/g).map((v) => v.slice(1, -1))),
    reservedUsernames,
  );
});
