import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./support/database.ts";
import { userRow, viewer } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { clubRow, clubPostRow } from "./support/clubs.ts";
import {
  clubPostDetail,
  clubPostList,
  createClubPost,
  editClubPost,
  deleteClubPost,
  moderateClubPost,
  postByRequest,
} from "../lib/club-posts.ts";
import { changeMembership } from "../lib/club-membership.ts";
import { clubPostSocial } from "../lib/club-post-social.ts";
import { setClubArchived, clubDetail } from "../lib/clubs.ts";
import { notificationPage } from "../lib/notifications.ts";
import { createReport, moderateReport, reportPage } from "../lib/reports.ts";
import { exportAccount } from "../lib/account-data.ts";
import { CommunityError } from "../lib/community-validation.ts";
const db = await testDatabase();
after(() => db.close());
async function setup() {
  const owner = await userRow(db, { email_verified_at: new Date() }),
    member = await userRow(db, { email_verified_at: new Date() });
  await bikeRow(db, owner.id, { is_public: false });
  const club = await db.transaction((q) => clubRow(q, owner.id));
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "join" }),
  );
  return { owner, member, club };
}
const denied = (e: unknown) =>
  e instanceof CommunityError && [403, 404, 409].includes(e.status);
test("public feed has no fake bike; drafts, cross-club IDs and inactive roles never grant publication rights", async () => {
  const { owner, member, club } = await setup(),
    stranger = await userRow(db, { email_verified_at: new Date() }),
    p = await db.transaction((q) =>
      clubPostRow(q, club.id, member.id, {
        status: "draft",
        body: "Приватный черновик",
      }),
    );
  assert.equal((await clubPostList(db, club.id, null)).posts.length, 0);
  for (const who of [null, owner.id, stranger.id])
    await assert.rejects(clubPostDetail(db, club.id, p.id, who), denied);
  await assert.rejects(
    clubPostDetail(db, randomUUID(), p.id, member.id),
    denied,
  );
  await assert.rejects(
    db.transaction((q) => clubPostRow(q, club.id, stranger.id)),
    denied,
  );
  const published = await db.transaction((q) =>
    editClubPost(q, club.id, p.id, member.id, {
      version: p.version,
      title: "",
      body: p.body,
      status: "published",
    }),
  );
  assert.equal((await clubPostDetail(db, club.id, p.id)).body, p.body);
  assert.equal((await clubPostList(db, club.id, null)).posts.length, 1);
  assert.equal(published.author?.id, member.id);
  await assert.rejects(
    db.transaction((q) =>
      editClubPost(q, club.id, p.id, owner.id, {
        version: published.version,
        title: "Переписанный текст",
        body: "Плохая модерация",
        status: "published",
      }),
    ),
    denied,
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM bikes WHERE owner_id=$1",
        [member.id],
      )
    ).rows[0].n,
    0,
  );
});
test("create acknowledgement recovery is scoped to author and payload; stale edits cannot overwrite", async () => {
  const { member, owner, club } = await setup(),
    input = {
      title: "",
      body: "Один пост",
      status: "draft" as const,
      requestId: randomUUID(),
    },
    a = await db.transaction((q) =>
      createClubPost(q, club.id, member.id, input),
    );
  assert.equal(
    (await db.transaction((q) => createClubPost(q, club.id, member.id, input)))
      .id,
    a.id,
  );
  assert.equal(
    (await postByRequest(db, club.id, member.id, input.requestId))?.id,
    a.id,
  );
  assert.equal(
    await postByRequest(db, club.id, owner.id, input.requestId),
    null,
  );
  await assert.rejects(
    db.transaction((q) =>
      createClubPost(q, club.id, member.id, { ...input, body: "Новое" }),
    ),
    denied,
  );
  await db.transaction((q) =>
    editClubPost(q, club.id, a.id, member.id, {
      version: a.version,
      title: "",
      body: "Новый",
      status: "draft",
    }),
  );
  await assert.rejects(
    db.transaction((q) =>
      editClubPost(q, club.id, a.id, member.id, {
        version: a.version,
        title: "",
        body: "Затёрто",
        status: "draft",
      }),
    ),
    denied,
  );
});
test("pin/hide use club roles; moderator cannot inspect drafts or rewrite authors", async () => {
  const { owner, member, club } = await setup(),
    a = await db.transaction((q) => clubPostRow(q, club.id, member.id)),
    b = await db.transaction((q) => clubPostRow(q, club.id, member.id));
  await assert.rejects(
    db.transaction((q) =>
      moderateClubPost(q, club.id, a.id, member.id, {
        version: a.version,
        action: "pin",
      }),
    ),
    denied,
  );
  await db.transaction((q) =>
    moderateClubPost(q, club.id, a.id, owner.id, {
      version: a.version,
      action: "pin",
    }),
  );
  await db.transaction((q) =>
    moderateClubPost(q, club.id, b.id, owner.id, {
      version: b.version,
      action: "pin",
    }),
  );
  const feed = await clubPostList(db, club.id, null);
  assert.equal(feed.pinned?.id, b.id);
  assert.equal(feed.posts.length, 1);
  assert.equal(feed.posts[0].id, a.id);
  await db.transaction((q) =>
    moderateClubPost(q, club.id, b.id, owner.id, {
      version: feed.pinned!.version,
      action: "hide",
    }),
  );
  await assert.rejects(clubPostDetail(db, club.id, b.id), denied);
  assert.equal((await clubPostList(db, club.id, null)).pinned, null);
});
test("shared recursive discussions, likes and notifications enforce current membership and visibility", async () => {
  const { owner, member, club } = await setup(),
    p = await db.transaction((q) => clubPostRow(q, club.id, owner.id));
  const c = await db.transaction((q) =>
    clubPostSocial.create(q, p.id, viewer({ id: member.id }), {
      body: "Первый",
    }),
  );
  const reply = await db.transaction((q) =>
    clubPostSocial.create(q, p.id, viewer({ id: owner.id }), {
      body: "Ответ",
      parentId: c.id,
    }),
  );
  await db.transaction((q) =>
    clubPostSocial.create(q, p.id, viewer({ id: member.id }), {
      body: "Второй уровень",
      parentId: reply.id,
    }),
  );
  assert.equal(
    (await clubPostSocial.page(db, p.id, null)).comments[0].replies[0].id,
    reply.id,
  );
  assert.equal(
    (await clubPostSocial.replies(db, p.id, reply.id, null)).comments[0].body,
    "Второй уровень",
  );
  await db.transaction((q) => clubPostSocial.like(q, p.id, member.id, true));
  await db.transaction((q) => clubPostSocial.like(q, p.id, member.id, true));
  assert.equal((await clubPostDetail(db, club.id, p.id)).likes, 1);
  const inbox = await notificationPage(db, owner.id);
  assert.ok(
    inbox.notifications.some(
      (n) => n.type === "club_post_comment" && n.target.href.includes(p.id),
    ),
  );
  assert.ok(inbox.notifications.some((n) => n.type === "club_post_like"));
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "leave" }),
  );
  await assert.rejects(
    db.transaction((q) =>
      clubPostSocial.create(q, p.id, viewer({ id: member.id }), {
        body: "После выхода",
      }),
    ),
    denied,
  );
  await assert.rejects(
    db.transaction((q) =>
      clubPostSocial.change(q, c.id, viewer({ id: member.id }), "Изменено"),
    ),
    denied,
  );
  await db.transaction((q) =>
    clubPostSocial.change(q, c.id, viewer({ id: member.id }), null),
  );
  await db.transaction((q) => clubPostSocial.like(q, p.id, member.id, false));
  const tombstone = (await clubPostSocial.page(db, p.id, null)).comments[0];
  assert.equal(tombstone.body, null);
  assert.equal(tombstone.author, null);
  assert.equal(tombstone.replies[0].id, reply.id);
  await db.transaction((q) =>
    moderateClubPost(q, club.id, p.id, owner.id, {
      version: p.version,
      action: "hide",
    }),
  );
  assert.equal((await notificationPage(db, owner.id)).notifications.length, 0);
});
test("club administrators delete comments only within their club, and never edit another author", async () => {
  const { owner, member, club } = await setup(),
    p = await db.transaction((q) => clubPostRow(q, club.id, member.id)),
    c = await db.transaction((q) =>
      clubPostSocial.create(q, p.id, viewer({ id: member.id }), {
        body: "Комментарий",
      }),
    );
  await assert.rejects(
    db.transaction((q) =>
      clubPostSocial.change(q, c.id, viewer({ id: owner.id }), "Подмена"),
    ),
    denied,
  );
  await db.transaction((q) =>
    clubPostSocial.change(q, c.id, viewer({ id: owner.id }), null),
  );
  const other = await setup(),
    op = await db.transaction((q) =>
      clubPostRow(q, other.club.id, other.member.id),
    ),
    oc = await db.transaction((q) =>
      clubPostSocial.create(q, op.id, viewer({ id: other.member.id }), {
        body: "Другой",
      }),
    );
  await assert.rejects(
    db.transaction((q) =>
      clubPostSocial.change(
        q,
        oc.id,
        viewer({ id: owner.id, role: "admin" }),
        null,
      ),
    ),
    denied,
  );
});
test("archive stops new work while preserving published history; own withdrawal still works", async () => {
  const { owner, member, club } = await setup(),
    p = await db.transaction((q) => clubPostRow(q, club.id, member.id));
  const latest = await clubDetail(db, club.id, owner.id);
  await db.transaction((q) =>
    setClubArchived(q, club.id, owner.id, {
      archived: true,
      version: latest.version,
    }),
  );
  assert.equal((await clubPostDetail(db, club.id, p.id)).body, p.body);
  await assert.rejects(
    db.transaction((q) => clubPostRow(q, club.id, member.id)),
    denied,
  );
  await assert.rejects(
    db.transaction((q) => clubPostSocial.like(q, p.id, owner.id, true)),
    denied,
  );
  await db.transaction((q) => deleteClubPost(q, club.id, p.id, member.id));
  await assert.rejects(clubPostDetail(db, club.id, p.id), denied);
});
test("reports exclude drafts; common staff moderation hides club/post and retains an own export", async () => {
  const { owner, member, club } = await setup(),
    staff = await userRow(db, { role: "admin", email_verified_at: new Date() }),
    p = await db.transaction((q) => clubPostRow(q, club.id, member.id)),
    draft = await db.transaction((q) =>
      clubPostRow(q, club.id, member.id, { status: "draft" }),
    );
  await assert.rejects(
    createReport(db, viewer({ id: owner.id }), {
      entityType: "club_post",
      targetId: draft.id,
      reason: "spam",
    }),
    denied,
  );
  await createReport(db, viewer({ id: owner.id }), {
    entityType: "club_post",
    targetId: p.id,
    reason: "spam",
  });
  const reports = await reportPage(db);
  assert.ok(reports.reports.some((r) => r.target.href?.includes(p.id)));
  const report = reports.reports.find((r) => r.targetId === p.id)!;
  await db.transaction((q) =>
    moderateReport(
      q,
      report.id,
      viewer({ id: staff.id, role: "admin" }),
      "hide_club_post",
    ),
  );
  await assert.rejects(clubPostDetail(db, club.id, p.id), denied);
  const own = await exportAccount(db, member.id, "https://example.test");
  assert.equal(own.clubPosts.length, 2);
  assert.equal(
    (await exportAccount(db, owner.id, "https://example.test")).clubPosts
      .length,
    0,
  );
});

