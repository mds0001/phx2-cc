/**
 * Multi-backend file storage for `file` endpoint connections.
 *
 * A file connection's config carries a `backend` discriminator
 * ("supabase" | "s3" | "gcs" | "gdrive" | "onedrive"; absent = supabase) plus
 * per-backend credentials (see FileConfig in types.ts). This module is the
 * single server-side implementation of list / download / upload / stat / test
 * across all backends. Server-only — credentials and the service-role key
 * must never reach the browser; UI code goes through /api/file-storage.
 *
 * Path model: every backend exposes a "/"-separated relative path rooted at
 * the connection's container (Supabase bucket, S3/GCS bucket, Drive root
 * folder, OneDrive drive root). Google Drive is ID-addressed natively, so
 * path segments are resolved name-by-name from `gdrive_folder_id`.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createSign } from "crypto";
import type { FileBackend, FileConfig } from "@/lib/types";

export interface StorageEntry {
  name: string;
  path: string;      // full relative path from the container root
  isFolder: boolean;
  size?: number;
}

export interface UploadResult {
  path: string;
  /** Human-usable link when the backend provides one (signed URL / webUrl). */
  url?: string;
}

export type FileBackendConfig = Partial<FileConfig> & Record<string, string | undefined>;

export function resolveBackend(cfg: FileBackendConfig): FileBackend {
  const b = (cfg.backend ?? "supabase") as FileBackend;
  return (["supabase", "s3", "gcs", "gdrive", "onedrive"] as const).includes(b) ? b : "supabase";
}

export const BACKEND_LABELS: Record<FileBackend, string> = {
  supabase: "Supabase Storage",
  s3:       "Amazon S3",
  gcs:      "Google Cloud Storage",
  gdrive:   "Google Drive",
  onedrive: "OneDrive",
};

const norm = (p: string) => p.replace(/^\/+/, "").replace(/\/+$/, "");
const dirPrefix = (p: string) => (norm(p) ? norm(p) + "/" : "");

// ── Supabase Storage ──────────────────────────────────────────

const SUPABASE_BUCKET = "task_files";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function sbList(prefix: string): Promise<StorageEntry[]> {
  const { data, error } = await supabaseAdmin()
    .storage.from(SUPABASE_BUCKET)
    .list(dirPrefix(prefix) || undefined, { limit: 500 });
  if (error) throw new Error(`Supabase list failed: ${error.message}`);
  return (data ?? []).map((i) => ({
    name: i.name,
    path: dirPrefix(prefix) + i.name,
    isFolder: i.id === null,
    size: (i.metadata as { size?: number } | null)?.size,
  }));
}

async function sbDownload(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabaseAdmin().storage.from(SUPABASE_BUCKET).download(norm(path));
  if (error || !data) throw new Error(`Supabase download of "${path}" failed: ${error?.message ?? "not found"}`);
  return data.arrayBuffer();
}

async function sbUpload(path: string, data: Uint8Array, contentType: string): Promise<UploadResult> {
  const admin = supabaseAdmin();
  const key = norm(path);
  const { error } = await admin.storage.from(SUPABASE_BUCKET).upload(key, data, { upsert: true, contentType });
  if (error) throw new Error(`Supabase upload to "${path}" failed: ${error.message}`);
  const { data: signed } = await admin.storage.from(SUPABASE_BUCKET).createSignedUrl(key, 86400);
  return { path: key, url: signed?.signedUrl };
}

async function sbStat(path: string): Promise<boolean> {
  const key = norm(path);
  const slash = key.lastIndexOf("/");
  const dir = slash >= 0 ? key.slice(0, slash) : "";
  const name = slash >= 0 ? key.slice(slash + 1) : key;
  const { data, error } = await supabaseAdmin()
    .storage.from(SUPABASE_BUCKET)
    .list(dir || undefined, { limit: 1, search: name });
  if (error) return false;
  return (data ?? []).some((i) => i.name === name);
}

// ── Amazon S3 (and S3-compatible) ─────────────────────────────

async function s3Client(cfg: FileBackendConfig) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  if (!cfg.s3_bucket) throw new Error("S3 connection has no bucket configured");
  if (!cfg.s3_access_key_id || !cfg.s3_secret_access_key) throw new Error("S3 connection is missing access key / secret");
  return new S3Client({
    region: cfg.s3_region || "us-east-1",
    ...(cfg.s3_endpoint ? { endpoint: cfg.s3_endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: cfg.s3_access_key_id, secretAccessKey: cfg.s3_secret_access_key },
  });
}

