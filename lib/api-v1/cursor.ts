import type { BikeCursor } from "../showcase.ts";
import { z } from "zod";
import { ApiError } from "./errors.ts";

// The opaque page cursor of GET /api/v1/bikes (#134). It only says where the
// next page starts; the visibility rule applies to every page, so a forged
// cursor can move the position and nothing else.

// PostgreSQL's own text for created_at: microseconds, UTC (lib/showcase.ts).
const microsecondTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const position = z.strictObject({
  t: z.string().regex(microsecondTimestamp),
  i: z.uuid(),
});

export function encodeCursor(cursor: BikeCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt, i: cursor.id }),
  ).toString("base64url");
}

export function decodeCursor(raw: string): BikeCursor {
  try {
    const parsed = position.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return { createdAt: parsed.t, id: parsed.i };
  } catch {
    throw new ApiError("invalid_request", "Неверный курсор страницы.", {
      details: [
        {
          path: "cursor",
          message: "Курсор не распознан; начните список с первой страницы.",
        },
      ],
    });
  }
}