test("clubs use the common report queue; hiding the club revokes posts and notices without rewriting its history", async () => {
  const { owner, member, club } = await setup(),
    staff = await userRow(db, { role: "admin", email_verified_at: new Date() }),
    p = await db.transaction((q) => clubPostRow(q, club.id, owner.id));
  await assert.rejects(
    createReport(db, viewer({ id: member.id }), {
      entityType: "club",
      targetId: randomUUID(),
      reason: "spam",
    }),
    denied,
  );
  await assert.rejects(
    createReport(db, viewer({ id: owner.id }), {
      entityType: "club",
      targetId: club.id,
      reason: "spam",
    }),
    /собственный/,
  );
  await createReport(db, viewer({ id: member.id }), {
    entityType: "club",
    targetId: club.id,
    reason: "spam",
  });
  const report = (await reportPage(db)).reports.find(
    (r) => r.targetId === club.id,
  )!;
  assert.equal(report.target.name, club.name);
  await db.transaction((q) =>
    moderateReport(
      q,
      report.id,
      viewer({ id: staff.id, role: "admin" }),
      "hide_club",
    ),
  );
  await assert.rejects(clubPostDetail(db, club.id, p.id), denied);
  await assert.rejects(clubPostSocial.page(db, p.id, null), denied);
  assert.equal(
    (
      await db.query<{ body: string }>(
        "SELECT body FROM club_posts WHERE id=$1",
        [p.id],
      )
    ).rows[0].body,
    p.body,
  );
});

