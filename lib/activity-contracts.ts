import type { z } from "zod";
import type { BikeRow } from "./database-rows.ts";
import type {
  syncItem,
  verifyRwgpsWebhook,
  rwgpsConfig,
  rwgpsTripSchema,
} from "./rwgps.ts";
import type { transaction } from "./db.ts";

export type ActivityTransaction = typeof transaction;
export type RwgpsConfig = NonNullable<ReturnType<typeof rwgpsConfig>>;
export type RwgpsTrip = z.infer<typeof rwgpsTripSchema>;
export type SyncItem = z.infer<typeof syncItem>;
export type ActivityNotification = ReturnType<
  typeof verifyRwgpsWebhook
>[number];
export type ActivityBike = Pick<
  BikeRow,
  "id" | "category" | "classification" | "is_former"
>;
export interface ActivityConnectionRow {
  id: string;
  owner_id: string;
  provider: string;
  external_user_id: string;
  credentials: string;
  generation: string;
  bike_id: string | null;
  import_since: Date;
  cursor_at: Date | null;
  last_sync_at: Date | null;
  last_error: string | null;
  created_at: Date;
}
export interface ActivityJobRow {
  id: string;
  connection_id: string;
  external_id: string;
  action: "sync" | "upsert" | "deleted";
  event_at: Date;
  revision: string;
  attempts: number;
  next_attempt_at: Date;
}
export interface ExternalActivityRow {
  id: string;
  owner_id: string;
  provider: string;
  external_user_id: string;
  external_id: string;
  ride_id: string | null;
  status:
    | "pending"
    | "synced"
    | "ignored"
    | "waiting_bike"
    | "error"
    | "deleted"
    | "local_deleted"
    | "duplicate";
  metadata: {
    name?: string;
    activityType?: string | null;
    startedAt?: string | null;
  };
  last_error: string | null;
  event_at: Date;
  updated_at: Date;
}
export interface ActivityRevocationRow {
  id: string;
  provider: string;
  credentials: string;
  owner_id: string;
  external_user_id: string;
  attempts: number;
  next_attempt_at: Date;
}
