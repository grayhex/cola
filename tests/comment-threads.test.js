import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as comments from "../lib/comments.ts";
import { entitySocial } from "../lib/entity-social.ts";
import { componentSocial } from "../lib/component-social.ts";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.ts";

const bikeSocial = {
  create: comments.createComment,
  change: comments.changeComment,
  page: comments.commentPage,
  replies: comments.replyPage,
};
test("thread migration and shared engine preserve immediate parents, tombstones, focus, bounded children and privacy for every entity", async () => {
  const db = new PGlite();
  try {
    for (const file of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && f < "048")
      .sort())
      await db.exec(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
    // The notice code of today needs the group column of #341 (migration 055),
    // which has nothing to do with the thread migration under test.
    await db.exec("ALTER TABLE notifications ADD COLUMN group_key text");
    // Notices are not made between people who blocked each other (#354).
    await db.exec(
      await readFile(
        new URL("../db/061_user_blocks.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query("INSERT INTO site_settings(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultSettings),
    ]);
    await db.query("INSERT INTO site_catalog(id,value) VALUES(1,$1)", [
      JSON.stringify(defaultCatalog),
    ]);
    const users = [];
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,name,username,password_hash,email_verified_at) VALUES($1,$2,$3,$3,'hash',now())",
        [id, id + "@example.test", "thread-user-" + i],
      );
      users.push({ id, role: "user" });
    }
    const [owner, a, b, c, d] = users;
    const bike = randomUUID();
    await db.query(
      "INSERT INTO bikes(id,owner_id,share_id,name,year,category,is_public) VALUES($1,$2,$1,'Thread bike',2026,'road',true)",
      [bike, owner.id],
    );
    const ride = randomUUID();
    await db.query(
      "INSERT INTO rides(id,share_id,owner_id,bike_id,title,distance_m,point_count,public_point_count,public_geometry,privacy_radius_m,source_hash,is_public) VALUES($1,$1,$2,$3,'Thread ride',5000,0,0,'[]',500,'thread-fixture',true)",
      [ride, owner.id, bike],
    );
    const journal = randomUUID(),
      article = randomUUID();
    for (const [id, kind] of [
      [journal, "story"],
      [article, "article"],
    ])
      await db.query(
        "INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public) VALUES($1,$1,$2,$3,$4,'Thread entry','Text','published',true)",
        [id, owner.id, kind === "article" ? null : bike, kind],
      );
    const installation = randomUUID();
    await db.query(
      "INSERT INTO components(id,bike_id,section,category,name) VALUES($1,$2,'build','Седло','Brooks Thread saddle')",
      [installation, bike],
    );
    const model = (
      await db.query("SELECT model_id FROM components WHERE id=$1", [
        installation,
      ])
    ).rows[0].model_id;
    const targets = [
      [bikeSocial, bike, "bike_comments", "bike_id", "reply"],
      [entitySocial("ride"), ride, "ride_comments", "ride_id", "ride_reply"],
      [
        entitySocial("journal"),
        journal,
        "journal_comments",
        "entry_id",
        "journal_reply",
      ],
      [
        entitySocial("article"),
        article,
        "journal_comments",
        "entry_id",
        "journal_reply",
      ],
      [
        componentSocial,
        model,
        "component_comments",
        "model_id",
        "component_reply",
      ],
    ];
    const before = [];
    for (const [engine, id] of targets) {
      const root = await db.transaction((q) =>
        engine.create(q, id, a, { body: "A private body after deletion" }),
      );
      const reply = await db.transaction((q) =>
        engine.create(q, id, b, {
          body: "B private body after blocking",
          parentId: root.id,
        }),
      );
      before.push([root.id, reply.id]);
    }
    await db.exec(
      await readFile(
        new URL("../db/048_comment_threads.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const [index, [engine, id, table, key, event]] of targets.entries()) {
      const [root, reply] = before[index];
      const add = (actor, body, parentId) =>
        db.transaction((q) => engine.create(q, id, actor, { body, parentId }));
      const third = await add(c, "C readable", reply),
        fourth = await add(d, "D readable", third.id);
      const raw = (
        await db.query(`SELECT parent_id FROM ${table} WHERE id=$1`, [
          fourth.id,
        ])
      ).rows[0];
      assert.equal(raw.parent_id, third.id);
      const notice = (
        await db.query(
          "SELECT recipient_id,actor_id FROM notifications WHERE type=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 1",
          [event, d.id],
        )
      ).rows[0];
      assert.equal(notice.recipient_id, c.id);
      assert.equal(
        (await engine.replies(db, id, third.id, null)).comments[0].id,
        fourth.id,
      );
      let focused = await engine.page(db, id, null, 1, fourth.id);
      assert.deepEqual(
        focused.focusPath.map((n) => n.id),
        [root, reply, third.id, fourth.id],
      );
      assert.equal(focused.comments.length, 1);
      assert.equal(focused.hasMore, false);
      await assert.rejects(
        db.query(`UPDATE ${table} SET parent_id=$1 WHERE id=$2`, [
          root,
          fourth.id,
        ]),
        (e) => e.code === "23514",
      );
      await assert.rejects(
        db.query(`UPDATE ${table} SET ${key}=$1 WHERE id=$2`, [
          randomUUID(),
          fourth.id,
        ]),
        (e) => e.code === "23514",
      );
      await assert.rejects(
        db.query(
          `INSERT INTO ${table}(id,${key},author_id,parent_id,body) VALUES($1,$2,$3,$4,'Wrong entity')`,
          [randomUUID(), randomUUID(), a.id, root],
        ),
        (e) => e.code === "23503",
      );
      await assert.rejects(
        db.transaction((q) =>
          engine.create(q, id, a, {
            body: "Foreign parent",
            parentId: before[(index + 1) % targets.length][0],
          }),
        ),
        (e) => e.status === 404,
      );
      await db.transaction((q) => engine.change(q, root, a));
      await db.query("UPDATE users SET blocked=true WHERE id=$1", [b.id]);
      focused = await engine.page(db, id, null, 1, fourth.id);
      for (const node of focused.focusPath.slice(0, 2)) {
        assert.equal(node.body, null);
        assert.equal(node.bodyDoc, null);
        assert.equal(node.author, null);
        assert.equal(node.canEdit, false);
        assert.equal(node.canDelete, false);
      }
      assert.equal((await engine.page(db, id, null)).comments[0].id, root);
      assert.equal(
        (await engine.replies(db, id, root, null)).comments[0].id,
        reply,
      );
      await assert.rejects(add(d, "Deleted", root), (e) => e.status === 404);
      await assert.rejects(add(d, "Blocked", reply), (e) => e.status === 404);
      await db.query("UPDATE users SET blocked=false WHERE id=$1", [b.id]);
      await db.transaction((q) => engine.change(q, reply, b));
      assert.equal(
        (await engine.replies(db, id, root, null)).comments[0].unavailable,
        true,
      );
      // A wide branch and a deep chain don't inflate the normal root payload.
      for (let i = 0; i < 25; i++) await add(a, "Sibling " + i, third.id);
      let last = fourth.id;
      for (let i = 0; i < 8; i++) last = (await add(a, "Deep " + i, last)).id;
      let calls = 0;
      const q = {
        query: (...args) => {
          calls++;
          return db.query(...args);
        },
      };
      const page = await engine.page(q, id, null);
      assert.equal(page.comments[0].replies.length, 1);
      assert.equal(page.focusPath.length, 0);
      if (index === 0) assert.equal(calls, 3);
      const first = await engine.replies(db, id, third.id, null),
        second = await engine.replies(db, id, third.id, null, 2);
      assert.equal(first.comments.length, 20);
      assert(first.hasMore);
      assert.equal(second.comments.length, 6);
      assert(!second.hasMore);
      assert.equal(
        new Set([...first.comments, ...second.comments].map((n) => n.id)).size,
        26,
      );
      focused = await engine.page(db, id, null, 1, last);
      assert.equal(focused.focusPath.length, 12);
      assert.equal(focused.focusPath.at(-1).id, last);
      assert(!JSON.stringify(focused).includes("private body"));
      assert(!JSON.stringify(focused).includes("@example.test"));
    }
    await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
    for (const [engine, id] of targets.filter((_, i) => i !== 3 && i !== 4)) {
      await assert.rejects(engine.page(db, id, null), (e) => e.status === 404);
    }
    await db.query("UPDATE journal_entries SET is_public=false WHERE id=$1", [
      article,
    ]);
    await assert.rejects(
      targets[3][0].page(db, article, null),
      (e) => e.status === 404,
    );
  } finally {
    await db.close();
  }
});