async function s3List(cfg: FileBackendConfig, prefix: string): Promise<StorageEntry[]> {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const client = await s3Client(cfg);
  const pfx = dirPrefix(prefix);
  const out = await client.send(new ListObjectsV2Command({
    Bucket: cfg.s3_bucket!, Prefix: pfx, Delimiter: "/", MaxKeys: 500,
  }));
  const folders: StorageEntry[] = (out.CommonPrefixes ?? []).map((c) => {
    const full = norm(c.Prefix ?? "");
    return { name: full.slice(pfx.length ? pfx.length : 0).replace(/\/$/, ""), path: full, isFolder: true };
  });
  const files: StorageEntry[] = (out.Contents ?? [])
    .filter((o) => (o.Key ?? "") !== pfx)
    .map((o) => ({ name: (o.Key ?? "").slice(pfx.length), path: o.Key ?? "", isFolder: false, size: o.Size }));
  return [...folders, ...files];
}

async function s3Download(cfg: FileBackendConfig, path: string): Promise<ArrayBuffer> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client(cfg);
  const out = await client.send(new GetObjectCommand({ Bucket: cfg.s3_bucket!, Key: norm(path) }));
  if (!out.Body) throw new Error(`S3 object "${path}" has no body`);
  const bytes = await out.Body.transformToByteArray();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function s3Upload(cfg: FileBackendConfig, path: string, data: Uint8Array, contentType: string): Promise<UploadResult> {
  const { PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = await s3Client(cfg);
  const key = norm(path);
  await client.send(new PutObjectCommand({ Bucket: cfg.s3_bucket!, Key: key, Body: data, ContentType: contentType }));
  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.s3_bucket!, Key: key }), { expiresIn: 86400 })
    .catch(() => undefined);
  return { path: key, url };
}

async function s3Stat(cfg: FileBackendConfig, path: string): Promise<boolean> {
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client(cfg);
  try {
    await client.send(new HeadObjectCommand({ Bucket: cfg.s3_bucket!, Key: norm(path) }));
    return true;
  } catch {
    return false;
  }
}

async function s3Test(cfg: FileBackendConfig): Promise<string> {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const client = await s3Client(cfg);
  const out = await client.send(new ListObjectsV2Command({ Bucket: cfg.s3_bucket!, MaxKeys: 1 }));
  return `Bucket "${cfg.s3_bucket}" reachable — ${out.KeyCount ?? 0} object(s) sampled`;
}

// ── Google service-account auth (shared by GCS + Drive) ───────

interface GoogleServiceAccount { client_email: string; private_key: string; token_uri?: string }

function parseServiceAccount(json: string | undefined, backend: string): GoogleServiceAccount {
  if (!json?.trim()) throw new Error(`${backend} connection has no service-account key JSON configured`);
  let sa: GoogleServiceAccount;
  try {
    sa = JSON.parse(json) as GoogleServiceAccount;
  } catch {
    throw new Error(`${backend} service-account key is not valid JSON — paste the full downloaded key file`);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error(`${backend} service-account key JSON is missing client_email / private_key`);
  }
  return sa;
}

const googleTokenCache = new Map<string, { token: string; expires: number }>();

async function googleAccessToken(sa: GoogleServiceAccount, scope: string): Promise<string> {
  const cacheKey = `${sa.client_email}|${scope}`;
  const cached = googleTokenCache.get(cacheKey);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google token request failed — HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google token endpoint returned no access_token");
  googleTokenCache.set(cacheKey, { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

// ── Google Cloud Storage ──────────────────────────────────────

const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

async function gcsAuth(cfg: FileBackendConfig): Promise<{ token: string; bucket: string }> {
  if (!cfg.gcs_bucket) throw new Error("GCS connection has no bucket configured");
  const sa = parseServiceAccount(cfg.gcs_service_account_json, "GCS");
  return { token: await googleAccessToken(sa, GCS_SCOPE), bucket: cfg.gcs_bucket };
}

async function gcsList(cfg: FileBackendConfig, prefix: string): Promise<StorageEntry[]> {
  const { token, bucket } = await gcsAuth(cfg);
  const pfx = dirPrefix(prefix);
  const params = new URLSearchParams({ delimiter: "/", maxResults: "500" });
  if (pfx) params.set("prefix", pfx);
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GCS list failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = (await res.json()) as { prefixes?: string[]; items?: { name: string; size?: string }[] };
  const folders: StorageEntry[] = (data.prefixes ?? []).map((p) => ({
    name: norm(p).slice(pfx.length), path: norm(p), isFolder: true,
  }));
  const files: StorageEntry[] = (data.items ?? [])
    .filter((i) => i.name !== pfx)
    .map((i) => ({ name: i.name.slice(pfx.length), path: i.name, isFolder: false, size: i.size ? parseInt(i.size, 10) : undefined }));
  return [...folders, ...files];
}

async function gcsDownload(cfg: FileBackendConfig, path: string): Promise<ArrayBuffer> {
  const { token, bucket } = await gcsAuth(cfg);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(norm(path))}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) }
  );
  if (!res.ok) throw new Error(`GCS download of "${path}" failed — HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function gcsUpload(cfg: FileBackendConfig, path: string, data: Uint8Array, contentType: string): Promise<UploadResult> {
  const { token, bucket } = await gcsAuth(cfg);
  const key = norm(path);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: data as unknown as BodyInit,
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!res.ok) throw new Error(`GCS upload to "${path}" failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return { path: key }; // signed URLs need V4 signing — log the gs:// location instead
}

