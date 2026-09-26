import { classificationOf } from "./bike-classification.js";
import { publicAuthor } from "./profile-dto.js";
// Deliberate DTOs: never spread database rows into public responses. Each key
// list must match its type, so a new public field is always a visible change.
/**
 * @template {string} K
 * @param {Record<string, any>} row
 * @param {readonly K[]} names
 */
const fields = (row, names) =>
  /** @type {Record<K, any>} */ (
    Object.fromEntries(names.map((key) => [key, row[key]]))
  );
/**
 * @typedef {object} PublicPhoto
 * @property {string} id
 * @property {boolean} is_cover
 * @property {string | null} source_page_url
 */
/**
 * A component; the price only where the owner shows prices of its section.
 * @typedef {object} PublicComponent
 * @property {string} id
 * @property {"build" | "accessories"} section
 * @property {string} model_id
 * @property {string} category
 * @property {string} name
 * @property {string} notes
 * @property {string} url
 * @property {string} group_id
 * @property {number} sort_order
 * @property {string | null} [price]
 */
/**
 * A public bike. PostgreSQL numerics (weight, price) arrive as strings, "9.40".
 * @typedef {object} PublicBike
 * @property {string} id
 * @property {string} share_id
 * @property {string} public_id
 * @property {string} slug
 * @property {string} name
 * @property {string} brand
 * @property {string} model
 * @property {string} trim
 * @property {number} year
 * @property {string} category
 * @property {import("./classification-validation.js").Classification} classification
 * @property {string[]} purposes
 * @property {string} description
 * @property {string} color
 * @property {string} size
 * @property {string | null} weight
 * @property {number} mileage
 * @property {string} manufacturer_url
 * @property {boolean} is_public
 * @property {boolean} is_former
 * @property {string[]} group_order
 * @property {boolean} show_bike_price
 * @property {boolean} show_component_prices
 * @property {boolean} show_accessory_prices
 * @property {string | null} [price] only when show_bike_price
 * @property {PublicComponent[]} components
 * @property {PublicPhoto[]} photos
 */
/**
 * A bike card or page with its author and the viewer's reactions.
 * @typedef {PublicBike & {
 *   author: import("./profile-dto.js").PublicAuthor | null,
 *   is_owner: boolean,
 *   likes: number,
 *   liked: boolean,
 *   comments: number,
 *   scores: {completeness: number, upgrade: number},
 * }} SocialBike
 */
/** @satisfies {ReadonlyArray<keyof PublicBike>} */
export const publicBikeKeys = /** @type {const} */ ([
  "purposes",
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
]);
/** @satisfies {ReadonlyArray<keyof PublicComponent>} */
export const publicComponentKeys = /** @type {const} */ ([
  "id",
  "model_id",
  "section",
  "category",
  "name",
  "notes",
  "url",
  "group_id",
  "sort_order",
]);
/** @satisfies {ReadonlyArray<keyof PublicPhoto>} */
export const publicPhotoKeys = /** @type {const} */ ([
  "id",
  "is_cover",
  "source_page_url",
]);
/** @returns {PublicPhoto} */
export function publicPhoto(photo) {
  return fields(photo, publicPhotoKeys);
}
/** @returns {PublicComponent} */
export function publicComponent(part, visiblePrice) {
  return {
    ...fields(part, publicComponentKeys),
    ...(visiblePrice ? { price: part.price } : {}),
  };
}
/** @returns {PublicBike} */
export function publicBike(bike) {
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
/** @returns {SocialBike} */
export function publicSocial(
  bike,
  {
    author = null,
    isOwner = false,
    likes = 0,
    liked = false,
    comments = 0,
    scores,
  },
) {
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
