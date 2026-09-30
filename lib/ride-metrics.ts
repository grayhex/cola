// JSON metrics shared by device imports and ride DTOs. Text/flags are retained
// only for the Garmin display fields; quantities used by the backend stay numeric.
export interface RideMetrics {
  [key: string]: string | number | boolean | null | undefined;
  distanceM?: number;
  timerTimeS?: number;
  elapsedTimeS?: number | null;
  movingTimeS?: number | null;
  avgSpeedMps?: number | null;
  elevationGainM?: number | null;
  activityDate?: string;
  activityType?: string | null;
  startedAt?: string | null;
}
