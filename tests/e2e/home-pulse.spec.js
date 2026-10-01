import { test, expect } from "@playwright/test";
import { registerVerified } from "../fixtures/verified-user.js";
import { testConsents } from "../fixtures/legal.js";
import pg from "pg";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
test("home pulse keeps community profiles authenticated and revokes hidden plans on the next read", async ({
  page,
}, info) => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let user;
  const ids = [];
  try {
    expect((await page.request.get("/api/ride-intents/pulse")).status()).toBe(
      401,
    );
    const registered = await registerVerified(page.request, {
      headers: { origin },
      data: {
        ...testConsents,
        name: "Pulse viewer",
        email: randomUUID() + "@pulse.test",
        password: "pulse-browser-secret",
      },
    });
    expect(registered.status()).toBe(201);
    user = (await (await page.request.get("/api/me")).json()).user;
    for (const visibility of ["community", "private"]) {
      const id = randomUUID();
      ids.push(id);
      await db.query(
        "INSERT INTO ride_intents(id,owner_id,readiness,time_zone,visibility,request_hash) VALUES($1,$2,'ready','Europe/Moscow',$3,'home-pulse')",
        [id, user.id, visibility],
      );
      await db.query(
        "INSERT INTO ride_intent_windows VALUES($1,now()-interval '10 minutes',now()+interval '1 hour')",
        [id],
      );
    }
    const snapshot = await (
      await page.request.get("/api/discovery/home?view=landing")
    ).json();
    expect(Object.keys(snapshot).sort()).toEqual([
      "bikeOfWeek",
      "events",
      "pulse",
      "records",
    ]);
    expect(JSON.stringify(snapshot.pulse)).not.toContain(user.id);
    expect(JSON.stringify(snapshot.pulse)).not.toContain(user.name);
    const response = await page.request.get("/api/ride-intents/pulse");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const people = (await response.json()).people;
    expect(people.filter((p) => p.author.id === user.id)).toHaveLength(1);
    expect(people.length).toBeLessThanOrEqual(4);
    expect(JSON.stringify(people)).not.toMatch(
      /email|passport|center|meetingPoint/,
    );
    await page.goto("/");
    await expect(
      page
        .getByRole("list", { name: "Участники с ближайшими окнами" })
        .getByRole("link", { name: /Pulse viewer/ }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("home-signed-in.png"),
      fullPage: true,
    });
    await db.query("UPDATE ride_intents SET visibility='private' WHERE id=$1", [
      ids[0],
    ]);
    expect(
      (
        await (await page.request.get("/api/ride-intents/pulse")).json()
      ).people.some((p) => p.author.id === user.id),
    ).toBe(false);
    expect(
      (
        await (
          await page.request.get("/api/discovery/home?view=landing")
        ).json()
      ).pulse.total,
    ).toBe(snapshot.pulse.total - 1);
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "Участники с ближайшими окнами" })
        .getByRole("link", { name: /Pulse viewer/ }),
    ).toHaveCount(0);
  } finally {
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    await db.end();
  }
});
