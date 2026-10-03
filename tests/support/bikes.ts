import { randomUUID } from "node:crypto";
import type { Queryable } from "../../lib/db.ts";
import type {
  BikeRow,
  ComponentRow,
  PhotoRow,
} from "../../lib/database-rows.ts";
import { given, insertRow, type Columns } from "./rows.ts";

/** The columns of a bike a test sets; price and weight in rubles and kilograms. */
export type BikeOverrides = Columns<Omit<BikeRow, "price" | "weight">> & {
  price?: number | null;
  weight?: number | null;
};

/**
 * A public gravel bike of `ownerId`. `overrides` are columns of `bikes`, e.g.
 * `{ is_public: false }`.
 */
export function bikeRow(
  q: Queryable,
  ownerId: string,
  overrides: BikeOverrides = {},
): Promise<BikeRow> {
  const id = overrides.id ?? randomUUID();
  const { price, weight, ...columns } = overrides;
  return insertRow<BikeRow>(q, "bikes", {
    id,
    owner_id: ownerId,
    share_id: randomUUID(),
    name: "Bike",
    year: 2026,
    category: "gravel",
    is_public: true,
    price: numeric(price),
    weight: numeric(weight),
    ...given(columns),
  });
}

export function componentRow(
  q: Queryable,
  bikeId: string,
  overrides: Columns<ComponentRow> = {},
): Promise<ComponentRow> {
  return insertRow<ComponentRow>(q, "components", {
    id: randomUUID(),
    bike_id: bikeId,
    section: "build",
    category: "Рама",
    name: "Frame",
    ...given(overrides),
  });
}

export function photoRow(
  q: Queryable,
  bikeId: string,
  overrides: Columns<PhotoRow> = {},
): Promise<PhotoRow> {
  const id = overrides.id ?? randomUUID();
  return insertRow<PhotoRow>(q, "photos", {
    id,
    bike_id: bikeId,
    filename: id + ".webp",
    is_cover: false,
    ...given(overrides),
  });
}

/** A number as PostgreSQL's numeric columns are read; `undefined` stays unset. */
const numeric = (value: number | null | undefined) =>
  value === undefined || value === null ? value : String(value);

/** The categories of a complete build, one component each. */
export const completeBuildCategories = [
  "Рама",
  "Вилка",
  "Тормоза",
  "Колёса",
  "Руль",
  "Седло",
  "Педали",
  "Цепь",
] as const;

/**
 * A public bike that is finished the way the showcase wants it: a story, a
 * cover photo and a component in each main category.
 */
export async function completeBikeRow(
  q: Queryable,
  ownerId: string,
  overrides: BikeOverrides = {},
): Promise<BikeRow> {
  const bike = await bikeRow(q, ownerId, {
    name: "Touring",
    brand: "Cube",
    model: "Travel",
    category: "road",
    description: "Public story",
    ...given(overrides),
  });
  await photoRow(q, bike.id, { is_cover: true });
  for (const category of completeBuildCategories)
    await componentRow(q, bike.id, { category, name: "Shimano " + category });
  return bike;
}
