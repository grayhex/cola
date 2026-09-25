import { currentUser } from "../../../../../../lib/auth.js";
import { db } from "../../../../../../lib/db.js";
import { fail } from "../../../../../../lib/http.js";
import { uuid } from "../../../../../../lib/validation.js";
import { getOriginal } from "../../../../../../lib/ride-storage.js";
import { ownRideTrack } from "../../../../../../lib/account-data.js";
import { traced } from "../../../../../../lib/observability.js";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner's original track of a ride, linked from the data export (#70).
export const GET = traced(async function GET(req, { params }) {
  const user = await currentUser();
  if (!user) return fail("Войдите в аккаунт", 401);
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail("Трек не найден", 404);
  const ride = await ownRideTrack(db, user.id, id);
  if (!ride) return fail("Трек не найден", 404);
  let bytes;
  try {
    bytes = await getOriginal(ride.id);
  } catch (e) {
    if (e.code === "ENOENT") return fail("Трек не найден", 404);
    throw e;
  }
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="ride-${ride.id}.gpx"`,
      "Cache-Control": "private, no-store",
    },
  });
});
