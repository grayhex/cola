import type { Queryable, QueryRows } from "./db.ts";
import type { CurrentUser } from "./contracts.ts";
import * as comments from "./comments.ts";
import {
  publicClubPost,
  lockClubPostActor,
  clubPostFrom,
  clubPostPublic,
} from "./club-post-access.ts";
import { clubPostDetail } from "./club-posts.ts";
import { notify } from "./notifications.ts";
import { uuid } from "./validation.ts";
import { z } from "zod";
import { CommunityError } from "./community-validation.ts";
function query(q: Queryable): Queryable {
  return {
    query: async <Row extends object>(
      sql: string,
      args: unknown[] = [],
    ): Promise<QueryRows<Row>> => {
      if (sql.includes("SELECT b.id,b.owner_id,b.share_id FROM bikes")) {
        const p = await publicClubPost(q, uuid.parse(args[0]));
        return {
          rows: [{ id: p.id, owner_id: p.owner_id, share_id: null }],
          rowCount: 1,
        } as QueryRows<Row>;
      }
      if (sql.startsWith("SELECT id FROM bikes WHERE"))
        return q.query<Row>(
          "SELECT id FROM club_posts WHERE id=$1 FOR UPDATE",
          args,
        );
      if (sql.includes("INSERT INTO notifications")) {
        const post = await publicClubPost(q, uuid.parse(args[4]));
        await notify(q, {
          recipient: uuid.parse(args[1]),
          actor: uuid.parse(args[2]),
          type: "club_post_" + z.enum(["comment", "reply"]).parse(args[3]),
          club: post.club_id,
          clubPost: post.id,
          clubPostComment: uuid.parse(args[5]),
        });
        return { rows: [], rowCount: 0 };
      }
      let translated = sql
        .replaceAll("bike_comments", "club_post_comments")
        .replaceAll("bike_id", "post_id");
      if (
        /^(SELECT|WITH)\b/.test(translated) &&
        !translated.includes("FOR UPDATE")
      ) {
        // Apply visibility inside every comment read, including recursive tombstones
        // and reply previews, so hiding a post cannot race a preliminary check.
        translated = translated.replaceAll(
          "club_post_comments",
          "club_visible_comments",
        );
        const guard = `club_visible_comments AS (SELECT pc.* FROM club_post_comments pc WHERE EXISTS(SELECT 1 ${clubPostFrom} WHERE p.id=pc.post_id AND ${clubPostPublic}))`;
        translated = translated.startsWith("WITH RECURSIVE ")
          ? "WITH RECURSIVE " + guard + "," + translated.slice(15)
          : translated.startsWith("WITH ")
            ? "WITH " + guard + "," + translated.slice(5)
            : "WITH " + guard + " " + translated;
      }
      const result = await q.query<Row & Record<string, unknown>>(
        translated,
        args,
      );
      return {
        ...result,
        rows: result.rows.map((row) => ({
          ...row,
          ...("post_id" in row ? { bike_id: row.post_id } : {}),
        })),
      };
    },
  };
}
async function reader(q: Queryable, id: string, user: CurrentUser | null) {
  const p = await publicClubPost(q, id),
    d = await clubPostDetail(q, p.club_id, id, user?.id);
  return {
    actor: user
      ? {
          id: user.id,
          role: d.canModerateComments ? ("admin" as const) : ("user" as const),
        }
      : null,
    participate: d.canParticipate,
  };
}
function rights<T extends { canEdit: boolean }>(c: T, active: boolean): T {
  return { ...c, canEdit: c.canEdit && active };
}
export const clubPostSocial = {
  async page(
    q: Queryable,
    id: string,
    user: CurrentUser | null,
    page = 1,
    focus: string | null = null,
  ) {
    const r = await reader(q, id, user),
      data = await comments.commentPage(query(q), id, r.actor, page, focus);
    return {
      ...data,
      comments: data.comments.map((c) => ({
        ...rights(c, r.participate),
        replies: c.replies.map((reply) => rights(reply, r.participate)),
      })),
      focusPath: data.focusPath.map((c) => rights(c, r.participate)),
    };
  },
  async replies(
    q: Queryable,
    id: string,
    parent: string,
    user: CurrentUser | null,
    page = 1,
  ) {
    const r = await reader(q, id, user),
      data = await comments.replyPage(query(q), id, parent, r.actor, page);
    return {
      ...data,
      comments: data.comments.map((c) => rights(c, r.participate)),
    };
  },
  async create(
    q: Queryable,
    id: string,
    user: CurrentUser,
    input: { body: string; parentId?: string | null },
  ) {
    const p = await publicClubPost(q, id),
      parent = input.parentId
        ? (
            await q.query<{ author_id: string | null }>(
              "SELECT author_id FROM club_post_comments WHERE id=$1 AND post_id=$2",
              [input.parentId, id],
            )
          ).rows[0]
        : null;
    await lockClubPostActor(
      q,
      p.club_id,
      id,
      user.id,
      parent?.author_id ? [parent.author_id] : [],
      { published: true },
    );
    return comments.createComment(query(q), id, user, input);
  },
  async change(
    q: Queryable,
    id: string,
    user: CurrentUser,
    body: string | null = null,
  ) {
    const c = (
      await q.query<{
        post_id: string;
        club_id: string;
        author_id: string | null;
      }>(
        "SELECT cc.post_id,p.club_id,cc.author_id FROM club_post_comments cc JOIN club_posts p ON p.id=cc.post_id WHERE cc.id=$1",
        [id],
      )
    ).rows[0];
    if (!c) throw new CommunityError("Комментарий недоступен", 404);
    const a = await lockClubPostActor(
      q,
      c.club_id,
      c.post_id,
      user.id,
      c.author_id ? [c.author_id] : [],
      {
        published: body !== null,
        withdraw: body === null,
        withdrawOwn: body === null && c.author_id === user.id,
      },
    );
    const admin =
      a.site_role === "admin" ||
      (a.state === "active" && ["owner", "admin"].includes(a.role || ""));
    return comments.changeComment(
      query(q),
      id,
      { id: user.id, role: admin ? "admin" : "user" },
      body,
    );
  },
  async like(q: Queryable, id: string, user: string, enabled: boolean) {
    const initial = await publicClubPost(q, id),
      a = await lockClubPostActor(q, initial.club_id, id, user, [], {
        published: enabled,
        withdraw: !enabled,
        withdrawOwn: !enabled,
      });
    if (enabled) {
      if (a.owner_id === user)
        throw new CommunityError("Нельзя поставить лайк своей публикации", 403);
      await q.query(
        "INSERT INTO club_post_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, user],
      );
      await notify(q, {
        recipient: a.owner_id,
        actor: user,
        type: "club_post_like",
        club: a.club_id,
        clubPost: id,
      });
    } else
      await q.query(
        "DELETE FROM club_post_likes WHERE post_id=$1 AND user_id=$2",
        [id, user],
      );
    return {
      liked: enabled,
      likes: (
        await q.query<{ n: number }>(
          "SELECT count(*)::int n FROM club_post_likes l JOIN users u ON u.id=l.user_id WHERE l.post_id=$1 AND NOT u.blocked",
          [id],
        )
      ).rows[0].n,
    };
  },
};
