import { it, expect, vi } from "vitest";
import { querySchema } from "../src/domain.js";
import { identityConflict } from "../src/identity.js";
import { match, scoreCandidate } from "../src/matcher.js";
import { archiveLinks } from "../src/archive-search.js";
import { queryKey } from "../src/normalize.js";
import type { ManufacturerHttpClient } from "../src/http.js";

it("missing model year remains unknown instead of being replaced by the current year", async () => {
  const query = querySchema.parse({
    brand: "Cube",
    model: "Travel",
    trim: "SL",
  });
  expect(query.year).toBeNull();
  const candidate = {
    brand: "Cube",
    canonicalName: "Travel SL",
    year: 2020,
    url: "https://archiv.cube.eu/2020/travel",
  };
  expect(scoreCandidate(query, candidate)).toBeGreaterThan(0);
  // An explicit choice is required when the model year wasn't supplied.
  expect(match(query, [candidate]).chosen).toBeNull();
  expect(identityConflict(query, "Cube Travel SL", 2020)).toBe(false);
  expect(
    identityConflict({ ...query, year: 2021 }, "Cube Travel SL", 2020),
  ).toBe(true);
  expect(identityConflict(query, "Cube Nuroad EX", 2020)).toBe(true);
  expect(queryKey(query)).not.toBe(queryKey({ ...query, year: 2020 }));
  const get = vi.fn();
  expect(
    await archiveLinks({ get } as unknown as ManufacturerHttpClient, query),
  ).toEqual([]);
  expect(get).not.toHaveBeenCalled();
});
