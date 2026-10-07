import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {
  BikeCandidate,
  ResolveResult,
  Resolved,
} from "../services/bike-resolver/src/domain.ts";
import {
  bikeCategories,
  bikeSubtypes,
  useLabels,
} from "../lib/bike-classification.ts";
import { needsIdentityConfirmation } from "../lib/bike-wizard.ts";
import type { SiteDefinition } from "../lib/contracts.ts";
import { defaultCatalog, defaultSettings } from "../lib/site-defaults.ts";
import {
  bikeResolutionRequestSchema,
  bikeResolutionSchema,
  bikeWizardRequestSchema,
  siteCatalogSchema,
} from "../lib/api-v1/schemas.ts";
import {
  MAX_USES,
  toBikeResolution,
  toSiteCatalog,
} from "../lib/api-v1/wizard-mappers.ts";
import { present } from "./support/assertions.ts";

// API v1, the wizard of a new bicycle (#57 of the Android client): the
// dictionaries of the site, the request and the answer of the search of a build,
// and the request of the creation. What a client is given is shaped here, so
// these tests are about what it can rely on. The server end to end is
// tests/api-v1-wizard-http.js.

const site = (overrides: Partial<SiteDefinition["catalog"]> = {}) =>
  ({
    settings: defaultSettings,
    catalog: { ...defaultCatalog, ...overrides },
    settingsVersion: 3,
    catalogVersion: 7,
  }) satisfies SiteDefinition;

// ---- the dictionaries --------------------------------------------------------

test("catalog: the site's dictionaries in the API's words, as the schema says", () => {
  const catalog = toSiteCatalog(site());
  assert.deepEqual(siteCatalogSchema.parse(catalog), catalog);
  assert.equal(catalog.version, 7);
  assert.deepEqual(
    catalog.classification.categories.map((c) => c.key),
    Object.keys(bikeCategories),
  );
  for (const category of catalog.classification.categories)
    assert.deepEqual(
      category.subtypes.map((s) => s.key),
      Object.keys(bikeSubtypes[category.key]),
      "a category has its own subtypes and no others: " + category.key,
    );
  assert.deepEqual(
    catalog.classification.uses.map((u) => u.key),
    Object.keys(useLabels),
  );
  assert.equal(catalog.classification.maxUses, MAX_USES);
  assert.deepEqual(catalog.sizes, defaultCatalog.sizes);
  assert.deepEqual(
    catalog.components.groups.map((g) => g.id),
    defaultCatalog.componentGroups.map((g) => g.id),
  );
});

test("catalog: what an administrator edits reaches the clients, and nothing is repeated", () => {
  const catalog = toSiteCatalog(
    site({
      categories: {
        ...defaultCatalog.categories,
        ...({ mtb: "Горные" } as Record<string, string>),
      },
      purposes: [
        { id: "city", name: "Город", enabled: true },
        { id: "sport", name: "Спорт", enabled: false },
      ],
      sizes: ["S", "M", "S"],
    }),
  );
  assert.equal(
    present(catalog.classification.categories.find((c) => c.key === "mtb"))
      .name,
    "Горные",
  );
  assert.deepEqual(catalog.purposes, [{ id: "city", name: "Город" }]);
  assert.deepEqual(catalog.sizes, ["S", "M"]);
  // A brand that is in several kinds of the site's list is one brand, its models once.
  const canyon = catalog.brands.filter((b) => b.name === "Canyon");
  assert.equal(canyon.length, 1);
  const models = present(canyon[0]).models;
  assert.equal(new Set(models).size, models.length);
  assert.ok(models.includes("Grizl") && models.includes("Neuron"));
});

test("catalog: the same dictionaries are the same bytes, so the validator holds", () => {
  assert.equal(
    JSON.stringify(toSiteCatalog(site())),
    JSON.stringify(toSiteCatalog(site())),
  );
  assert.notEqual(
    JSON.stringify(toSiteCatalog(site())),
    JSON.stringify(toSiteCatalog(site({ sizes: ["XS"] }))),
  );
});

// ---- the request of a search ---------------------------------------------------

test("resolution request: one way to ask, strict fields, only http(s) pages", () => {
  const base = { brand: "Giant", model: "Contend" };
  assert.ok(bikeResolutionRequestSchema.safeParse(base).success);
  assert.ok(
    bikeResolutionRequestSchema.safeParse({
      ...base,
      trim: null,
      year: 2024,
      chooseCandidates: true,
    }).success,
  );
  assert.ok(
    bikeResolutionRequestSchema.safeParse({
      ...base,
      candidateId: "a".repeat(64),
    }).success,
  );
  assert.ok(
    bikeResolutionRequestSchema.safeParse({
      ...base,
      sourceUrl: "https://shop.example/bike",
    }).success,
  );
  for (const bad of [
    { ...base, sourceUrl: "ftp://shop.example/bike" },
    { ...base, sourceUrl: "javascript:alert(1)" },
    { ...base, candidateId: "short" },
    { ...base, year: 1800 },
    { ...base, model: "" },
    { ...base, unknown: 1 },
    // Two ways at once: the page, the chosen variant, a new search.
    {
      ...base,
      sourceUrl: "https://shop.example/bike",
      candidateId: "a".repeat(64),
    },
    { ...base, candidateId: "a".repeat(64), chooseCandidates: true },
  ])
    assert.equal(
      bikeResolutionRequestSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    );
});

