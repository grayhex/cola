import type { SiteCatalog as SiteCatalogType } from "./contracts.ts";
import type { Queryable } from "./db.ts";
import { classificationQueryShape } from "./classification-validation.ts";
import { classificationWhere } from "./classification-sql.ts";
import { categoryFilterLabels } from "./bike-classification.ts";
import { z } from "zod";
import { getSite } from "./site.ts";
import { showcase } from "./showcase.ts";
import { journalCards } from "./journal-discovery.ts";
import { journalPublic, journalFrom } from "./journal.ts";
import { publicAuthor } from "./profile-dto.ts";
import { CommunityError } from "./community-validation.ts";
const term = z
  .string()
  .trim()
  .max(150)
  .refine((s) => !s.includes("\0"));

export const searchInput = z.object({
  ...classificationQueryShape,
  category: z.enum(["", ...Object.keys(categoryFilterLabels)]).default(""),
  q: term.default(""),
  exact: z.enum(["", "1"]).default(""),
  brand: term.default(""),
  model: term.default(""),
  component: term.default(""),
  componentCategory: term.default(""),
  bikeModelId: z.union([z.literal(""), z.uuid()]).default(""),
  componentModelId: z.union([z.literal(""), z.uuid()]).default(""),
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
/** SQL for the spelling rules of a brand, model or component. Scoped aliases
apply by each row's own brand (`b.brand`) or component category
(`p.category`), so callers alias those tables as `b` and `p`. */
export function experienceRules(
  catalog: SiteCatalogType,
  kind: string,
  add: (value: unknown) => string,
) {
  const all =
    add(
      JSON.stringify((catalog.aliases || []).filter((a) => a.kind === kind)),
    ) + "::jsonb";
  const scopeRules =
    kind === "model"
      ? add(
          JSON.stringify(
            (catalog.aliases || []).filter(
              (a: { kind: string }) => a.kind === "brand",
            ),
          ),
        ) + "::jsonb"
      : "'[]'::jsonb";
  return `experience_rules(${all},${kind === "model" ? "b.brand" : kind === "component" ? "p.category" : "''"},${scopeRules})`;
}

export function experienceFilter(
  catalog: SiteCatalogType,
  input: SearchInput,
  params: unknown[],
  entry = false,
) {
  const add = (v: unknown) => {
    params.push(v);
    return "$" + params.length;
  };
  const clauses: string[] = [];
  const rules = (kind: string) => experienceRules(catalog, kind, add);
  const match = (expr: string, value: string, kind: string, exact = false) => {
    const r = rules(kind),
      v = add(value);
    return exact
      ? `experience_canonical(${expr},${r})=experience_canonical(${v},${r})`
      : `strpos(experience_canonical(${expr},${r}),experience_canonical(${v},${r}))>0`;
  };
  if (input.bikeModelId) {
    const id = add(input.bikeModelId);
    clauses.push(
      `b.catalog_model_id IN (SELECT id FROM bike_models WHERE coalesce(merged_into,id)=(SELECT coalesce(merged_into,id) FROM bike_models WHERE id=${id}))`,
    );
  }
  if (!input.bikeModelId && input.brand)
    clauses.push(match("b.brand", input.brand, "brand", true));
  if (!input.bikeModelId && input.model)
    clauses.push(match("b.model", input.model, "model", input.exact === "1"));
  if (input.year) clauses.push("b.year=" + add(input.year));
  if (input.purpose) {
    if (
      !(catalog.purposes || []).some(
        (p: { id: string }) => p.id === input.purpose,
      )
    )
      throw new CommunityError("Неизвестное назначение");
    clauses.push(add(input.purpose) + "=ANY(b.purposes)");
  }
  if (input.componentModelId) {
    const id = add(input.componentModelId);
    const target = `(SELECT coalesce(merged_into,id) FROM component_models WHERE id=${id})`;
    clauses.push(
      entry
        ? `EXISTS(SELECT 1 FROM jsonb_array_elements(e.components) part
          JOIN component_models source ON source.id::text=part->>'model_id'
            OR (coalesce(part->>'model_id','')='' AND source.id IN (
              SELECT n.model_id FROM component_model_names n
              WHERE n.category_key=component_key(part->>'category') AND n.name_key=component_key(part->>'name')))
          WHERE coalesce(source.merged_into,source.id)=${target})`
        : `EXISTS(SELECT 1 FROM components p JOIN component_models source ON source.id=p.model_id
          WHERE p.bike_id=b.id AND coalesce(source.merged_into,source.id)=${target})`,
    );
  } else if (input.component) {
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
  return (
    (clauses.length ? " AND " + clauses.join(" AND ") : "") +
    classificationWhere(input, params, input.category ? [input.category] : [])
  );
}

type SearchPage<K extends SearchInput["type"], I> = {
  items: I[];
  total: number;
  page: number;
  pageSize: number;
  type: K;
};
export type ExperienceSearchResult =
  | SearchPage<"users", NonNullable<ReturnType<typeof publicAuthor>>>
  | SearchPage<"journal", Awaited<ReturnType<typeof journalCards>>[number]>
  | SearchPage<"bikes", Awaited<ReturnType<typeof showcase>>["bikes"][number]>;
export function searchExperience(
  q: Queryable,
  viewer: string | null | undefined,
  input: SearchInput & { type: "bikes" },
): Promise<Extract<ExperienceSearchResult, { type: "bikes" }>>;
export function searchExperience(
  q: Queryable,
  viewer: string | null | undefined,
  input: SearchInput & { type: "journal" },
): Promise<Extract<ExperienceSearchResult, { type: "journal" }>>;
export function searchExperience(
  q: Queryable,
  viewer: string | null | undefined,
  input: SearchInput & { type: "users" },
): Promise<Extract<ExperienceSearchResult, { type: "users" }>>;
export function searchExperience(
  q: Queryable,
  viewer: string | null | undefined,
  input: SearchInput,
): Promise<ExperienceSearchResult>;
export async function searchExperience(
  q: Queryable,
  viewer: string | null | undefined,
  input: SearchInput,
): Promise<ExperienceSearchResult> {
  const site = await getSite(q),
    params: unknown[] | undefined = [];
  let similarCategory: string | null = null;
  if (input.similar) {
    const b = (
      await q.query<{
        brand: string;
        model: string;
        category: string;
        purposes: string[];
        id: string;
      }>(
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
    similarCategory = b.category;
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
      if (similarCategory) {
        params.push(similarCategory);
        where += " AND b.category=$" + params.length;
      }
    }
  }
  const total = (
    await q.query<{ total: number }>(
      "SELECT count(*)::int total" + from + where,
      params,
    )
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
    await q.query<{
      id: string;
      username?: string;
      name?: string;
      avatar_id?: string | null;
    }>(
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
  function page<K extends SearchInput["type"], I extends { id: string }>(
    type: K,
    items: I[],
  ): SearchPage<K, I> {
    const index = new Map(items.map((i) => [i.id, i]));
    return {
      items: rows.flatMap((r) => (index.has(r.id) ? [index.get(r.id)!] : [])),
      total,
      page: input.page,
      pageSize: 24,
      type,
    };
  }
  if (input.type === "users")
    return page(
      "users",
      rows.map((row) =>
        publicAuthor({
          id: row.id,
          username: row.username!,
          name: row.name!,
          avatar_id: row.avatar_id,
        }),
      ),
    );
  if (input.type === "journal")
    return page(
      "journal",
      await journalCards(
        q,
        rows.map((r) => r.id),
        viewer,
      ),
    );
  return page(
    "bikes",
    rows.length
      ? (await showcase(q, viewer, { ids: rows.map((r) => r.id) })).bikes
      : [],
  );
}

export type SearchInput = z.infer<typeof searchInput>;
