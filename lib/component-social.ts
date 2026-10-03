import type { QueryRows } from "./db.ts";
import type { Queryable } from "./db.ts";
import * as comments from "./comments.ts";
import { notify } from "./notifications.ts";
import {
  componentActor,
  publicComponent,
  lockComponent,
} from "./component-access.ts";
import { CommunityError } from "./community-validation.ts";
import type { CurrentUser } from "./contracts.ts";

// Adapt the existing engine, like entitySocial does for rides and journal.
// Immutable comment FKs retain their source ID through catalog merges.
function query(q: Queryable): Queryable {
  return {
    query: async <Row extends object>(
      sql: string,
      args: unknown[] = [],
    ): Promise<QueryRows<Row>> => {
      if (sql.includes("SELECT b.id,b.owner_id,b.share_id FROM bikes")) {
        const m = await publicComponent(q, args[0] as string);
        return {
          rows: [{ id: m.id, owner_id: null, share_id: null }],
          rowCount: 1,
        } as QueryRows<Row>;
      }
      if (sql.startsWith("SELECT id FROM bikes WHERE")) {
        const m = await lockComponent(q, args[0] as string);
        return { rows: [{ id: m.id }], rowCount: 1 } as QueryRows<Row>;
      }
      if (sql.includes("INSERT INTO notifications")) {
        await notify(q, {
          recipient: args[1] as string,
          actor: args[2] as string,
          type: "component_reply",
          component: args[4] as string,
          componentComment: args[5] as string,
        });
        return { rows: [], rowCount: 0 };
      }
      let translated = sql
        .replaceAll("bike_comments", "component_comments")
        .replaceAll("bike_id", "model_id");
      // Parameters remain values; identifiers and replacements are a closed engine contract.
      translated = translated.replace(
        /((?:c\.)?model_id)=\$(\d+)/g,
        (_, column, index) =>
          `${column} IN (SELECT id FROM component_models WHERE coalesce(merged_into,id)=(SELECT coalesce(merged_into,id) FROM component_models WHERE id=$${index}))`,
      );
      if (sql.startsWith("INSERT INTO bike_comments")) {
        args = [...args];
        if (args[3])
          args[1] = (
            await q.query<{ model_id: string }>(
              "SELECT model_id FROM component_comments WHERE id=$1",
              [args[3]],
            )
          ).rows[0].model_id;
        else args[1] = (await publicComponent(q, args[1] as string)).id;
      }
      const result = await q.query<Row & Record<string, unknown>>(
        translated,
        args,
      );
      return {
        ...result,
        rows: result.rows.map((r) => ({
          ...r,
          ...("model_id" in r ? { bike_id: r.model_id } : {}),
        })),
      };
    },
  };
}
export const componentSocial = {
  page: (q: Queryable, ...a: comments.CommentPageArgs) =>
    comments.commentPage(query(q), ...a),
  replies: (q: Queryable, ...a: comments.ReplyPageArgs) =>
    comments.replyPage(query(q), ...a),
  keysetPage: (
    q: Queryable,
    id: string,
    options: Parameters<typeof comments.commentKeysetPage>[2],
  ) => comments.commentKeysetPage(query(q), id, options),
  keysetReplies: (
    q: Queryable,
    id: string,
    parent: string,
    options: Parameters<typeof comments.replyKeysetPage>[3],
  ) => comments.replyKeysetPage(query(q), id, parent, options),
  async create(
    q: Queryable,
    id: string,
    user: CurrentUser,
    input: { body: string; parentId?: string | null | undefined },
  ) {
    // Reserve the reply recipient as well: simultaneous replies must not deadlock
    // through notification FKs while holding different actor UPDATE locks.
    const parent = input.parentId
      ? (
          await q.query<{ author_id: string }>(
            "SELECT author_id FROM component_comments WHERE id=$1",
            [input.parentId],
          )
        ).rows[0]
      : null;
    await q.query<{ id: string }>(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[user.id, parent?.author_id].filter(Boolean)],
    );
    const actor = await componentActor(q, user, true);
    const model = await lockComponent(q, id);
    return comments.createComment(query(q), model.id, actor, input);
  },
  async change(
    q: Queryable,
    id: string,
    user: CurrentUser,
    body: string | null = null,
  ) {
    const actor = await componentActor(q, user, body !== null);
    // Resolve the parent before taking the catalog lock, including admin deletion.
    const c = (
      await q.query<{ model_id: string }>(
        "SELECT model_id FROM component_comments WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!c) throw new CommunityError("Комментарий недоступен", 404);
    await lockComponent(q, c.model_id);
    return comments.changeComment(query(q), id, actor, body);
  },
};
