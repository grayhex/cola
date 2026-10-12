import { test } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../lib/db.ts";
import { testDatabase, seedSiteDefaults } from "./support/database.ts";
import { userRow } from "./support/people.ts";
import { bikeRow, componentRow, photoRow } from "./support/bikes.ts";
import { getSite } from "../lib/site.ts";
import {
  ownedBikeList,
  ownedBikeCards,
  ownedBikeChoices,
  decorateBike,
} from "../lib/showcase.ts";
import { invalid } from "./support/negative.ts";
import type { FactorySpec } from "../lib/database-rows.ts";
import { ownedBike } from "../lib/repository.ts";

test("owner projections batch 1/10/50 bikes without losing full editor data or selector options", async () => {
  const q = await testDatabase();
  try {
    await seedSiteDefaults(q);
    const site = await getSite(q),
      outsider = await userRow(q);
    await bikeRow(q, outsider.id, { name: "Other owner" });
    for (const count of [1, 10, 50]) {
      const owner = await userRow(q);
      const created = [];
      for (let i = 0; i < count; i++) {
        const bike = await bikeRow(q, owner.id, {
          name: "Bike " + String(i).padStart(2, "0"),
          is_public: i % 2 === 0,
          is_former: i % 3 === 0,
          description: "private notes",
          factory_spec: invalid<FactorySpec>({
            legacy: "old private factory notes",
          }),
        });
        created.push(bike);
        await componentRow(q, bike.id, {
          notes: "Component notes",
          price: "1234",
        });
        await photoRow(q, bike.id, { is_cover: true });
        await photoRow(q, bike.id);
      }
      let queries = 0;
      const measured: Queryable = {
        query<Row extends object>(text: string, values?: unknown[]) {
          queries++;
          return q.query<Row>(text, values);
        },
      };
      const full = await ownedBikeList(measured, owner.id, site);
      assert.equal(queries, 3);
      assert.equal(full.length, count);
      for (const b of full) {
        const original = await ownedBike(q, b.id, owner.id);
        assert.ok(original);
        assert.deepEqual(b, await decorateBike(q, original, owner.id, site));
      }
      queries = 0;
      const cards = await ownedBikeCards(measured, owner.id, site);
      assert.equal(queries, 4);
      assert.equal(cards.total, count);
      assert.equal(cards.bikes.length, Math.min(count, 24));
      for (const b of cards.bikes) {
        assert.equal(b.photos.length, 1);
        assert.equal(b.is_owner, true);
        for (const privateField of [
          "components",
          "factory_spec",
          "description",
          "color",
          "price",
          "owner_id",
        ])
          assert.ok(!(privateField in b), privateField);
        assert.deepEqual(b.scores, full.find((f) => f.id === b.id)!.scores);
      }
      const page2 = await ownedBikeCards(q, owner.id, site, { page: 2 });
      assert.ok(
        page2.bikes.every((b) => !cards.bikes.some((a) => a.id === b.id)),
      );
      if (count === 50) {
        const page3 = await ownedBikeCards(q, owner.id, site, { page: 3 });
        assert.equal(
          new Set(
            [...cards.bikes, ...page2.bikes, ...page3.bikes].map((b) => b.id),
          ).size,
          50,
        );
      }
      queries = 0;
      const choices = await ownedBikeChoices(measured, owner.id);
      assert.equal(queries, 1);
      assert.equal(choices.length, count);
      assert.deepEqual(Object.keys(choices[0]).sort(), [
        "id",
        "is_former",
        "is_public",
        "name",
      ]);
      assert.equal(
        choices.filter((b) => b.is_former).length,
        created.filter((b) => b.is_former).length,
      );
      const search = await ownedBikeCards(q, owner.id, site, {
        search: "Bike 00",
        limit: 3,
      });
      assert.equal(search.total, 1);
      assert.equal(search.bikes[0].name, "Bike 00");
      assert.equal(
        (await ownedBikeCards(q, owner.id, site, { categories: ["mtb"] }))
          .total,
        0,
      );
      await q.query("UPDATE users SET blocked=true WHERE id=$1", [owner.id]);
      assert.deepEqual(await ownedBikeChoices(q, owner.id), []);
      assert.deepEqual(await ownedBikeList(q, owner.id, site), []);
      assert.equal((await ownedBikeCards(q, owner.id, site)).total, 0);
    }
    const empty = await userRow(q);
    assert.deepEqual(await ownedBikeCards(q, empty.id, site), {
      bikes: [],
      total: 0,
    });
  } finally {
    await q.close();
  }
});
