// Shared presentation/policy for ownership history; not a classification facet.
export const formerBikeRideMessage =
  "Для бывшего велосипеда нельзя добавлять или публиковать покатушки. Выберите текущий велосипед.";

export function isFormerBike(bike) {
  return bike?.is_former === true;
}

export function rideBikeStateError(bike, existingRide = null, publish = false) {
  if (!isFormerBike(bike)) return null;
  // Existing history remains editable (including privacy), but may not be
  // moved onto a former bike or newly published after it became former.
  if (
    !existingRide ||
    existingRide.bike_id !== bike.id ||
    (publish && !existingRide.is_public)
  ) return formerBikeRideMessage;
  return null;
}

export function selectableRideBikes(bikes, existingBikeId = null) {
  return bikes.filter((bike) => !isFormerBike(bike) || bike.id === existingBikeId);
}
