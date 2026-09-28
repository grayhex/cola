import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { defaultCatalog } from "../lib/site-defaults.js";
import {
  productCategories,
  pairedCategories,
  productCategory,
  installationPosition,
} from "../lib/component-products.js";
import {
  componentCatalog,
  componentCatalogInput,
  resolveComponentModel,
  editComponentModel,
  mergeComponentModels,
} from "../lib/component-catalog.js";
import { factoryEntries } from "../lib/factory-components.js";
import { saveFactorySpecification } from "../lib/factory-import.js";
import { rebuildFactoryComponents } from "../lib/factory-rebuild.js";

test("product migration preserves specifications, consolidates paired models and blocks catalog pollution on every write", async () => {
  const db = new PGlite();
  const sql = async (file) =>
    db.exec(await readFile(new URL("../db/" + file, import.meta.url), "utf8"));
  try {
    for (const file of (await readdir(new URL("../db/", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && f < "033")
      .sort())
      await sql(file);
    await db.query(
      "INSERT INTO site_catalog(id,value) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET value=$1",
      [defaultCatalog],
    );
    const owner = randomUUID(),
      bikeId = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1::uuid,$1::text,'Owner','x','admin')",
      [owner],
    );
    const spec = {
      components: [{ type: "headset", description: "интегрированная рулевая" }],
      original: "untouched",
    };
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,is_public,factory_spec) VALUES($1,$1,$2,'Bike','Cube','Travel',2021,'road',true,$3)",
      [bikeId, owner, spec],
    );
    const install = async (category, name, bike = bikeId) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO components(id,bike_id,section,category,name,notes,price,url,group_id) VALUES($1,$2,'build',$3,$4,'Original notes',1234,'https://example.test/purchase','custom')",
        [id, bike, category, name],
      );
      return (await db.query("SELECT * FROM components WHERE id=$1", [id]))
        .rows[0];
    };
    const paired = [];
    for (const [front, rear, name] of [
      ["Передняя покрышка", "Задняя покрышка", "Schwalbe Marathon"],
      ["Передний обод", "Задний обод", "DT Swiss EX 511"],
      ["Передняя втулка", "Задняя втулка", "Shimano XT M8000"],
      ["Переднее колесо", "Заднее колесо", "Mavic Crossmax"],
      ["Передний тормоз", "Задний тормоз", "Shimano Deore M6100"],
      ["Левая манетка", "Правая манетка", "SRAM Rival AXS"],
    ])
      paired.push([await install(front, name), await install(rear, name)]);
    const distinct = [
      await install("Передняя покрышка", "Specialized Butcher"),
      await install("Задняя покрышка", "Specialized Eliminator"),
    ];
    const derailleurs = [
      await install("Передний переключатель", "Shimano GRX"),
      await install("Задний переключатель", "Shimano GRX"),
    ];
    const excluded = [];
    for (const category of [
      "Каретка",
      "Кассета",
      "Передний ротор",
      "Задний ротор",
      "Роторы",
      "Тормозная ручка",
      "Подседельный зажим",
      "Камеры / бескамерка",
      "Другое",
      "Custom category",
    ])
      excluded.push(await install(category, "Shimano Example X1"));
    for (const name of [
      "карбоновые шатуны",
      "катафот",
      "Canyon One-piece carbon cockpit with specialist gravel ergonomics",
      "Shimano",
      "Shimano carbon crankset",
      "Not Available",
    ])
      excluded.push(await install("Система / шатуны", name));
    const invalidPhoto = randomUUID(),
      goodPhoto = randomUUID();
    for (const [id, model] of [
      [invalidPhoto, excluded[0].model_id],
      [goodPhoto, paired[0][1].model_id],
    ]) {
      await db.query(
        "INSERT INTO component_photos(id,model_id,author_id,filename,size_bytes,width,height) VALUES($1,$2,$3,$4,100,800,600)",
        [id, model, owner, id + ".webp"],
      );
    }
    const parent = randomUUID(),
      reply = randomUUID();
    await db.query(
      "INSERT INTO component_comments(id,model_id,author_id,body) VALUES($1,$2,$3,'Parent')",
      [parent, excluded[0].model_id, owner],
    );
    await db.query(
      "INSERT INTO component_comments(id,model_id,author_id,parent_id,body) VALUES($1,$2,$3,$4,'Reply')",
      [reply, excluded[0].model_id, owner, parent],
    );
    const listing = randomUUID();
    await db.query(
      "INSERT INTO market_listings(id,share_id,owner_id,title,category,condition,price,currency,component_model_id) VALUES($1,$1,$2,'Listing stays','components','used',100,'RUB',$3)",
      [listing, owner, excluded[0].model_id],
    );
    const before = (await db.query("SELECT * FROM components ORDER BY id"))
      .rows;
    await db.transaction(async (q) =>
      q.exec(
        await readFile(
          new URL("../db/033_component_products.sql", import.meta.url),
          "utf8",
        ),
      ),
    );
    const after = (await db.query("SELECT * FROM components ORDER BY id")).rows;
    const row = (id) => after.find((p) => p.id === id);
    assert.deepEqual(
      after.map((part) =>
        Object.fromEntries(
          Object.entries(part).filter(
            ([k]) => !["model_id", "position"].includes(k),
          ),
        ),
      ),
      before.map((part) =>
        Object.fromEntries(
          Object.entries(part).filter(([k]) => k !== "model_id"),
        ),
      ),
    );
    assert.deepEqual(
      (await db.query("SELECT factory_spec FROM bikes WHERE id=$1", [bikeId]))
        .rows[0].factory_spec,
      spec,
    );
    for (const [front, rear] of paired) {
      assert.ok(row(front.id).model_id);
      assert.equal(row(front.id).model_id, row(rear.id).model_id);
      assert.equal(
        row(front.id).position,
        installationPosition(front.category),
      );
      assert.equal(row(rear.id).position, installationPosition(rear.category));
      const model = await resolveComponentModel(db, row(front.id).model_id);
      assert.equal(model.category, productCategory(front.category));
      assert.equal(
        (await resolveComponentModel(db, front.model_id)).id,
        model.id,
      );
      assert.equal(
        (await resolveComponentModel(db, rear.model_id)).id,
        model.id,
      );
    }
    assert.notEqual(row(distinct[0].id).model_id, row(distinct[1].id).model_id);
    assert.notEqual(
      row(derailleurs[0].id).model_id,
      row(derailleurs[1].id).model_id,
    );
    for (const p of excluded) {
      assert.equal(row(p.id).model_id, null, p.name);
      assert.equal(await resolveComponentModel(db, p.model_id), null);
      assert.equal(
        (await install(p.category, p.name)).model_id,
        null,
        "reimport must not recreate " + p.name,
      );
    }
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM component_photo_gc WHERE filename=$1",
          [invalidPhoto + ".webp"],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM component_photos WHERE id=$1",
          [goodPhoto],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT component_model_id,title FROM market_listings WHERE id=$1",
          [listing],
        )
      ).rows[0].title,
      "Listing stays",
    );
    assert.equal(
      (
        await db.query(
          "SELECT component_model_id FROM market_listings WHERE id=$1",
          [listing],
        )
      ).rows[0].component_model_id,
      null,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM component_comments WHERE id=ANY($1)",
          [[parent, reply]],
        )
      ).rows[0].n,
      0,
    );
    const catalog = await componentCatalog(db, componentCatalogInput.parse({}));
    assert.equal(catalog.total, 10);
    assert(catalog.items.every((m) => productCategories.includes(m.category)));
    assert(catalog.items.every((m) => m.builds === 1));
    const policy = (await db.query("SELECT * FROM component_product_policy"))
      .rows;
    assert.equal(
      policy.length,
      productCategories.length + Object.keys(pairedCategories).length,
    );
    for (const p of policy) {
      assert.equal(
        p.product_category,
        productCategory(p.installation_category),
      );
      assert.equal(p.position, installationPosition(p.installation_category));
    }
    // A known public model and an arbitrary description can replace each other;
    // a caller-supplied FK cannot smuggle a spec-only part into the catalog.
    const edited = await install("Седло", "Brooks C17");
    await db.query(
      "UPDATE components SET name='комфортное седло' WHERE id=$1",
      [edited.id],
    );
    assert.equal(
      (
        await db.query("SELECT model_id FROM components WHERE id=$1", [
          edited.id,
        ])
      ).rows[0].model_id,
      null,
    );
    await db.query("UPDATE components SET name='Brooks C17' WHERE id=$1", [
      edited.id,
    ]);
    assert.equal(
      (
        await db.query("SELECT model_id FROM components WHERE id=$1", [
          edited.id,
        ])
      ).rows[0].model_id,
      edited.model_id,
    );
    await db.query(
      "UPDATE components SET category='Другое',model_id=$2 WHERE id=$1",
      [edited.id, edited.model_id],
    );
    assert.equal(
      (
        await db.query("SELECT model_id FROM components WHERE id=$1", [
          edited.id,
        ])
      ).rows[0].model_id,
      null,
    );
    const model = await resolveComponentModel(db, edited.model_id);
    await assert.rejects(
      db.transaction((q) =>
        editComponentModel(q, owner, model.id, {
          ...model,
          category: "Каретка",
          version: model.version,
        }),
      ),
      /только к комплектации/,
    );
    const front = await resolveComponentModel(
        db,
        row(derailleurs[0].id).model_id,
      ),
      rear = await resolveComponentModel(db, row(derailleurs[1].id).model_id);
    await assert.rejects(
      db.transaction((q) =>
        mergeComponentModels(q, owner, front.id, {
          targetId: rear.id,
          version: front.version,
          targetVersion: rear.version,
        }),
      ),
      /разные типы/,
    );

    // New factory import retains generic equipment, omits only absent values.
    const fresh = randomUUID();
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,brand,model,year,category,is_public) VALUES($1,$1,$2,'Factory','Cube','Travel',2021,'road',true)",
      [fresh, owner],
    );
    const bike = (await db.query("SELECT * FROM bikes WHERE id=$1", [fresh]))
      .rows[0];
    const raw = (type, description) => ({
      type,
      description,
      raw: { label: type, value: description },
    });
    const source = {
      components: [
        raw("front_tire", "Schwalbe Marathon 40-622"),
        raw("rear_tire", "Schwalbe Marathon 40-622"),
        raw("cassette", "Shimano Deore M6100"),
        raw("headset", "интегрированная рулевая"),
        raw("crankset", "карбоновые шатуны"),
        raw("other", "катафот"),
        raw("pedals", "None included"),
      ],
    };
    assert.equal(factoryEntries(source).length, 6);
    assert.equal(
      (
        await db.transaction((q) =>
          saveFactorySpecification(q, bike, owner, source, true),
        )
      ).importedCount,
      6,
    );
    const installed = (
      await db.query("SELECT * FROM components WHERE bike_id=$1 ORDER BY id", [
        fresh,
      ])
    ).rows;
    assert.equal(installed.filter((p) => p.model_id).length, 2);
    assert.equal(
      new Set(installed.filter((p) => p.model_id).map((p) => p.model_id)).size,
      1,
    );
    assert.equal(
      (
        await db.transaction((q) =>
          saveFactorySpecification(q, bike, owner, source, true),
        )
      ).importedCount,
      0,
    );
    // Restrict rebuild to this fixture's tracked factory specification.
    await db.query("UPDATE bikes SET factory_spec=NULL WHERE id=$1", [bikeId]);
    const report = await db.transaction((q) => rebuildFactoryComponents(q));
    assert.equal(report.changes.length, 0);
    await db.transaction((q) =>
      rebuildFactoryComponents(q, { apply: true, expect: report.fingerprint }),
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT * FROM components WHERE bike_id=$1 ORDER BY id",
          [fresh],
        )
      ).rows,
      installed,
    );
    assert.equal(
      (await db.transaction((q) => rebuildFactoryComponents(q))).changes.length,
      0,
    );
  } finally {
    await db.close();
  }
});
