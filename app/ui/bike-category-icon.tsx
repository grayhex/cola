import { Bike } from "./icons.tsx";
export default function BikeCategoryIcon({
  label,
  size = 28,
}: {
  label?: string;
  size?: number;
}) {
  return (
    <Bike
      size={size}
      className="bike-category-graphic"
      aria-label={label}
      aria-hidden={!label}
    />
  );
}
