import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { getActiveRoleAssignment } from "@/lib/permissions";
import LicenseTypesListClient from "@/components/LicenseTypesListClient";
import type { LicenseType } from "@/lib/types";

export const dynamic = 'force-dynamic';

export default async function LicenseTypesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const assignment = await getActiveRoleAssignment(user.id);
  if (assignment?.role !== "administrator") redirect("/dashboard");

  const { data: licenseTypes } = await supabase
    .from("license_types")
    .select("*")
    .order("name");

  return <LicenseTypesListClient licenseTypes={(licenseTypes ?? []) as LicenseType[]} />;
}
