import { GtAdapter } from "./gt.js";
import { CubeAdapter } from "./cube.js";
import { SpecializedAdapter } from "./specialized.js";
import { CanyonAdapter } from "./canyon.js";
import { TrekAdapter } from "./trek.js";
import { GiantAdapter } from "./giant.js";
import { CannondaleAdapter } from "./cannondale.js";
import { ScottAdapter } from "./scott.js";
import { OrbeaAdapter } from "./orbea.js";
import { MeridaAdapter } from "./merida.js";
import { BmcAdapter } from "./bmc.js";
import type { ManufacturerHttpClient } from "../http.js";
export const createAdapters = (http: ManufacturerHttpClient) =>
  [
    CubeAdapter,
    SpecializedAdapter,
    CanyonAdapter,
    TrekAdapter,
    GiantAdapter,
    CannondaleAdapter,
    ScottAdapter,
    OrbeaAdapter,
    MeridaAdapter,
    BmcAdapter,
    GtAdapter,
  ].map((Adapter) => new Adapter(http));
