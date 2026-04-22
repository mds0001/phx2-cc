// DEPRECATED — Run Until Fixed removed. Delete this file and its folder.
import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ error: "Endpoint removed" }, { status: 410 });
}
