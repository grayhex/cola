// Shared presentation/policy for ownership history; not a classification facet.
export const formerBikeRideMessage =
  "Для бывшего велосипеда нельзя добавлять или публиковать покатушки. Выберите текущий велосипед.";

export function isFormerBike(bike: { is_former?: boolean } | null | undefined) {
  return bike?.is_former === true;
}

export function rideBikeStateError(
  bike: {
    id: string;
    is_former?: boolean;
  },
  existingRide: {
    bike_id: string;
    is_public: boolean;
  } | null = null,
  publish = false,
) {
  if (!isFormerBike(bike)) return null;
  // Existing history remains editable (including privacy), but may not be
  // moved onto a former bike or newly published after it became former.
  if (
    !existingRide ||
    existingRide.bike_id !== bike.id ||
    (publish && !existingRide.is_public)
  )
    return formerBikeRideMessage;
  return null;
}

export function selectableRideBikes<
  T extends { id: string; is_former?: boolean },
>(bikes: T[], existingBikeId: string | null = null) {
  return bikes.filter(
    (bike) => !isFormerBike(bike) || bike.id === existingBikeId,
  );
}
