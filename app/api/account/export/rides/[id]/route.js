import { currentUser } from "../../../../../../lib/auth.ts";
import { db } from "../../../../../../lib/db.ts";
import { fail } from "../../../../../../lib/http.ts";
import { uuid } from "../../../../../../lib/validation.ts";
import { getOriginal } from "../../../../../../lib/ride-storage.js";
import { ownRideTrack } from "../../../../../../lib/account-data.ts";
import { traced } from "../../../../../../lib/observability.ts";
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
    bytes = await getOriginal(ride.track_file_id || ride.id);
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