async function gcsStat(cfg: FileBackendConfig, path: string): Promise<boolean> {
  const { token, bucket } = await gcsAuth(cfg);
  const res = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(norm(path))}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
  );
  return res.ok;
}

async function gcsTest(cfg: FileBackendConfig): Promise<string> {
  const { token, bucket } = await gcsAuth(cfg);
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?maxResults=1`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Bucket check failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return `Bucket "${bucket}" reachable with service-account credentials`;
}

// ── Google Drive ──────────────────────────────────────────────
// Path segments are resolved name-by-name starting at gdrive_folder_id.
// supportsAllDrives everywhere so shared drives work.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

async function driveAuth(cfg: FileBackendConfig): Promise<{ token: string; rootId: string }> {
  if (!cfg.gdrive_folder_id?.trim()) throw new Error("Google Drive connection has no root folder ID configured");
  const sa = parseServiceAccount(cfg.gdrive_service_account_json, "Google Drive");
  return { token: await googleAccessToken(sa, DRIVE_SCOPE), rootId: cfg.gdrive_folder_id.trim() };
}

async function driveQuery(token: string, q: string): Promise<{ id: string; name: string; mimeType: string; size?: string }[]> {
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,size)",
    pageSize: "500",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Drive query failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return ((await res.json()) as { files?: { id: string; name: string; mimeType: string; size?: string }[] }).files ?? [];
}

const driveEscape = (name: string) => name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Resolve a "/"-separated path to a Drive file/folder ID. Returns null if any segment is missing. */
async function driveResolve(token: string, rootId: string, path: string, createFolders = false):
  Promise<{ id: string; mimeType: string } | null> {
  let current = { id: rootId, mimeType: DRIVE_FOLDER_MIME };
  for (const seg of norm(path).split("/").filter(Boolean)) {
    const matches = await driveQuery(token, `'${current.id}' in parents and name = '${driveEscape(seg)}' and trashed = false`);
    let next = matches[0];
    if (!next) {
      if (!createFolders) return null;
      const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: seg, mimeType: DRIVE_FOLDER_MIME, parents: [current.id] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Drive folder create "${seg}" failed — HTTP ${res.status}`);
      next = (await res.json()) as { id: string; name: string; mimeType: string };
    }
    current = { id: next.id, mimeType: next.mimeType };
  }
  return current;
}

async function driveList(cfg: FileBackendConfig, prefix: string): Promise<StorageEntry[]> {
  const { token, rootId } = await driveAuth(cfg);
  const dir = norm(prefix) ? await driveResolve(token, rootId, prefix) : { id: rootId, mimeType: DRIVE_FOLDER_MIME };
  if (!dir) return [];
  const items = await driveQuery(token, `'${dir.id}' in parents and trashed = false`);
  const pfx = dirPrefix(prefix);
  return items.map((i) => ({
    name: i.name,
    path: pfx + i.name,
    isFolder: i.mimeType === DRIVE_FOLDER_MIME,
    size: i.size ? parseInt(i.size, 10) : undefined,
  }));
}

