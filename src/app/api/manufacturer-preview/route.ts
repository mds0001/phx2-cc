import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

interface PreviewRow {
  normalized: string;
  will_change: boolean;
  source: "alias" | "fuzzy" | "none";
  suggestions: { name: string; score: number }[];
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("name") ?? "";
  const input = raw.trim();
  if (!input) {
    return NextResponse.json({ input, normalized: input, willChange: false, source: "none", suggestions: [] });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("preview_normalize_manufacturer_v2", { input });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = (Array.isArray(data) ? data[0] : data) as PreviewRow | undefined;
  return NextResponse.json({
    input,
    normalized:  row?.normalized  ?? input,
    willChange:  row?.will_change ?? false,
    source:      row?.source      ?? "none",
    suggestions: row?.suggestions ?? [],
  });
}
