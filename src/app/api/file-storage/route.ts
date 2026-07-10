import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { listStorage, downloadStorage, uploadStorage, type FileBackendConfig } from "@/lib/fileStorage";

/**
 * Browser-facing proxy for multi-backend file storage (S3 / GCS / Google
 * Drive / OneDrive — Supabase-backed connections keep talking to Supabase
 * Storage directly from the browser). Used by the connection editor
 * (browse / upload / download), the mapping editor (header load), and the
 * scheduler reset flow. Keeps backend SDK calls and CORS-hostile APIs
 * server-side; the caller already holds the connection config, so accepting
 * it inline (for not-yet-saved connections) leaks nothing new.
 *
 * POST JSON:      { op: "list",     config, prefix? }            → { entries }
 * POST JSON:      { op: "download", config, path }               → binary body
 * POST multipart: op=upload, config (JSON string), path, file    → { path, url? }
 */

export const runtime = "nodejs";

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Unauthorized", 401);

  try {
    const contentType = request.headers.get("content-type") ?? "";

    // ── Upload (multipart) ──────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (form.get("op") !== "upload") return fail("Multipart requests only support op=upload");
      const rawConfig = form.get("config");
      const path = form.get("path");
      const file = form.get("file");
      if (typeof rawConfig !== "string" || typeof path !== "string" || !(file instanceof File)) {
        return fail("upload requires config (JSON string), path, and file fields");
      }
      const config = JSON.parse(rawConfig) as FileBackendConfig;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await uploadStorage(config, path, bytes, file.type || "application/octet-stream");
      return NextResponse.json(result);
    }

    // ── JSON ops ────────────────────────────────────────────
    const body = (await request.json()) as {
      op: "list" | "download";
      config: FileBackendConfig;
      prefix?: string;
      path?: string;
    };
    if (!body?.config || typeof body.config !== "object") return fail("Missing connection config");

    if (body.op === "list") {
      const entries = await listStorage(body.config, body.prefix ?? "");
      return NextResponse.json({ entries });
    }

    if (body.op === "download") {
      if (!body.path) return fail("download requires a path");
      const data = await downloadStorage(body.config, body.path);
      const name = body.path.split("/").pop() ?? "file";
      return new NextResponse(data, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name.replace(/["\\]/g, "_")}"`,
        },
      });
    }

    return fail(`Unknown op "${body.op}"`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}
