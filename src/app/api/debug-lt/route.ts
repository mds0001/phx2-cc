import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin.from("license_types").select("*").order("name");
  return Response.json({ count: data?.length ?? 0, data, error: error?.message ?? null });
}
