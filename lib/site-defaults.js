import { defaultGroups, defaultBlocks } from "./garage-layout.js";
import {
  categories,
  models,
  parts,
  partCategories,
  manufacturers,
} from "./catalog.js";
export const defaultSettings = {
  theme: "light",
  bikeLayout: "balanced",
  showMileage: false,
  mtbImageId: null,
  roadImageId: null,
  gravelImageId: null,
  font: "manrope",
  accent: "#e7482f",
  radius: 12,
  summaryPosition: "right",
  detailOrder: "photo-first",
  photoMode: "natural",
  photoRatio: "4/3",
  textAlign: "left",
  desktopColumns: 3,
  showTagline: true,
  showDemo: true,
  registrationOpen: true,
  siteName: "ColaBike",
  siteDescription: "Личный гараж, комплектация и аксессуары вашего велосипеда.",
  logoId: null,
  faviconId: null,
  demoImageId: null,
  garageImageId: null,
  copy: {},
  detailBlocks: defaultBlocks,
  summaryFields: {
    description: true,
    metadata: true,
    manufacturer: true,
    price: true,
  },
};
export const defaultCatalog = {
  categories,
  models,
  parts,
  partCategories,
  manufacturers,
  icons: {},
  componentGroups: defaultGroups,
};
export const fontStacks = {
  manrope: "Manrope, Arial, sans-serif",
  system:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  arial: "Arial, Helvetica, sans-serif",
  georgia: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", monospace',
};