// ---- the answer of a search ----------------------------------------------------

const query = { brand: "Giant", model: "Contend", trim: "AR 1", year: 2024 };

function resolved(overrides: Partial<Resolved> = {}): Resolved {
  return {
    status: "resolved",
    query,
    bike: {
      ...query,
      canonicalName: "Giant Contend AR 1",
      sourceUrl: "https://www.giant.example/contend",
    },
    confidence: 0.9,
    sourceYear: 2024,
    components: [
      {
        type: "frame",
        description: "ALUXX-grade aluminium",
        attributes: {},
        raw: { label: "Рама", value: "ALUXX-grade aluminium" },
      },
      {
        type: "saddle",
        description: "Giant Contact",
        attributes: {},
        raw: { label: "Седло", value: "Giant Contact" },
      },
    ],
    rawSpecification: {},
    source: {
      manufacturer: "Giant",
      url: "https://www.giant.example/contend",
      fetchedAt: "2026-10-01T00:00:00.000Z",
      adapter: "giant",
      adapterVersion: 1,
      kind: "manufacturer",
    },
    cached: false,
    suggestedMetadata: { weight: 9.8, color: "Black", sizes: "S, M, L" },
    unknownFields: [
      { label: "Прочее", value: "?", strategy: "table", confidence: 0.5 },
    ],
    quality: {
      level: "partial",
      totalFields: 4,
      recognizedComponents: 2,
      unknownFields: 1,
      coverage: 0.5,
      strategies: ["table"],
    },
    ...overrides,
  };
}

const preview = { id: randomUUID(), expiresAt: "2026-10-07T12:00:00.000Z" };

test("resolution: a found build is the draft the site would show, in the site's groups", () => {
  const answer = toBikeResolution(resolved(), site(), preview);
  assert.deepEqual(bikeResolutionSchema.parse(answer), answer);
  assert.equal(answer.status, "resolved");
  assert.equal(answer.previewId, preview.id);
  assert.equal(answer.previewExpiresAt, preview.expiresAt);
  const build = present(answer.build);
  assert.equal(build.name, "Giant Contend AR 1");
  assert.equal(build.sourceHost, "www.giant.example");
  assert.equal(build.sourceKind, "manufacturer");
  assert.equal(build.quality?.level, "partial");
  assert.deepEqual(build.unrecognized, [{ label: "Прочее", value: "?" }]);
  assert.deepEqual(build.suggested, {
    weightKg: 9.8,
    color: "Black",
    sizes: "S, M, L",
    wheelSize: null,
    manufacturerUrl: null,
  });
  assert.deepEqual(
    build.components.map((c) => [c.section, c.category]),
    [
      ["build", "Рама"],
      ["build", "Седло"],
    ],
  );
  const group = (category: string) =>
    defaultCatalog.componentGroups.find((g) => g.categories.includes(category))
      ?.id ?? "";
  assert.deepEqual(
    build.components.map((c) => c.groupId),
    ["Рама", "Седло"].map(group),
  );
  // Nothing of the Resolver's own shape leaks to a client.
  assert.equal("rawSpecification" in build, false);
  assert.equal("components" in answer, false);
});

test("resolution: a page of another model or year says so, and the creation will ask", () => {
  const mismatch = toBikeResolution(
    resolved({ sourceYear: 2025, warnings: ["identity_mismatch"] }),
    site(),
    preview,
  );
  assert.equal(present(mismatch.build).identityMismatch, true);
  assert.equal(present(mismatch.build).yearMismatch, true);
  assert.deepEqual(present(mismatch.build).warnings, ["identity_mismatch"]);
  const exact = toBikeResolution(resolved(), site(), preview);
  assert.equal(present(exact.build).identityMismatch, false);
  assert.equal(present(exact.build).yearMismatch, false);
  // No year on the page is not a mismatch: none is invented.
  assert.equal(
    present(toBikeResolution(resolved({ sourceYear: null }), site()).build)
      .yearMismatch,
    false,
  );

  const spec = resolved({ sourceYear: 2025 });
  assert.equal(needsIdentityConfirmation(spec, 2024), true);
  assert.equal(needsIdentityConfirmation(spec, 2025), true, "the query year");
  assert.equal(needsIdentityConfirmation(resolved(), 2024), false);
  assert.equal(needsIdentityConfirmation(null, 2024), false);
  assert.equal(
    needsIdentityConfirmation(
      resolved({ warnings: ["identity_mismatch"] }),
      2024,
    ),
    true,
  );
});

