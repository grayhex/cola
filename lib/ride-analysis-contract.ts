export const ANALYSIS_VERSION = 1;
export const ANALYSIS_LIMIT = 2048;
export const analysisChannels = [
  "elevationM",
  "speedMps",
  "gradePct",
  "hrBpm",
  "cadenceRpm",
  "powerW",
] as const;
export type AnalysisChannel = (typeof analysisChannels)[number];
export interface AnalysisPoint {
  coord: number[];
  distanceM: number | null;
  elapsedS: number | null;
  elevationM: number | null;
  speedMps: number | null;
  gradePct: number | null;
  hrBpm?: number | null;
  cadenceRpm?: number | null;
  powerW?: number | null;
  timestampS?: number | null;
  gaps: number;
}
export interface AnalysisSeries {
  version: number;
  visibility: string;
  sourcePointCount: number;
  pointCount: number;
  downsampled: boolean;
  segments: AnalysisPoint[][];
}