async function driveDownload(cfg: FileBackendConfig, path: string): Promise<ArrayBuffer> {
  const { token, rootId } = await driveAuth(cfg);
  const file = await driveResolve(token, rootId, path);
  if (!file) throw new Error(`Google Drive file "${path}" not found under the configured root folder`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Google Drive download of "${path}" failed — HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function driveUpload(cfg: FileBackendConfig, path: string, data: Uint8Array, contentType: string): Promise<UploadResult> {
  const { token, rootId } = await driveAuth(cfg);
  const key = norm(path);
  const slash = key.lastIndexOf("/");
  const dirPath = slash >= 0 ? key.slice(0, slash) : "";
  const fileName = slash >= 0 ? key.slice(slash + 1) : key;
  const dir = dirPath ? await driveResolve(token, rootId, dirPath, true) : { id: rootId, mimeType: DRIVE_FOLDER_MIME };
  if (!dir) throw new Error(`Google Drive folder "${dirPath}" could not be resolved`);

  const existing = (await driveQuery(token, `'${dir.id}' in parents and name = '${driveEscape(fileName)}' and trashed = false`))[0];
  const body = data as unknown as BodyInit;
  let res: Response;
  if (existing) {
    res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&supportsAllDrives=true&fields=id,webViewLink`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, body, signal: AbortSignal.timeout(120_000) }
    );
  } else {
    const boundary = "phx2_drive_upload";
    const metadata = JSON.stringify({ name: fileName, parents: [dir.id] });
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const multipart = new Uint8Array(Buffer.concat([Buffer.from(head), Buffer.from(data), Buffer.from(tail)]));
    res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart as unknown as BodyInit,
        signal: AbortSignal.timeout(120_000),
      }
    );
  }
  if (!res.ok) throw new Error(`Google Drive upload of "${path}" failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = (await res.json()) as { webViewLink?: string };
  return { path: key, url: out.webViewLink };
}

async function driveStat(cfg: FileBackendConfig, path: string): Promise<boolean> {
  const { token, rootId } = await driveAuth(cfg);
  return (await driveResolve(token, rootId, path)) !== null;
}

async function driveTest(cfg: FileBackendConfig): Promise<string> {
  const { token, rootId } = await driveAuth(cfg);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootId)}?fields=id,name&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Root folder not found — check the folder ID and share the folder with the service account's client_email"
        : `Root folder check failed — HTTP ${res.status}`
    );
  }
  const data = (await res.json()) as { name?: string };
  return `Drive folder "${data.name ?? rootId}" accessible with service-account credentials`;
}

// ── OneDrive (Microsoft Graph, client credentials) ────────────

const graphTokenCache = new Map<string, { token: string; expires: number }>();

