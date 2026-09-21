import { Bike } from "./icons.jsx";
export default function BikeCategoryIcon({ label, size = 28 }) {
  return (
    <Bike
      size={size}
      className="bike-category-graphic"
      aria-label={label}
      aria-hidden={!label}
    />
  );
}
