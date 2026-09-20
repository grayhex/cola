import { z } from "zod";
import { getSite } from "./site.js";
import { showcase } from "./showcase.js";
import { journalCards } from "./journal-discovery.js";
import { journalPublic, journalFrom } from "./journal.js";
import { publicAuthor } from "./profile-dto.js";
import { CommunityError } from "./community-validation.js";
const term = z
  .string()
  .trim()
  .max(150)
  .refine((s) => !s.includes("\0"));
export const searchInput = z.object({
  q: term.default(""),
  exact: z.enum(["", "1"]).default(""),
  brand: term.default(""),
  model: term.default(""),
  component: term.default(""),
  componentCategory: term.default(""),
  year: z
    .union([z.literal(""), z.coerce.number().int().min(1900).max(2100)])
    .default(""),
  purpose: z
    .string()
    .regex(/^[a-z0-9_-]{0,30}$/)
    .default(""),
  kind: z
    .enum(["", "build", "service", "review", "question", "story"])
    .default(""),
  type: z.enum(["bikes", "journal", "users"]).default("bikes"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  similar: z.union([z.literal(""), z.uuid()]).default(""),
});
export function experienceFilter(catalog, input, params, entry = false) {
  const add = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  const clauses = [];
  const rules = (kind) => {
    const all =
      add(
        JSON.stringify((catalog.aliases || []).filter((a) => a.kind === kind)),
      ) + "::jsonb";
    const scopeRules =
      kind === "model"
        ? add(
            JSON.stringify(
              (catalog.aliases || []).filter((a) => a.kind === "brand"),
            ),
          ) + "::jsonb"
        : "'[]'::jsonb";
    return `experience_rules(${all},${kind === "model" ? "b.brand" : kind === "component" ? "p.category" : "''"},${scopeRules})`;
  };
  const match = (expr, value, kind, scope = "", exact = false) => {
    const r = rules(kind, scope),
      v = add(value);
    return exact
      ? `experience_canonical(${expr},${r})=experience_canonical(${v},${r})`
      : `strpos(experience_canonical(${expr},${r}),experience_canonical(${v},${r}))>0`;
  };
  if (input.brand)
    clauses.push(match("b.brand", input.brand, "brand", "", true));
  if (input.model)
    clauses.push(
      match("b.model", input.model, "model", input.brand, input.exact === "1"),
    );
  if (input.year) clauses.push("b.year=" + add(input.year));
  if (input.purpose) {
    if (!(catalog.purposes || []).some((p) => p.id === input.purpose))
      throw new CommunityError("Неизвестное назначение");
    clauses.push(add(input.purpose) + "=ANY(b.purposes)");
  }
  if (input.component) {
    const category = input.componentCategory
      ? " AND experience_normalize(p.category)=experience_normalize(" +
        add(input.componentCategory) +
        ")"
      : "";
    // An entry describes the captured installation, not today's bike configuration.
    const name = match(
      "p.name",
      input.component,
      "component",
      input.componentCategory,
      input.exact === "1",
    );
    clauses.push(
      entry
        ? `EXISTS(SELECT 1 FROM jsonb_to_recordset(e.components) AS p(name text,category text) WHERE ${name}${category})`
        : `EXISTS(SELECT 1 FROM components p WHERE p.bike_id=b.id${category} AND ${name})`,
    );
  }
  if (input.q) {
    const baseRules =
        add(JSON.stringify((catalog.aliases || []).filter((a) => !a.scope))) +
        "::jsonb",
      r = "(" + baseRules + " || " + rules("model") + ")",
      v = add(input.q);
    const expression = entry
      ? "e.title||' '||e.body||' '||b.name||' '||b.brand||' '||b.model"
      : "b.name||' '||b.brand||' '||b.model||' '||u.name";
    const part = entry
      ? `EXISTS(SELECT 1 FROM jsonb_to_recordset(e.components) AS p(name text,category text) WHERE ${match("p.name", input.q, "component")})`
      : `EXISTS(SELECT 1 FROM components p WHERE p.bike_id=b.id AND ${match("p.name", input.q, "component")})`;
    clauses.push(
      `(strpos(experience_canonical(${expression},${r}),experience_canonical(${v},${r}))>0 OR ${part})`,
    );
  }
  if (entry && input.kind) clauses.push("e.kind=" + add(input.kind));
  return clauses.length ? " AND " + clauses.join(" AND ") : "";
}
export async function searchExperience(q, viewer, input) {
  const site = await getSite(q),
    params = [];
  if (input.similar) {
    const b = (
      await q.query(
        "SELECT b.brand,b.model,b.category,b.purposes,b.id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked",
        [input.similar],
      )
    ).rows[0];
    if (!b) throw new CommunityError("Велосипед недоступен", 404);
    // Useful for unnamed custom builds too: category/purpose, no fabricated model.
    input = {
      ...input,
      brand: b.model ? b.brand : "",
      model: b.model || "",
      purpose: b.purposes[0] || "",
    };
    input.similarCategory = b.category;
  }
  let from, where;
  if (input.type === "users") {
    params.push(input.q);
    from = " FROM users u";
    where =
      " WHERE NOT u.blocked AND (strpos(experience_normalize(u.name||' '||u.username),experience_normalize($1))>0)";
  } else {
    from =
      input.type === "journal"
        ? journalFrom
        : " FROM bikes b JOIN users u ON u.id=b.owner_id";
    where =
      " WHERE " +
      (input.type === "journal"
        ? journalPublic
        : "b.is_public AND NOT u.blocked") +
      experienceFilter(site.catalog, input, params, input.type === "journal");
    if (input.similar) {
      params.push(input.similar);
      where += " AND b.id<>$" + params.length;
      if (input.similarCategory) {
        params.push(input.similarCategory);
        where += " AND b.category=$" + params.length;
      }
    }
  }
  const total = (
    await q.query("SELECT count(*)::int total" + from + where, params)
  ).rows[0].total;
  const order =
    input.type === "journal"
      ? "e.published_at DESC,e.id"
      : input.type === "users"
        ? "u.name,u.id"
        : "b.created_at DESC,b.id";
  const columns =
    input.type === "journal"
      ? "e.id"
      : input.type === "users"
        ? "u.id,u.username,u.name,u.avatar_id"
        : "b.id";
  const rows = (
    await q.query(
      "SELECT " +
        columns +
        from +
        where +
        " ORDER BY " +
        order +
        " LIMIT 24 OFFSET $" +
        (params.length + 1),
      [...params, (input.page - 1) * 24],
    )
  ).rows;
  let items;
  if (input.type === "users") items = rows.map(publicAuthor);
  else if (input.type === "journal")
    items = await journalCards(
      q,
      rows.map((r) => r.id),
      viewer,
    );
  else
    items = rows.length
      ? (await showcase(q, viewer, { ids: rows.map((r) => r.id) })).bikes
      : [];
  const index = new Map(items.map((i) => [i.id, i]));
  return {
    items: rows.flatMap((r) => (index.has(r.id) ? [index.get(r.id)] : [])),
    total,
    page: input.page,
    pageSize: 24,
    type: input.type,
  };
}
