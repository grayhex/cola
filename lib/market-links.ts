interface LinkedModel {
  id: string;
  name: string;
  slug: string;
  archived: boolean;
  brand?: string;
  brandSlug?: string;
  categorySlug?: string;
}
export interface ListingLinkRow {
  component_model_id: string | null;
  bike_model_id: string | null;
  component_model: LinkedModel | null;
  bike_model: LinkedModel | null;
  linked_bike: {
    id: string;
    name: string;
    public_id: string;
    slug: string;
    share_id: string;
    isPublic: boolean;
  } | null;
}
import type { Queryable } from "./db.ts";
import { z } from "zod";
import { CommunityError } from "./community-validation.ts";
import {
  resolveComponentModel,
  componentCatalog,
  componentCatalogInput,
} from "./component-catalog.ts";
import {
  resolveBikeModel,
  bikeCatalog,
  bikeCatalogInput,
} from "./bike-catalog.ts";
import { modelLandingPath, partLandingPath } from "./experience-catalog.ts";
import { publicPath } from "./public-urls.ts";

// Each listing read resolves references anew: names/URLs follow catalog edits,
// and hiding a bicycle revokes its link without changing the advertisement.
export const marketLinkColumns = `
 (SELECT jsonb_build_object('id',c.id,'name',c.name,'category',c.category,'categorySlug',c.category_slug,'slug',c.slug,'archived',c.archived)
  FROM component_models s JOIN component_models c ON c.id=coalesce(s.merged_into,s.id)
  WHERE s.id=m.component_model_id AND c.first_public_at IS NOT NULL) component_model,
 (SELECT jsonb_build_object('id',c.id,'brand',c.brand,'name',c.name,'brandSlug',c.brand_slug,'slug',c.slug,'archived',c.archived)
  FROM bike_models s JOIN bike_models c ON c.id=coalesce(s.merged_into,s.id)
  WHERE s.id=m.bike_model_id AND c.first_public_at IS NOT NULL) bike_model,
 (SELECT jsonb_build_object('id',b.id,'name',b.name,'public_id',b.public_id,'slug',b.slug,'share_id',b.share_id,'isPublic',b.is_public)
  FROM bikes b WHERE b.id=m.linked_bike_id AND b.owner_id=m.owner_id) linked_bike`;

export function listingLinks(row: ListingLinkRow, owner: boolean) {
  const component = row.component_model,
    model = row.bike_model,
    bike = row.linked_bike;
  const reference = (m: LinkedModel | null, kind: string) =>
    !m
      ? null
      : {
          id: m.id,
          name: kind === "bike" ? `${m.brand} ${m.name}` : m.name,
          path:
            kind === "bike"
              ? modelLandingPath(m.brandSlug!, m.slug)
              : partLandingPath(m.categorySlug!, m.slug),
          archived: m.archived,
        };
  const bicycle = bike && {
    id: bike.id,
    name: bike.name,
    path: bike.isPublic ? publicPath("bike", bike) : null,
    isPublic: bike.isPublic,
  };
  return {
    componentModel: reference(component, "component"),
    bikeModel: reference(model, "bike"),
    linkedBike: bike?.isPublic ? bicycle : null,
    ...(owner
      ? {
          componentModelId: row.component_model_id,
          bikeModelId: row.bike_model_id,
          linkedBikeId: bicycle?.id || null,
          ownedBike: bicycle,
        }
      : {}),
  };
}

export async function listingModelChoices(
  q: Queryable,
  category: string,
  query: string,
) {
  if (category === "components")
    return componentCatalog(q, componentCatalogInput.parse({ q: query }));
  if (category === "bikes")
    return bikeCatalog(q, bikeCatalogInput.parse({ q: query }));
  throw new CommunityError("Выберите категорию объявления");
}
export async function listingBikeChoices(q: Queryable, owner: unknown) {
  const rows = (
    await q.query<{
      id: string;
      name: string;
      is_public: boolean;
      share_id: string;
      public_id: string;
      slug: string;
    }>(
      "SELECT id,name,is_public,share_id,public_id,slug FROM bikes WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT 100",
      [owner],
    )
  ).rows;
  return {
    items: rows.map((b) => ({
      id: b.id,
      name: b.name,
      isPublic: b.is_public,
      path: b.is_public ? publicPath("bike", b) : null,
    })),
  };
}

export async function validateListingLinks(
  q: Queryable,
  owner: unknown,
  input: {
    title: string;
    description: string;
    category: "components" | "bikes" | "accessories";
    condition: "new" | "used";
    price: number | null;
    currency: "RUB";
    location: string;
    contact: string;
    status: "draft" | "active" | "sold";
    listingType?: string | undefined;
    componentModelId?: string | null | undefined;
    bikeModelId?: string | null | undefined;
    linkedBikeId?: string | null | undefined;
  },
  prior: {
    component_model_id: string | null;
    bike_model_id: string | null;
    linked_bike_id: string | null;
  } | null = null,
) {
  const component =
    input.category === "components"
      ? input.componentModelId === undefined
        ? prior?.component_model_id || null
        : input.componentModelId
      : null;
  const model =
    input.category === "bikes"
      ? input.bikeModelId === undefined
        ? prior?.bike_model_id || null
        : input.bikeModelId
      : null;
  if (
    (input.componentModelId && input.category !== "components") ||
    (input.bikeModelId && input.category !== "bikes")
  )
    throw new CommunityError("Модель не соответствует категории объявления");
  const bike =
    input.linkedBikeId === undefined
      ? prior?.linked_bike_id || null
      : input.linkedBikeId;
  // Owner -> listing -> own bicycle -> catalog is the same order as bicycle deletion.
  if (bike) {
    if (
      !z.uuid().safeParse(bike).success ||
      !(
        await q.query<{ id: string }>(
          "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR KEY SHARE",
          [bike, owner],
        )
      ).rowCount
    )
      throw new CommunityError("Выберите свой велосипед", 404);
  }
  await q.query<{ pg_advisory_xact_lock: unknown }>(
    "SELECT pg_advisory_xact_lock(145,0)",
  );
  const validate = async (
    id: string | null | undefined,
    previous: string | null | undefined,
    resolve: (
      q: Queryable,
      id: string,
    ) => Promise<{ id: string; archived: boolean } | null>,
  ) => {
    if (!id) return null;
    if (!z.uuid().safeParse(id).success)
      throw new CommunityError("Модель недоступна", 404);
    // Keeping an existing link never blocks unrelated edits of an old listing.
    if (id === previous) return id;
    const selected = await resolve(q, id),
      existing = previous ? await resolve(q, previous) : null;
    if (!selected || (selected.archived && selected.id !== existing?.id))
      throw new CommunityError("Модель недоступна", 404);
    return selected.id;
  };
  return {
    component: await validate(
      component,
      prior?.component_model_id,
      resolveComponentModel,
    ),
    model: await validate(model, prior?.bike_model_id, resolveBikeModel),
    bike,
  };
}
