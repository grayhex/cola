import { defaultEmojis, defaultArticleTopics } from "./ui-emoji.js";
import {
  appearanceDefaults,
  heroDefaults,
  backgroundDefaults,
} from "./theme.js";
import { mapDefaults } from "./map-settings.js";
import { aboutDefaults } from "./about-content.js";
import { defaultScoring } from "./bike-score.js";
import { defaultGroups, defaultBlocks } from "./garage-layout.js";
import {
  categories,
  models,
  parts,
  partCategories,
  manufacturers,
} from "./catalog.js";
export const defaultSettings = {
  emojis: defaultEmojis,
  articleTopics: defaultArticleTopics,
  appearance: appearanceDefaults,
  ...heroDefaults,
  ...backgroundDefaults,
  showAboutStats: true,
  about: aboutDefaults,
  map: mapDefaults,
  rideListMode: "auto",
  rideMapView: "map",
  mapScrollZoom: false,
  aboutGuideImageId: null,
  aboutTechnologyImageId: null,
  scoring: defaultScoring,
  bikeLayout: "balanced",
  showMileage: false,
  componentsExpanded: false,
  appVersionLabel: "",
  parserVersionLabel: "",
  mtbImageId: null,
  roadImageId: null,
  gravelImageId: null,
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
  showcaseTitle: "Наши велосипеды",
  siteDescription: "Витрина велосипедов, комплектаций и авторских сборок.",
  faviconId: null,
  demoImageId: null,
  wizardLinkLabel: "Распознать по странице магазина",
  wizardManualLabel: "Заполнить вручную",
  copy: {},
  detailBlocks: defaultBlocks,
  summaryFields: {
    description: true,
    metadata: true,
    manufacturer: true,
    price: true,
  },
};
import { defaultPurposes, defaultAliases } from "./experience-catalog.js";
export const defaultCatalog = {
  purposes: defaultPurposes,
  aliases: defaultAliases,
  sizes: ["XS", "S", "M", "L", "XL"],
  categories,
  models,
  parts,
  partCategories,
  manufacturers,
  icons: {},
  componentGroups: defaultGroups,
};
