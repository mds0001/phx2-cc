"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase-browser";
import { useTheme } from "next-themes";
import {
  Sun,
  Moon,
  LogOut,
  CalendarClock,
  Activity,
  Clock,
  CheckCircle2,
  BarChart3,
  Upload,
  User,
  Zap,
  GitMerge,
  Plug,
} from "lucide-react";
import type { Profile } from "@/lib/types";

interface Counts {
  active: number;
  waiting: number;
  completed: number;
  total: number;
}

interface Props {
  profile: Profile | null;
  initialCounts: Counts;
}

export default function DashboardClient({ profile, initialCounts }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  // Normalise avatar URL — old rows may store just a filename or storage path
  function resolveAvatarUrl(raw: string | null): string | null {
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    // Bare filename or relative path — build full public URL
    const clean = raw.startsWith("/") ? raw.slice(1) : raw;
    return `${supabaseUrl}/storage/v1/object/public/avatars/${clean}`;
  }

  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    resolveAvatarUrl(profile?.avatar_url ?? null)
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Supabase Realtime — live task count updates
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_tasks" },
        async () => {
          const { data } = await supabase
            .from("scheduled_tasks")
            .select("status");
          if (data) {
            setCounts({
              active: data.filter((t) => t.status === "active").length,
              waiting: data.filter((t) => t.status === "waiting").length,
              completed: data.filter((t) => t.status === "completed").length,
              total: data.length,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${profile.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);

      await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", profile.id);

      setAvatarUrl(resolveAvatarUrl(publicUrl) + "?t=" + Date.now());
    } catch (err) {
      console.error("Avatar upload error:", err);
      alert("Failed to upload avatar. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    "User";
  const initials =
    [profile?.first_name?.[0], profile?.last_name?.[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() || "U";

  const statCards = [
    {
      label: "Active",
      value: counts.active,
      icon: Activity,
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      text: "text-emerald-400",
    },
    {
      label: "Waiting",
      value: counts.waiting,
      icon: Clock,
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20",
      text: "text-yellow-400",
    },
    {
      label: "Completed",
      value: counts.completed,
      icon: CheckCircle2,
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      text: "text-blue-400",
    },
    {
      label: "Total",
      value: counts.total,
      icon: BarChart3,
      bg: "bg-indigo-500/10",
      border: "border-indigo-500/20",
      text: "text-indigo-400",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.06)_0%,_transparent_50%)] pointer-events-none" />

      {/* Top Bar */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-lg">phx2</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="w-9 h-9 rounded-xl bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-all"
              title="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <div className="flex items-center gap-3 bg-gray-800 rounded-2xl px-4 py-2">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt="Avatar"
                  width={32}
                  height={32}
                  className="rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                  {initials}
                </div>
              )}
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-white leading-none">
                  {fullName}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{profile?.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="w-9 h-9 rounded-xl bg-gray-800 hover:bg-red-500/20 border border-transparent hover:border-red-500/30 flex items-center justify-center text-gray-400 hover:text-red-400 transition-all"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-10">
          <h2 className="text-3xl font-bold text-white">
            Welcome back, {profile?.first_name || "User"} 👋
          </h2>
          <p className="text-gray-400 mt-1">
            Here&apos;s what&apos;s happening with your tasks today.
          </p>
        </div>

        {/* Three-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1: Quick links */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Quick Actions
            </h3>
            <button
              onClick={() => router.push("/scheduler")}
              className="w-full bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-indigo-500/40 rounded-3xl p-6 text-left transition-all duration-200 group shadow-lg"
            >
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                <CalendarClock className="w-6 h-6 text-indigo-400" />
              </div>
              <h4 className="text-white font-semibold text-lg">Scheduler</h4>
              <p className="text-gray-400 text-sm mt-1">
                Create, manage, and monitor all your scheduled tasks.
              </p>
              <div className="mt-4 flex items-center gap-1 text-indigo-400 text-sm font-medium">
                Open Scheduler
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </button>

            <button
              onClick={() => router.push("/mappings")}
              className="w-full bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-purple-500/40 rounded-3xl p-6 text-left transition-all duration-200 group shadow-lg"
            >
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 group-hover:bg-purple-500/20 transition-colors">
                <GitMerge className="w-6 h-6 text-purple-400" />
              </div>
              <h4 className="text-white font-semibold text-lg">Field Mappings</h4>
              <p className="text-gray-400 text-sm mt-1">
                Visually map source fields to target destinations with transforms.
              </p>
              <div className="mt-4 flex items-center gap-1 text-purple-400 text-sm font-medium">
                Open Mappings
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </button>

            <button
              onClick={() => router.push("/connections")}
              className="w-full bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-teal-500/40 rounded-3xl p-6 text-left transition-all duration-200 group shadow-lg"
            >
              <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-4 group-hover:bg-teal-500/20 transition-colors">
                <Plug className="w-6 h-6 text-teal-400" />
              </div>
              <h4 className="text-white font-semibold text-lg">Endpoint Connections</h4>
              <p className="text-gray-400 text-sm mt-1">
                Manage File, Cloud, SMTP, ODBC, and Portal connections.
              </p>
              <div className="mt-4 flex items-center gap-1 text-teal-400 text-sm font-medium">
                Open Connections
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </button>
          </div>

          {/* Col 2: Task Summary (realtime) */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Task Summary
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {statCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className={`${card.bg} border ${card.border} rounded-2xl p-5 shadow-lg`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wider ${card.text}`}
                      >
                        {card.label}
                      </span>
                      <Icon className={`w-4 h-4 ${card.text}`} />
                    </div>
                    <p className={`text-4xl font-bold ${card.text}`}>
                      {card.value}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Col 3: Avatar / Profile */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Profile
            </h3>
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-lg">
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-4">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt="Avatar"
                      width={80}
                      height={80}
                      className="rounded-full object-cover border-2 border-gray-700"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-2xl font-bold text-white border-2 border-gray-700">
                      {initials}
                    </div>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-7 h-7 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center shadow-lg transition-colors"
                    title="Upload avatar"
                  >
                    <Upload className="w-3 h-3 text-white" />
                  </button>
                </div>

                <h4 className="text-white font-semibold text-lg">{fullName}</h4>
                <p className="text-gray-400 text-sm">{profile?.email}</p>

                <div className="mt-2 px-3 py-1 rounded-full bg-gray-800 border border-gray-700">
                  <span className="text-xs font-medium text-gray-300 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {profile?.user_type === "admin"
                      ? "Administrator"
                      : "User"}
                  </span>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="mt-5 w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 text-sm font-medium py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? "Uploading…" : "Change Avatar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
