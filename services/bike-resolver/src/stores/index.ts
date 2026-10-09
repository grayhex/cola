import { VeloSkladStore } from "./velosklad.js";
import { BikeinnStore } from "./bikeinn.js";
import { AlltricksStore } from "./alltricks.js";
import { Bike24Store } from "./bike24.js";
import {
  TrialSportStore,
  VeloStranaStore,
  VeloDriveStore,
  AlienBikeStore,
} from "./russian.js";
import type { RetailStore } from "./types.js";

export type { RetailStore, StoreEnv } from "./types.js";
// Registry order is the order stores are reported in.
export const createStores = (): RetailStore[] => [
  new VeloSkladStore(),
  new BikeinnStore(),
  new AlltricksStore(),
  new Bike24Store(),
  new TrialSportStore(),
  new VeloStranaStore(),
  new VeloDriveStore(),
  new AlienBikeStore(),
];
