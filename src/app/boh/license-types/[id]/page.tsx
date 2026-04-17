import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import LicenseTypeEditorClient from "@/components/LicenseTypeEditorClient";
import type { LicenseType } from "@/lib/types";

export const dynamic = 'force-dynamic';

export default async function LicenseTypeEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "administrator") redirect("/dashboard");

  const isNew = id === "new";
  let licenseType = null;

  if (!isNew) {
    const { data } = await supabase
      .from("license_types").select("*").eq("id", id).single();
    if (!data) redirect("/boh/license-types");
    licenseType = data;
  }

  return (
    <LicenseTypeEditorClient
      licenseType={licenseType as LicenseType | null}
      isNew={isNew}
      userId={user.id}
    />
  );
}