test("resolution: several builds are variants the person chooses, each by its own id", () => {
  const candidate = (over: Partial<BikeCandidate>): BikeCandidate => ({
    brand: "Focus",
    canonicalName: "Focus Atlas 6.7 Cues gravel bike",
    url: "https://www.tradeinn.com/bikeinn/focus/1234567/p",
    year: null,
    ...over,
  });
  const result: ResolveResult = {
    status: "ambiguous",
    query,
    cached: false,
    candidates: [
      candidate({
        candidateId: "b".repeat(64),
        kind: "store",
        storeName: "Bikeinn",
        sourceHost: "www.tradeinn.com",
        selectable: true,
        drivetrain: "Shimano GRX 2x11",
        quality: { level: "complete", recognizedComponents: 18, coverage: 0.9 },
        warnings: ["multiple_builds"],
        alternatives: [
          { url: "https://a.example/x", sourceHost: "a.example" },
          { url: "https://a.example/y", sourceHost: "a.example" },
        ],
      }),
      candidate({ year: 2023, url: "https://b.example/z" }),
    ],
    search: {
      complete: false,
      sources: [
        {
          id: "bikeinn",
          name: "Bikeinn",
          kind: "store",
          status: "ok",
          pages: 2,
          candidates: 1,
          durationMs: 10,
        },
        {
          id: "velosklad",
          name: "Velosklad",
          kind: "store",
          status: "blocked",
          reason: "http_403",
          pages: 0,
          candidates: 0,
          durationMs: 5,
        },
        {
          id: "alltricks",
          name: "Alltricks",
          kind: "store",
          status: "disabled",
          pages: 0,
          candidates: 0,
          durationMs: 0,
        },
      ],
    },
  };
  const answer = toBikeResolution(result, site());
  assert.deepEqual(bikeResolutionSchema.parse(answer), answer);
  assert.equal(answer.status, "ambiguous");
  assert.equal(answer.build, null);
  assert.equal(answer.previewId, null);
  const [chosen, other] = answer.candidates;
  assert.equal(present(chosen).candidateId, "b".repeat(64));
  assert.equal(present(chosen).sourceName, "Bikeinn");
  assert.equal(
    present(chosen).year,
    null,
    "the page's silence about the year stays",
  );
  assert.deepEqual(present(chosen).otherHosts, ["a.example"]);
  assert.equal(present(chosen).selectable, true);
  assert.equal(present(other).candidateId, null);
  assert.equal(present(other).sourceHost, "b.example");
  assert.equal(present(other).selectable, false);
  // A disabled source was not asked; a limited search is not called complete.
  assert.deepEqual(answer.sourcesChecked, {
    asked: 2,
    answered: 1,
    complete: false,
  });
});

test("resolution: no build is an outcome with a reason and a way on, not an error", () => {
  for (const status of [
    "not_found",
    "unsupported_brand",
    "upstream_unavailable",
    "parse_error",
  ] as const) {
    const answer = toBikeResolution(
      {
        status,
        query,
        brand: "Giant",
        retryable: status === "upstream_unavailable",
        cached: false,
        reason: status === "not_found" ? "candidate_expired" : undefined,
      },
      site(),
    );
    assert.deepEqual(bikeResolutionSchema.parse(answer), answer);
    assert.equal(answer.status, status);
    assert.equal(answer.retryable, status === "upstream_unavailable");
    assert.equal(answer.build, null);
    assert.deepEqual(answer.candidates, []);
    assert.equal(answer.previewId, null);
  }
  assert.equal(
    toBikeResolution(
      {
        status: "not_found",
        query: { ...query, trim: null, year: null },
        brand: "Giant",
        retryable: true,
        cached: false,
        reason: "candidate_expired",
      },
      site(),
    ).reason,
    "candidate_expired",
  );
});

// ---- the request of a creation -------------------------------------------------

const classification = {
  category: "road_gravel",
  subtype: "road",
  suspension: null,
  construction: null,
  uses: [],
  electric: false,
  fatbike: false,
};
const wizardBody = (over: Record<string, unknown> = {}) => ({
  bike: {
    brand: "Giant",
    model: "Contend",
    trim: "AR 1",
    year: 2024,
    classification,
    isPublic: false,
  },
  components: [
    { section: "build", category: "Седло", name: "Giant Contact", groupId: "" },
  ],
  ...over,
});

test("wizard request: the name is optional, the audience is named, the build is bounded", () => {
  assert.ok(bikeWizardRequestSchema.safeParse(wizardBody()).success);
  assert.ok(
    bikeWizardRequestSchema.safeParse(
      wizardBody({
        previewId: randomUUID(),
        identityConfirmed: true,
        components: [],
      }),
    ).success,
    "a bicycle without a build is allowed",
  );
  const noAudience = wizardBody();
  delete (noAudience.bike as Record<string, unknown>).isPublic;
  for (const bad of [
    noAudience,
    wizardBody({ previewId: "not-a-uuid" }),
    wizardBody({ unknown: 1 }),
    wizardBody({
      components: Array.from({ length: 201 }, () => ({
        section: "build",
        category: "Седло",
        name: "X",
      })),
    }),
    wizardBody({
      components: [{ section: "build", category: "Седло", name: "" }],
    }),
  ])
    assert.equal(
      bikeWizardRequestSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad).slice(0, 120),
    );
});
