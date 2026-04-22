import { NextRequest, NextResponse } from "next/server";
import { getDevLog, clearDevLog } from "@/lib/dev-log";

/**
 * GET /api/dev-log
 *   Returns the last N binary-upload run entries as JSON.
 *   Pass ?clear=1 to also wipe the buffer after reading.
 *
 * DELETE /api/dev-log
 *   Clears the buffer and returns { cleared: true }.
 */
export async function GET(req: NextRequest) {
  const clear = req.nextUrl.searchParams.get("clear");
  const data = getDevLog();
  if (clear) clearDevLog();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE() {
  clearDevLog();
  return NextResponse.json({ cleared: true });
}
