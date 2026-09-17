import { z } from "zod";
const text = (max) => z.string().trim().max(max);
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
  name: text(60).min(1).optional(),
});
export const safeLink = z.union([
  z.literal(""),
  z
    .url()
    .max(2048)
    .refine((v) => {
      const u = new URL(v);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    }, "Нужна HTTP/HTTPS ссылка"),
]);
export const bikeInput = z.object({
  manufacturer_url: safeLink.default(""),
  price: z.number().min(0).max(999999999).nullable().default(null),
  show_bike_price: z.boolean().default(false),
  show_component_prices: z.boolean().default(false),
  show_accessory_prices: z.boolean().default(false),
  name: text(100).min(1),
  brand: text(60),
  model: text(100),
  trim: text(100).default(""),
  year: z.number().int().min(1900).max(2100),
  category: z.enum(["gravel", "mtb", "road"]),
  description: text(2000),
  color: text(60),
  size: text(30),
  weight: z.number().positive().max(100).nullable(),
});
export const componentInput = z.object({
  url: safeLink.default(""),
  group_id: z
    .string()
    .regex(/^[a-z0-9_-]{0,50}$/)
    .default(""),
  section: z.enum(["build", "accessories"]),
  category: text(60).min(1),
  name: text(150).min(1),
  notes: text(500),
  price: z.number().min(0).max(999999999).nullable(),
});
export const uuid = z.uuid();
export function publicBike(bike) {
  const { owner_id, ...safe } = bike;
  return {
    ...safe,
    ...(!bike.show_bike_price ? { price: undefined } : {}),
    components: bike.components.map(({ price, ...part }) =>
      (
        part.section === "build"
          ? bike.show_component_prices
          : bike.show_accessory_prices
      )
        ? { ...part, price }
        : part,
    ),
  };
}