test("a report about a formerly public post cannot expose its new draft or let moderators delete it", async () => {
  const { owner, member, club } = await setup(),
    staff = await userRow(db, { role: "admin", email_verified_at: new Date() }),
    p = await db.transaction((q) => clubPostRow(q, club.id, member.id));
  await createReport(db, viewer({ id: owner.id }), {
    entityType: "club_post",
    targetId: p.id,
    reason: "spam",
  });
  await db.transaction((q) =>
    editClubPost(q, club.id, p.id, member.id, {
      version: p.version,
      title: "Секрет нового черновика",
      body: "Приватное дополнение",
      status: "draft",
    }),
  );
  assert.doesNotMatch(
    JSON.stringify(await reportPage(db)),
    /Секрет нового черновика|Приватное дополнение/,
  );
  for (const moderator of [owner.id, staff.id])
    await assert.rejects(
      db.transaction((q) => deleteClubPost(q, club.id, p.id, moderator)),
      denied,
    );
  assert.equal(
    (await clubPostDetail(db, club.id, p.id, member.id)).status,
    "draft",
  );
});

test("photo requests recover a lost acknowledgement, drafts and cross-club media stay private, deletion queues durable GC", async () => {
  const { mkdtemp, rm, stat } = await import("node:fs/promises"),
    { default: sharp } = await import("sharp"),
    { saveClubPostPhoto, readClubPostPhoto, cleanupClubPostPhotos } =
      await import("../lib/club-post-storage.ts"),
    dir = await mkdtemp("/tmp/cola-413-post-photo-");
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  try {
    const { owner, member, club } = await setup(),
      p = await db.transaction((q) =>
        clubPostRow(q, club.id, member.id, { status: "draft" }),
      ),
      bytes = await sharp({
        create: { width: 10, height: 10, channels: 3, background: "#dd4455" },
      })
        .webp()
        .toBuffer(),
      request = randomUUID(),
      photo = await saveClubPostPhoto(
        db.transaction,
        club.id,
        p.id,
        member.id,
        request,
        bytes,
      );
    assert.equal(
      (
        await saveClubPostPhoto(
          db.transaction,
          club.id,
          p.id,
          member.id,
          request,
          bytes,
        )
      ).id,
      photo.id,
    );
    await assert.rejects(
      saveClubPostPhoto(
        db.transaction,
        club.id,
        p.id,
        member.id,
        request,
        Buffer.from("different"),
      ),
      denied,
    );
    for (const who of [null, owner.id])
      await assert.rejects(
        readClubPostPhoto(db, club.id, p.id, photo.id, who),
        denied,
      );
    await assert.rejects(
      readClubPostPhoto(db, randomUUID(), p.id, photo.id, member.id),
      denied,
    );
    assert.deepEqual(
      await readClubPostPhoto(db, club.id, p.id, photo.id, member.id),
      bytes,
    );
    await db.transaction((q) =>
      editClubPost(q, club.id, p.id, member.id, {
        version: p.version,
        title: "Фотопост",
        body: "",
        status: "published",
      }),
    );
    assert.deepEqual(
      await readClubPostPhoto(db, club.id, p.id, photo.id, null),
      bytes,
    );
    const exportOwn = await exportAccount(
      db,
      member.id,
      "https://example.test",
    );
    assert.ok(exportOwn.clubPostPhotos.some((row) => row.id === photo.id));
    await db.transaction((q) => deleteClubPost(q, club.id, p.id, member.id));
    await assert.rejects(
      readClubPostPhoto(db, club.id, p.id, photo.id, member.id),
      denied,
    );
    const filename = "clubpost-" + photo.id + ".webp";
    await stat(dir + "/" + filename);
    await cleanupClubPostPhotos(db);
    await assert.rejects(stat(dir + "/" + filename), { code: "ENOENT" });
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
