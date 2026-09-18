import { z } from "zod";
import { defaultScoring } from "./bike-score.js";
const adjustment = z
  .object({
    reference: z.number().positive().max(999999999),
    pointsPer10Percent: z.number().min(-100).max(100),
  })
  .strict();
export const scoringInput = z
  .object({
    base: z
      .object({
        mtb: z.number().min(0).max(100),
        road: z.number().min(0).max(100),
        gravel: z.number().min(0).max(100),
      })
      .strict(),
    componentTarget: z.number().int().min(1).max(200),
    photoPoints: z.number().min(0).max(100),
    weight: adjustment,
    price: adjustment,
    rules: z
      .array(
        z
          .object({
            groupId: z.string().regex(/^[a-z0-9_-]{0,50}$/),
            category: z.string().trim().max(60),
            match: z
              .string()
              .trim()
              .min(1)
              .max(150)
              .refine((s) => /[\p{L}\p{N}]/u.test(s)),
            points: z.number().min(-100).max(100),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .default(defaultScoring);
export const profileInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    preferences: z
      .object({
        theme: z.enum(["light", "dark", "system"]).optional(),
        bikeLayout: z.enum(["dense", "balanced", "spacious"]).optional(),
        font: z
          .enum(["manrope", "system", "arial", "georgia", "mono"])
          .optional(),
        accent: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        showMileage: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export const reservedUsernames = new Set([
  "admin",
  "api",
  "account",
  "login",
  "logout",
  "register",
  "settings",
  "b",
  "u",
  "me",
  "social",
  "profiles",
  "assets",
  "avatars",
  "health",
  "ready",
  "status",
  "support",
  "help",
  "about",
  "system",
  "colabike",
]);
export const usernameInput = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9._-]+$/)
  .refine((v) => !reservedUsernames.has(v), "Это имя зарезервировано");
export const publicProfileInput = z
  .object({
    username: usernameInput,
    name: z.string().trim().min(1).max(60),
    bio: z.string().trim().max(500),
    location: z.string().trim().max(100),
  })
  .strict();
export const preferencesInput = z
  .object({ preferences: profileInput.shape.preferences })
  .strict();
export const socialPage = z.coerce.number().int().min(1).max(10000);
