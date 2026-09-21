import { z } from "zod";
import type { Reason } from "./context.js";
export const querySchema = z
  .object({
    brand: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(100),
    trim: z.string().trim().max(100).nullable().default(null),
    year: z.number().int().min(1900).max(2100),
  })
  .strict();
export const requestSchema = querySchema
  .extend({
    candidateId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type BikeQuery = z.infer<typeof querySchema>;
export const componentTypes = [
  "frame",
  "fork",
  "rear_shock",
  "rear_derailleur",
  "front_derailleur",
  "shifter",
  "left_shifter",
  "right_shifter",
  "crankset",
  "bottom_bracket",
  "chainring",
  "cassette",
  "freewheel",
  "chain",
  "belt",
  "rear_sprocket",
  "brake",
  "front_brake",
  "rear_brake",
  "brake_lever",
  "front_rotor",
  "rear_rotor",
  "front_hub",
  "hub",
  "spokes",
  "inner_tube",
  "rear_hub",
  "rim",
  "front_rim",
  "rear_rim",
  "wheel",
  "front_wheel",
  "rear_wheel",
  "front_tire",
  "rear_tire",
  "tire",
  "handlebar",
  "stem",
  "grips",
  "bar_tape",
  "headset",
  "seatpost",
  "dropper_post",
  "saddle",
  "seat_clamp",
  "pedals",
  "front_light",
  "rear_light",
  "mudguards",
  "rack",
  "kickstand",
  "bell",
  "motor",
  "battery",
  "display",
  "charger",
  "power_meter",
  "other",
] as const;
export type ComponentType = (typeof componentTypes)[number];
export interface BikeComponent {
  provenance?: {
    sourceUrl: string;
    strategy: string;
    confidence: number;
    rawLabel: string;
    rawValue: string;
  };
  type: ComponentType;
  position?: string | null;
  brand?: string | null;
  family?: string | null;
  model?: string | null;
  description: string;
  attributes: Record<string, string | number | boolean>;
  raw: { label: string; value: string };
}
export interface BikeCandidate {
  thumbnailId?: string;
  sourceHost?: string;
  selectable?: boolean;
  candidateId?: string;
  brand: string;
  canonicalName: string;
  url: string;
  year: number | null;
  manufacturerProductId?: string;
  score?: number;
}
export interface SourceDocument {
  contentType?: string;
  charset?: string;
  byteLength?: number;
  url: string;
  body: string;
  fetchedAt: string;
  hash: string;
}
export interface ParsedBike {
  quality?: ExtractionQuality;
  suggestedMetadata?: Record<string, string | number>;
  unknownFields?: RawField[];
  warnings?: Reason[];
  canonicalName: string;
  year: number | null;
  manufacturerProductId?: string;
  rawSpecification: Record<string, string>;
  components: BikeComponent[];
}
export interface Source {
  extractorVersion?: number;
  manufacturer: string;
  url: string;
  fetchedAt: string;
  adapter: string;
  adapterVersion: number;
}
export interface Resolved {
  thumbnailId?: string;
  quality?: ExtractionQuality;
  suggestedMetadata?: Record<string, string | number>;
  unknownFields?: RawField[];
  warnings?: Reason[];
  status: "resolved";
  manualSelection?: boolean;
  sourceYear?: number | null;
  query: BikeQuery;
  bike: BikeQuery & {
    canonicalName: string;
    manufacturerProductId?: string;
    sourceUrl: string;
  };
  confidence: number;
  components: BikeComponent[];
  rawSpecification: Record<string, string>;
  source: Source;
  cached: boolean;
}
export type ResolveResult =
  | Resolved
  | {
      status: "ambiguous";
      query: BikeQuery;
      candidates: BikeCandidate[];
      cached: boolean;
    }
  | {
      status:
        | "not_found"
        | "unsupported_brand"
        | "upstream_unavailable"
        | "parse_error";
      query: BikeQuery;
      brand: string;
      retryable: boolean;
      cached: boolean;
      message?: string;
      reason?: Reason;
    };
export interface BikeManufacturerAdapter {
  readonly id: string;
  readonly brand: string;
  readonly aliases: string[];
  readonly allowedDomains: string[];
  readonly adapterVersion: number;
  discover(query: BikeQuery): Promise<BikeCandidate[]>;
  fetch(candidate: BikeCandidate): Promise<SourceDocument>;
  parse(document: SourceDocument, query: BikeQuery): Promise<ParsedBike>;
}
export class ResolverError extends Error {
  constructor(
    public status: "upstream_unavailable" | "parse_error",
    message: string,
    public retryable = false,
    public reason: Reason = status === "parse_error"
      ? "spec_fields_not_found"
      : "connection_failed",
  ) {
    super(message);
  }
}
export interface RawField {
  label: string;
  value: string;
  section?: string;
  strategy: string;
  confidence: number;
}
export interface ExtractionQuality {
  level: "complete" | "partial";
  totalFields: number;
  recognizedComponents: number;
  unknownFields: number;
  coverage: number;
  strategies: string[];
}
