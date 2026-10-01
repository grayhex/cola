import type * as React from "react";
import type { z } from "zod";
import type { bikeInput, componentInput } from "../../../lib/validation.ts";
import type {
  BikeDto,
  PublicComponent,
  PublicPhoto,
} from "../../../lib/contracts.ts";
export type PartSection = "build" | "accessories";
// Form payloads can retain a legacy nullable classification until server validation.
// Draft controls hold text; submission converts the numeric fields.
export type BikeFormData = Omit<z.input<typeof bikeInput>, "classification"> & {
  classification?: z.input<typeof bikeInput>["classification"] | null;
} & {
  importFactory?: boolean;
  factoryCandidateId?: string;
  factorySourceUrl?: string;
  initializeCurrent?: boolean;
};
export type BikeDraft = Omit<BikeFormData, "year" | "weight" | "price"> & {
  year: number | string;
  weight: number | string;
  price?: number | string;
  factory_spec?: BikeDto["factory_spec"];
};
export type PartFormData = z.input<typeof componentInput>;
export type PartDraft = Omit<PartFormData, "price"> & {
  price: number | string;
};
export type GarageModalState =
  | { type: "auth"; mode: "login" | "register" }
  | { type: "bike"; bike?: BikeDto }
  | { type: "part"; section: PartSection; part?: PublicComponent }
  | { type: "deletePart"; part: PublicComponent }
  | { type: "deletePhoto"; photo: PublicPhoto }
  | { type: "profile" | "share" | "photoSearch" | "photoView" | "deleteBike" };
export type ModalSetter = React.Dispatch<
  React.SetStateAction<GarageModalState | null>
>;
export type BikeSetter = React.Dispatch<React.SetStateAction<BikeDto | null>>;
export type PhotoSetter = React.Dispatch<
  React.SetStateAction<PublicPhoto | null>
>;
export type Run = (work: () => Promise<unknown>) => Promise<void>;
export type MainElement = "main" | "section";