async function graphToken(cfg: FileBackendConfig): Promise<string> {
  if (!cfg.od_tenant_id || !cfg.od_client_id || !cfg.od_client_secret) {
    throw new Error("OneDrive connection is missing tenant ID / client ID / client secret");
  }
  const cacheKey = `${cfg.od_tenant_id}|${cfg.od_client_id}`;
  const cached = graphTokenCache.get(cacheKey);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.od_tenant_id)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.od_client_id,
      client_secret: cfg.od_client_secret,
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Entra token request failed — HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Entra token endpoint returned no access_token");
  graphTokenCache.set(cacheKey, { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

function graphDriveBase(cfg: FileBackendConfig): string {
  if (cfg.od_drive_id?.trim()) return `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(cfg.od_drive_id.trim())}`;
  if (cfg.od_user_principal?.trim()) return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.od_user_principal.trim())}/drive`;
  throw new Error("OneDrive connection needs either a Drive ID or a user principal name (UPN)");
}

/** Graph item address: /root for the container root, /root:/path: otherwise. */
function graphItem(base: string, path: string, suffix = ""): string {
  const p = norm(path);
  if (!p) return `${base}/root${suffix ? "/" + suffix.replace(/^\//, "") : ""}`;
  const encoded = p.split("/").map(encodeURIComponent).join("/");
  return suffix ? `${base}/root:/${encoded}:/${suffix.replace(/^\//, "")}` : `${base}/root:/${encoded}`;
}

async function odList(cfg: FileBackendConfig, prefix: string): Promise<StorageEntry[]> {
  const token = await graphToken(cfg);
  const url = `${graphItem(graphDriveBase(cfg), prefix, "children")}?$select=name,size,folder,file&$top=500`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OneDrive list failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = (await res.json()) as { value?: { name: string; size?: number; folder?: object }[] };
  const pfx = dirPrefix(prefix);
  return (data.value ?? []).map((i) => ({
    name: i.name,
    path: pfx + i.name,
    isFolder: !!i.folder,
    size: i.size,
  }));
}

async function odDownload(cfg: FileBackendConfig, path: string): Promise<ArrayBuffer> {
  const token = await graphToken(cfg);
  const res = await fetch(graphItem(graphDriveBase(cfg), path, "content"), {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OneDrive download of "${path}" failed — HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function odUpload(cfg: FileBackendConfig, path: string, data: Uint8Array, contentType: string): Promise<UploadResult> {
  const token = await graphToken(cfg);
  const key = norm(path);
  // Simple upload handles files up to 250 MB — far beyond task exports.
  const res = await fetch(`${graphItem(graphDriveBase(cfg), key, "content")}?@microsoft.graph.conflictBehavior=replace`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: data as unknown as BodyInit,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`OneDrive upload of "${path}" failed — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = (await res.json()) as { webUrl?: string };
  return { path: key, url: out.webUrl };
}

async function odStat(cfg: FileBackendConfig, path: string): Promise<boolean> {
  const token = await graphToken(cfg);
  const res = await fetch(`${graphItem(graphDriveBase(cfg), path)}?$select=id`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

async function odTest(cfg: FileBackendConfig): Promise<string> {
  const token = await graphToken(cfg);
  const res = await fetch(`${graphDriveBase(cfg)}?$select=id,name,driveType`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 403) throw new Error("Token OK but Graph returned 403 — grant Files.ReadWrite.All (application) and admin-consent it");
    throw new Error(`Drive check failed — HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { name?: string; driveType?: string };
  return `Drive "${data.name ?? "(unnamed)"}" (${data.driveType ?? "?"}) accessible`;
}

// ── Public dispatch ───────────────────────────────────────────

export async function listStorage(cfg: FileBackendConfig, prefix = ""): Promise<StorageEntry[]> {
  switch (resolveBackend(cfg)) {
    case "s3":       return s3List(cfg, prefix);
    case "gcs":      return gcsList(cfg, prefix);
    case "gdrive":   return driveList(cfg, prefix);
    case "onedrive": return odList(cfg, prefix);
    default:         return sbList(prefix);
  }
}

export async function downloadStorage(cfg: FileBackendConfig, path: string): Promise<ArrayBuffer> {
  switch (resolveBackend(cfg)) {
    case "s3":       return s3Download(cfg, path);
    case "gcs":      return gcsDownload(cfg, path);
    case "gdrive":   return driveDownload(cfg, path);
    case "onedrive": return odDownload(cfg, path);
    default:         return sbDownload(path);
  }
}

export async function uploadStorage(cfg: FileBackendConfig, path: string, data: Uint8Array, contentType: string): Promise<UploadResult> {
  switch (resolveBackend(cfg)) {
    case "s3":       return s3Upload(cfg, path, data, contentType);
    case "gcs":      return gcsUpload(cfg, path, data, contentType);
    case "gdrive":   return driveUpload(cfg, path, data, contentType);
    case "onedrive": return odUpload(cfg, path, data, contentType);
    default:         return sbUpload(path, data, contentType);
  }
}

export async function statStorage(cfg: FileBackendConfig, path: string): Promise<boolean> {
  switch (resolveBackend(cfg)) {
    case "s3":       return s3Stat(cfg, path);
    case "gcs":      return gcsStat(cfg, path);
    case "gdrive":   return driveStat(cfg, path);
    case "onedrive": return odStat(cfg, path);
    default:         return sbStat(path);
  }
}

/** Credential/reachability check for /api/test-connection. Throws with a
 *  user-facing message on failure; returns a success message otherwise. */
export async function testStorage(cfg: FileBackendConfig): Promise<string> {
  switch (resolveBackend(cfg)) {
    case "s3":       return s3Test(cfg);
    case "gcs":      return gcsTest(cfg);
    case "gdrive":   return driveTest(cfg);
    case "onedrive": return odTest(cfg);
    default: {
      await sbList("");
      return `Supabase bucket "${SUPABASE_BUCKET}" reachable`;
    }
  }
}

/** Human-readable location string for logs, e.g. "s3://bucket/path". */
export function storageLocation(cfg: FileBackendConfig, path: string): string {
  const p = norm(path);
  switch (resolveBackend(cfg)) {
    case "s3":       return `s3://${cfg.s3_bucket}/${p}`;
    case "gcs":      return `gs://${cfg.gcs_bucket}/${p}`;
    case "gdrive":   return `Google Drive: ${p}`;
    case "onedrive": return `OneDrive: ${p}`;
    default:         return `${SUPABASE_BUCKET}/${p}`;
  }
}
