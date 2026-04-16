/**
 * Minimal ZIP reader for browser use.
 * Uses the browser's native DecompressionStream for deflate.
 * Supports stored (method 0) and deflated (method 8) entries.
 * Does NOT support ZIP64, encryption, or multi-disk archives.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CD   = 0x02014b50;
const SIG_LFH  = 0x04034b50;

export interface ZipEntry {
  /** Full path within the zip (e.g. "Q1/report.xlsx") */
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 = stored, 8 = deflated */
  method: number;
  localHeaderOffset: number;
}

// ── Central directory parsing ──────────────────────────────────

function findEOCD(view: DataView): { cdOffset: number; entries: number } | null {
  // Scan backwards for EOCD signature. Comment can be up to 65535 bytes.
  const minI = Math.max(0, view.byteLength - 22 - 65535);
  for (let i = view.byteLength - 22; i >= minI; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      const entries  = view.getUint16(i + 10, true);
      const cdOffset = view.getUint32(i + 16, true);
      return { cdOffset, entries };
    }
  }
  return null;
}

export function listZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view    = new DataView(buffer);
  const bytes   = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");

  const eocd = findEOCD(view);
  if (!eocd) throw new Error("Not a valid ZIP file (EOCD not found).");

  const result: ZipEntry[] = [];
  let offset = eocd.cdOffset;

  for (let i = 0; i < eocd.entries; i++) {
    if (view.byteLength - offset < 46) break;
    if (view.getUint32(offset, true) !== SIG_CD) break;

    const method              = view.getUint16(offset + 10, true);
    const compressedSize      = view.getUint32(offset + 20, true);
    const uncompressedSize    = view.getUint32(offset + 24, true);
    const filenameLen         = view.getUint16(offset + 28, true);
    const extraLen            = view.getUint16(offset + 30, true);
    const commentLen          = view.getUint16(offset + 32, true);
    const localHeaderOffset   = view.getUint32(offset + 42, true);

    const filename = decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLen));

    // Skip directory entries
    if (!filename.endsWith("/")) {
      result.push({ path: filename, compressedSize, uncompressedSize, method, localHeaderOffset });
    }

    offset += 46 + filenameLen + extraLen + commentLen;
  }

  return result;
}

/**
 * List files within a zip buffer, optionally filtered by extension glob
 * (e.g. "*.xlsx").  Returns full in-zip paths.
 */
export function listZipFiles(buffer: ArrayBuffer, filter?: string): string[] {
  const entries = listZipEntries(buffer);
  if (!filter || filter.trim() === "" || filter.trim() === "*") {
    return entries.map((e) => e.path);
  }
  // Support simple "*.ext" or ".ext" patterns
  const ext = filter.replace(/^\*/, "").toLowerCase();
  return entries
    .map((e) => e.path)
    .filter((p) => p.toLowerCase().endsWith(ext));
}

// ── File extraction ────────────────────────────────────────────

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds     = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write + close in the background (copy to ensure plain ArrayBuffer backing)
  const copy = new Uint8Array(data);
  (async () => {
    await writer.write(copy);
    await writer.close();
  })();

  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Extract a single file from a zip buffer by its full in-zip path.
 * Returns the decompressed file data as an ArrayBuffer.
 */
export async function extractZipFile(buffer: ArrayBuffer, path: string): Promise<ArrayBuffer> {
  const view  = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const entries = listZipEntries(buffer);
  const entry   = entries.find((e) => e.path === path);
  if (!entry) throw new Error(`File not found in zip: "${path}"`);

  // Parse local file header to find the data start offset
  const lhOff = entry.localHeaderOffset;
  if (view.getUint32(lhOff, true) !== SIG_LFH) {
    throw new Error(`Invalid local file header at offset ${lhOff}`);
  }
  const fnLen    = view.getUint16(lhOff + 26, true);
  const exLen    = view.getUint16(lhOff + 28, true);
  const dataOff  = lhOff + 30 + fnLen + exLen;

  const compressed = bytes.subarray(dataOff, dataOff + entry.compressedSize);

  if (entry.method === 0) {
    // Stored — no compression; slice() gives a plain ArrayBuffer-backed copy
    const copy = compressed.slice();
    return copy.buffer as ArrayBuffer;
  } else if (entry.method === 8) {
    // Deflat    // Deflated
    const out = await inflateRaw(compressed);
    return out.buffer as ArrayBuffer;
  } else {
    throw new Error(`Unsupported ZIP compression method: ${entry.method}`);
  }
}
