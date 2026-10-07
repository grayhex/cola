import type {
  BikeCandidate,
  ExtractionQuality,
  ResolveResult,
  Resolved,
} from "../../services/bike-resolver/src/domain.ts";
import {
  bikeCategories,
  bikeSubtypes,
  constructionLabels,
  suspensionLabels,
  useLabels,
} from "../bike-classification.ts";
import type { SiteDefinition } from "../contracts.ts";
import { factoryEntries } from "../factory-components.ts";
import type { z } from "zod";
import type {
  bikeResolutionBuildSchema,
  bikeResolutionCandidateSchema,
  bikeResolutionSchema,
  siteCatalogSchema,
} from "./schemas.ts";

// The answers of the wizard in the API's words (#57): the site's dictionaries
// and the Resolver's result. Pure functions, so they are tested without a
// server. The Resolver's own shape stops here: a client is given the draft
// build the site would show, never raw specification fields to parse.

export type SiteCatalogDto = z.infer<typeof siteCatalogSchema>;
export type BikeResolutionDto = z.infer<typeof bikeResolutionSchema>;
type CandidateDto = z.infer<typeof bikeResolutionCandidateSchema>;
type BuildDto = z.infer<typeof bikeResolutionBuildSchema>;

/** The most the site lets a person choose as "uses" of a bicycle. */
export const MAX_USES = 3;

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([key, name]) => ({ key, name }));

/**
 * The site's dictionaries. The type of a bicycle is described by the code of
 * the site (`bike-classification.ts`), the category names, models, sizes, parts
 * and groups by the catalog an administrator edits. Duplicates are removed, the
 * order of the site is kept.
 */
export function toSiteCatalog(site: SiteDefinition): SiteCatalogDto {
  const catalog = site.catalog;
  const brands = new Map<string, Set<string>>();
  for (const group of Object.values(catalog.models))
    for (const [brand, models] of Object.entries(group)) {
      const known = brands.get(brand) ?? new Set<string>();
      for (const model of models) known.add(model);
      brands.set(brand, known);
    }
  return {
    version: site.catalogVersion,
    classification: {
      categories: Object.entries(bikeCategories).map(([key, fallback]) => ({
        key,
        name:
          catalog.categories[key as keyof typeof catalog.categories] ??
          fallback,
        subtypes: options(bikeSubtypes[key] ?? {}),
      })),
      suspensions: options(suspensionLabels),
      constructions: options(constructionLabels),
      uses: options(useLabels),
      maxUses: MAX_USES,
    },
    purposes: catalog.purposes
      .filter((purpose) => purpose.enabled)
      .map(({ id, name }) => ({ id, name })),
    brands: [...brands].map(([name, models]) => ({
      name,
      models: [...models],
    })),
    manufacturers: [...new Set(catalog.manufacturers)],
    sizes: [...new Set(catalog.sizes)],
    components: {
      groups: catalog.componentGroups.map(({ id, name, categories }) => ({
        id,
        name,
        categories: [...categories],
      })),
      buildCategories: [...new Set(catalog.partCategories.build)],
      accessoryCategories: [...new Set(catalog.partCategories.accessories)],
      names: Object.entries(catalog.parts).map(([category, names]) => ({
        category,
        names: [...new Set(names)],
      })),
    },
  };
}

const quality = (value: ExtractionQuality | undefined) =>
  value
    ? {
        level: value.level,
        recognizedComponents: value.recognizedComponents,
        coverage: value.coverage,
      }
    : null;

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
};

function toCandidate(candidate: BikeCandidate): CandidateDto {
  const level = candidate.quality;
  return {
    candidateId: candidate.candidateId ?? null,
    name: candidate.canonicalName,
    brand: candidate.brand,
    year: candidate.year,
    url: candidate.url,
    sourceHost: candidate.sourceHost ?? hostOf(candidate.url),
    sourceKind: candidate.kind ?? null,
    sourceName: candidate.storeName ?? null,
    drivetrain: candidate.drivetrain ?? null,
    quality: level
      ? {
          level: level.level,
          recognizedComponents: level.recognizedComponents,
          coverage: level.coverage,
        }
      : null,
    warnings: [...(candidate.warnings ?? [])],
    selectable: candidate.selectable === true,
    otherHosts: [
      ...new Set((candidate.alternatives ?? []).map((a) => a.sourceHost)),
    ],
  };
}

