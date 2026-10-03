// Types of the track fixtures in ride-fixtures.js (shared with HTTP and
// browser tests, which stay JS): a point is [lon, lat, seconds, elevation];
// seconds and elevation have defaults, a FIT point without GPS has lon null.
export type TrackPoint = readonly [
  lon: number | null,
  lat: number,
  seconds?: number,
  elevation?: number,
];
export type GpxPoint = readonly [
  lon: number,
  lat: number,
  seconds?: number,
  elevation?: number,
];
export function gpx(
  segments: readonly (readonly GpxPoint[])[],
  options?: { time?: boolean; elevation?: boolean; name?: string },
): Buffer;
export const loop: [number, number, number, number][];
export function crc16(bytes: readonly number[]): number;
export function fit(
  points: readonly TrackPoint[],
  options?: {
    sensors?: boolean;
    bigEndian?: boolean;
    compressed?: boolean;
    developer?: boolean;
    headerSize?: number;
  },
): Buffer;
export function tcx(
  points: readonly TrackPoint[],
  options?: { sensors?: boolean; course?: boolean; name?: string },
): Buffer;
