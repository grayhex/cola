// Deliberate DTOs: never spread database rows into public responses.
const fields = (row, names) =>
  Object.fromEntries(names.map((key) => [key, row[key]]));
export const publicBikeKeys = [
  "id",
  "share_id",
  "name",
  "brand",
  "model",
  "trim",
  "year",
  "category",
  "description",
  "color",
  "size",
  "weight",
  "mileage",
  "manufacturer_url",
  "is_public",
  "group_order",
  "show_bike_price",
  "show_component_prices",
  "show_accessory_prices",
];
export const publicComponentKeys = [
  "id",
  "section",
  "category",
  "name",
  "notes",
  "url",
  "group_id",
  "sort_order",
];
export const publicPhotoKeys = ["id", "is_cover", "source_page_url"];
export function publicPhoto(photo) {
  return fields(photo, publicPhotoKeys);
}
export function publicComponent(part, visiblePrice) {
  return {
    ...fields(part, publicComponentKeys),
    ...(visiblePrice ? { price: part.price } : {}),
  };
}
export function publicBike(bike) {
  return {
    ...fields(bike, publicBikeKeys),
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
  bike,
  { author = "", isOwner = false, likes = 0, liked = false, scores },
) {
  return {
    ...publicBike(bike),
    author: String(author),
    is_owner: !!isOwner,
    likes: Number(likes),
    liked: !!liked,
    scores: { completeness: scores.completeness, upgrade: scores.upgrade },
  };
}
