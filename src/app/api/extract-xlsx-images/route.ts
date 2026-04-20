import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

/**
 * POST /api/extract-xlsx-images
 *
 * Downloads an xlsx file from Supabase Storage (task_files bucket), unzips it,
 * and extracts any images embedded via Insert → Picture (twoCellAnchor / oneCellAnchor).
 *
 * Returns an array of images, one per anchor, with the 0-based drawing row index
 * that the image is anchored to.  Drawing row 0 = Excel header row, so data row i
 * (0-based in the rows[] array produced by sheet_to_json) maps to drawing row i+1.
 *
 * Body:
 *   storageKey – path in the task_files Supabase Storage bucket
 *
 * Response:
 *   { images: Array<{ rowIndex: number; base64: string; mimeType: string; fileName: string }> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { storageKey?: string };
    const { storageKey } = body;

    if (!storageKey) {
      return NextResponse.json({ error: "Missing storageKey" }, { status: 400 });
    }

    // ── Download xlsx from Supabase Storage ───────────────────────────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("task_files")
      .download(storageKey);

    if (dlErr || !fileBlob) {
      return NextResponse.json(
        { error: `Failed to download file: ${dlErr?.message ?? "no data"}` },
        { status: 500 }
      );
    }

    const buffer = await fileBlob.arrayBuffer();

    // ── Open xlsx as zip ──────────────────────────────────────────────────────
    const zip = await JSZip.loadAsync(buffer);

    // ── Diagnostic: log all zip paths ─────────────────────────────────────────
    const allZipKeys = Object.keys(zip.files);
    console.log("[extract-xlsx-images] Zip contents:", allZipKeys.join(" | "));

    // ── Locate drawing file(s) ────────────────────────────────────────────────
    // Drawings live at xl/drawings/drawing1.xml (Excel always uses this name for
    // the first sheet's drawing part).  We scan all keys to be robust.
    const drawingKeys = allZipKeys.filter(
      (k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k)
    );

    console.log("[extract-xlsx-images] Drawing keys found:", drawingKeys);

    if (drawingKeys.length === 0) {
      // Log media files found anyway so we can diagnose alternate image storage
      const mediaKeys = allZipKeys.filter((k) => k.startsWith("xl/media/"));
      const cellImageKeys = allZipKeys.filter((k) => k.startsWith("xl/cellImages/"));
      console.log("[extract-xlsx-images] Media files:", mediaKeys);
      console.log("[extract-xlsx-images] Cell image files:", cellImageKeys);
      return NextResponse.json({ images: [], debug: { allZipKeys, mediaKeys, cellImageKeys } });
    }

    const results: { rowIndex: number; base64: string; mimeType: string; fileName: string }[] = [];

    for (const drawingKey of drawingKeys) {
      // e.g. "xl/drawings/drawing1.xml" → rels at "xl/drawings/_rels/drawing1.xml.rels"
      const drawingName = drawingKey.split("/").pop()!; // "drawing1.xml"
      const relsKey = `xl/drawings/_rels/${drawingName}.rels`;

      const drawingFile = zip.file(drawingKey);
      const relsFile    = zip.file(relsKey);
      if (!drawingFile || !relsFile) continue;

      const [drawingXml, relsXml] = await Promise.all([
        drawingFile.async("string"),
        relsFile.async("string"),
      ]);

      // ── Parse rels: rId → media target path ──────────────────────────────
      // <Relationship Id="rId1" Type="...image" Target="../media/image1.png"/>
      const rIdToTarget = new Map<string, string>();
      for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
        rIdToTarget.set(m[1], m[2]);
      }

      // ── Parse drawing XML: each anchor block → { rowIndex, rId } ─────────
      // Handles both twoCellAnchor and oneCellAnchor.
      // The <xdr:from><xdr:row>N</xdr:row> gives the 0-based row index.
      // The blip rId is in <a:blip r:embed="rId1"/>.
      const anchorRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
      for (const anchor of drawingXml.matchAll(anchorRe)) {
        const block    = anchor[1];
        const rowMatch = block.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
        const rIdMatch = block.match(/r:embed="([^"]+)"/);
        if (!rowMatch || !rIdMatch) continue;

        const rowIndex = parseInt(rowMatch[1], 10);
        const rId      = rIdMatch[1];
        const target   = rIdToTarget.get(rId);
        if (!target) continue;

        // Resolve relative path: target is like "../media/image1.png"
        // relative to xl/drawings/ → xl/media/image1.png
        const mediaPath = ("xl/drawings/" + target)
          .split("/")
          .reduce((acc: string[], part) => {
            if (part === "..") acc.pop();
            else if (part !== ".") acc.push(part);
            return acc;
          }, [])
          .join("/");

        const mediaFile = zip.file(mediaPath);
        if (!mediaFile) continue;

        const mediaBuffer = await mediaFile.async("arraybuffer");
        const base64 = Buffer.from(mediaBuffer).toString("base64");

        // Infer MIME type from extension
        const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "png";
        const mimeMap: Record<string, string> = {
          png:  "image/png",
          jpg:  "image/jpeg",
          jpeg: "image/jpeg",
          gif:  "image/gif",
          bmp:  "image/bmp",
          webp: "image/webp",
          svg:  "image/svg+xml",
          emf:  "image/x-emf",
          wmf:  "image/x-wmf",
        };
        const mimeType = mimeMap[ext] ?? "application/octet-stream";
        const fileName = mediaPath.split("/").pop() ?? `image.${ext}`;

        results.push({ rowIndex, base64, mimeType, fileName });
      }
    }

    // Sort by rowIndex so callers can rely on order
    results.sort((a, b) => a.rowIndex - b.rowIndex);

    return NextResponse.json({ images: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[extract-xlsx-images] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
