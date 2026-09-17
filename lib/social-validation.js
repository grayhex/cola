import { z } from "zod";
import { defaultScoring } from "./bike-score.js";
const adjustment = z.object({
  reference: z.number().positive().max(999999999),
  pointsPer10Percent: z.number().min(-100).max(100),
}).strict();
export const scoringInput = z.object({
  base: z.object({ mtb: z.number().min(0).max(100), road: z.number().min(0).max(100), gravel: z.number().min(0).max(100) }).strict(),
  componentTarget: z.number().int().min(1).max(200),
  photoPoints: z.number().min(0).max(100),
  weight: adjustment,
  price: adjustment,
  rules: z.array(z.object({
    groupId: z.string().regex(/^[a-z0-9_-]{0,50}$/),
    category: z.string().trim().max(60),
    match: z.string().trim().min(1).max(150).refine(s => /[\p{L}\p{N}]/u.test(s)),
    points: z.number().min(-100).max(100),
  }).strict()).max(100),
}).strict().default(defaultScoring);
export const profileInput = z.object({
  name: z.string().trim().min(1).max(60),
  preferences: z.object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    bikeLayout: z.enum(["dense", "balanced", "spacious"]).optional(),
    font: z.enum(["manrope", "system", "arial", "georgia", "mono"]).optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    showMileage: z.boolean().optional(),
  }).strict(),
}).strict();
