"use client";

// The device's approximate position, asked only by a click on «Использовать
// моё местоположение» (#370). Low accuracy on purpose: a district is enough,
// and the answer is rounded before it goes anywhere. A refusal, a missing API
// or a timeout is a reason, not an error: the form goes on by hand.
export type PositionFailure =
  "unsupported" | "denied" | "unavailable" | "timeout";
export class PositionError extends Error {
  reason: PositionFailure;
  constructor(reason: PositionFailure) {
    super(reason);
    this.reason = reason;
  }
}
export const positionMessages: Record<PositionFailure, string> = {
  unsupported:
    "Это устройство не отдаёт местоположение. Найдите место по названию или отметьте область на карте.",
  denied:
    "Доступ к местоположению не получен. Найдите место по названию или отметьте область на карте — форма сохранена.",
  unavailable:
    "Не удалось определить местоположение. Найдите место по названию или отметьте область на карте.",
  timeout:
    "Местоположение не определилось вовремя. Повторите или найдите место по названию.",
};
export function currentPosition(): Promise<{
  longitude: number;
  latitude: number;
}> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator))
      return reject(new PositionError("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
        }),
      (error) =>
        reject(
          new PositionError(
            error.code === error.PERMISSION_DENIED
              ? "denied"
              : error.code === error.TIMEOUT
                ? "timeout"
                : "unavailable",
          ),
        ),
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 },
    );
  });
}
