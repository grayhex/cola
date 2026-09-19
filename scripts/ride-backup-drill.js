import { db, transaction } from "../lib/db.js";
import {
  previewRide,
  saveRide,
  rideDefaults,
  rideDetail,
} from "../lib/rides.js";
import { getOriginal } from "../lib/ride-storage.js";
import { parseGpx } from "../lib/ride-gpx.js";
import assert from "node:assert/strict";
const owner = "00000000-0000-4000-8000-000000000001",
  bike = "00000000-0000-4000-8000-000000000003";
try {
  if (process.argv.includes("--seed")) {
    await db.query(
      "INSERT INTO bikes(id,share_id,owner_id,name,year,category,is_public) VALUES($1,$1,$2,'Restore bicycle',2026,'road',true)",
      [bike, owner],
    );
    const bytes = Buffer.from(
      '<gpx><trk><trkseg><trkpt lat="0" lon="0"><time>2026-09-01T00:00:00Z</time></trkpt><trkpt lat="0" lon="0.01"><time>2026-09-01T00:05:00Z</time></trkpt></trkseg></trk></gpx>',
    );
    const p = await transaction((q) =>
      previewRide(q, owner, bytes, rideDefaults),
    );
    await transaction((q) =>
      saveRide(
        q,
        owner,
        {
          previewId: p.previewId,
          bikeId: bike,
          title: "Restore ride",
          description: "",
          isPublic: true,
          privacyEnabled: false,
          privacyRadiusM: 500,
        },
        rideDefaults,
      ),
    );
  } else {
    const r = (
      await db.query("SELECT id,share_id FROM rides WHERE owner_id=$1", [owner])
    ).rows[0];
    assert.ok(r);
    assert.ok(parseGpx(await getOriginal(r.id)).metrics.distanceM > 1000);
    const d = await rideDetail(db, r.share_id, null);
    assert.ok(d.geometry.length);
    const response = await fetch(
      "http://localhost:3000/api/rides/public/" + r.share_id,
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).ride.geometry, d.geometry);
    assert.equal(
      (await fetch("http://localhost:3000/r/" + r.share_id)).status,
      200,
    );
    console.log(
      "Ride row, gzip original, public geometry and restored page verified",
    );
  }
} finally {
  await db.end();
}