/**
 * What the site shows as the "build found" and puts into the editable list:
 * the same entries (`factoryEntries`), in the groups of the catalog.
 */
function toBuild(result: Resolved, site: SiteDefinition): BuildDto {
  const groups = site.catalog.componentGroups;
  const warnings = [...(result.warnings ?? [])];
  const query = result.query;
  const suggested = result.suggestedMetadata ?? {};
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    name: result.bike.canonicalName,
    brand: result.bike.brand,
    model: result.bike.model,
    trim: result.bike.trim ?? null,
    year: result.bike.year ?? null,
    sourceYear: result.sourceYear ?? null,
    sourceUrl: result.source.url,
    sourceHost: hostOf(result.source.url),
    sourceKind: result.source.kind ?? null,
    sourceName: result.source.manufacturer || null,
    manualSelection: result.manualSelection === true,
    identityMismatch: warnings.includes("identity_mismatch"),
    yearMismatch:
      query.year != null &&
      result.sourceYear != null &&
      result.sourceYear !== query.year,
    warnings,
    quality: quality(result.quality),
    components: factoryEntries(result).map(({ value }) => ({
      section: value.section,
      category: value.category,
      name: value.name,
      notes: value.notes,
      groupId:
        groups.find((group) => group.categories.includes(value.category))?.id ??
        "",
    })),
    unrecognized: (result.unknownFields ?? []).map((field) => ({
      label: String(field.label ?? ""),
      value: String(field.value ?? ""),
    })),
    suggested: {
      weightKg:
        typeof suggested.weight === "number" && suggested.weight > 0
          ? suggested.weight
          : null,
      color: text(suggested.color),
      sizes: text(suggested.sizes),
      wheelSize: text(suggested.wheelSize),
      manufacturerUrl: text(suggested.manufacturerUrl),
    },
  };
}

/**
 * The result of a search as the API answers it. `preview` is the stored
 * preview of a resolved build (null otherwise): the id that creation names to
 * keep the source and the factory specification.
 */
export function toBikeResolution(
  result: ResolveResult,
  site: SiteDefinition,
  preview: { id: string; expiresAt: string } | null = null,
): BikeResolutionDto {
  const base = {
    query: {
      brand: result.query.brand,
      model: result.query.model,
      trim: result.query.trim ?? null,
      year: result.query.year ?? null,
    },
    cached: result.cached === true,
    previewId: null,
    previewExpiresAt: null,
    candidates: [],
    build: null,
    sourcesChecked: null,
  };
  const report = (search: {
    complete: boolean;
    sources: { status: string }[];
  }) => {
    const asked = search.sources.filter((s) => s.status !== "disabled");
    return {
      asked: asked.length,
      answered: asked.filter((s) => s.status === "ok" || s.status === "empty")
        .length,
      complete: search.complete,
    };
  };
  if (result.status === "resolved")
    return {
      ...base,
      status: "resolved",
      retryable: false,
      reason: null,
      previewId: preview?.id ?? null,
      previewExpiresAt: preview?.expiresAt ?? null,
      build: toBuild(result, site),
    };
  if (result.status === "ambiguous")
    return {
      ...base,
      status: "ambiguous",
      retryable: false,
      reason: null,
      candidates: result.candidates.map(toCandidate),
      sourcesChecked: result.search ? report(result.search) : null,
    };
  return {
    ...base,
    status: result.status,
    retryable: result.retryable === true,
    reason: result.reason ?? null,
    sourcesChecked: result.search ? report(result.search) : null,
  };
}
