import type { AuthorRow as AuthorRowType } from "./profile-dto.ts";
import type { PublicPhoto as PublicPhotoType } from "./contracts.ts";
import type { PublicComponent as PublicComponentType } from "./contracts.ts";
import type { PublicBike as PublicBikeType } from "./contracts.ts";
import type { SocialBike as SocialBikeType } from "./contracts.ts";
import { classificationOf } from "./bike-classification.ts";
import { publicAuthor } from "./profile-dto.ts";
// Deliberate DTOs: never spread database rows into public responses. Each key
// list must match its type, so a new public field is always a visible change.
function fields<T extends object, K extends keyof T>(
  row: T,
  names: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(names.map((key) => [key, row[key]])) as Pick<T, K>;
}
export type PublicBikeSource = Omit<
  PublicBike,
  "components" | "photos" | "classification"
> & {
  classification?: PublicBike["classification"] | null;
  components?: PublicComponent[];
  photos?: PublicPhoto[];
};

export const publicBikeKeys = /** @type {const} */ [
  "purposes",
  "catalog_model_id",
  "id",
  "share_id",
  "public_id",
  "slug",
  "name",
  "brand",
  "model",
  "trim",
  "year",
  "category",
  "classification",
  "description",
  "color",
  "size",
  "weight",
  "mileage",
  "manufacturer_url",
  "is_public",
  "is_former",
  "group_order",
  "show_bike_price",
  "show_component_prices",
  "show_accessory_prices",
] as const satisfies readonly (keyof PublicBike)[];

export const publicComponentKeys = /** @type {const} */ [
  "id",
  "model_id",
  "section",
  "category",
  "name",
  "notes",
  "url",
  "group_id",
  "sort_order",
] as const satisfies readonly (keyof PublicComponent)[];

export const publicPhotoKeys = /** @type {const} */ [
  "id",
  "is_cover",
  "source_page_url",
] as const satisfies readonly (keyof PublicPhoto)[];

export function publicPhoto(photo: PublicPhoto): PublicPhoto {
  return fields(photo, publicPhotoKeys);
}

export function publicComponent(
  part: PublicComponent,
  visiblePrice: boolean,
): PublicComponent {
  return {
    ...fields(part, publicComponentKeys),
    ...(visiblePrice ? { price: part.price } : {}),
  };
}

export function publicBike(bike: PublicBikeSource): PublicBike {
  return {
    ...fields(bike, publicBikeKeys),
    is_former: bike.is_former === true,
    classification: classificationOf(bike),
    ...(bike.show_bike_price ? { price: bike.price } : {}),
    components: (bike.components || []).map((p) =>
      publicComponent(
        p,
        p.section === "build"
          ? bike.show_component_prices
          : bike.show_accessory_prices,
      ),
    ),
    photos: (bike.photos || []).map(publicPhoto),
  };
}

export function publicSocial(
  bike: PublicBikeSource,
  {
    author = null,
    isOwner = false,
    likes = 0,
    liked = false,
    comments = 0,
    scores,
  }: {
    author?: AuthorRowType | null;
    isOwner?: boolean;
    likes?: number;
    liked?: boolean;
    comments?: number;
    scores: {
      completeness: number;
      upgrade: number;
    };
  },
): SocialBike {
  return {
    ...publicBike(bike),
    author: publicAuthor(author),
    is_owner: !!isOwner,
    likes: Number(likes),
    liked: !!liked,
    comments: Number(comments),
    scores: { completeness: scores.completeness, upgrade: scores.upgrade },
  };
}

export type PublicPhoto = PublicPhotoType;
export type PublicComponent = PublicComponentType;
export type PublicBike = PublicBikeType;
export type SocialBike = SocialBikeType;
