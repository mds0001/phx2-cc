import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

/**
 * POST /api/extract-xlsx-images
 *
 * Downloads an xlsx from Supabase Storage and extracts embedded images.
 * Handles two Excel image storage formats:
 *
 * 1. Traditional floating pictures (xl/drawings/drawingN.xml)
 *    Images are anchored to rows via <xdr:from><xdr:row>N</xdr:row>.
 *    Row 0 = header, so data row i → drawing row i+1.
 *
 * 2. Excel 365 "Place in Cell" images (xl/cellImages/)
 *    Images live in worksheet cells.  We parse the sheet XML to find
 *    which row each cell-image belongs to, then resolve through the
 *    cellImages rels → media files.
 *
 * In both cases rowIndex is 0-based and data row i → rowIndex i+1.
 *
 * Body:  { storageKey: string }
 * Response: { images: Array<{ rowIndex: number; base64: string; mimeType: string; fileName: string }> }
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
    const zip    = await JSZip.loadAsync(buffer);

    const allZipKeys = Object.keys(zip.files);
    console.log("[extract-xlsx-images] Zip keys:", allZipKeys.join(" | "));

    // ── Helper: MIME type from extension ─────────────────────────────────────
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", bmp: "image/bmp",  webp: "image/webp",
      svg: "image/svg+xml", emf: "image/x-emf", wmf: "image/x-wmf",
    };
    function extMime(path: string): string {
      const ext = path.split(".").pop()?.toLowerCase() ?? "png";
      return mimeMap[ext] ?? "application/octet-stream";
    }
    // Resolve a relative path against a base zip directory
    function resolveZipPath(base: string, relative: string): string {
      return (base + "/" + relative)
        .split("/")
        .reduce((acc: string[], part) => {
          if (part === "..") acc.pop();
          else if (part !== ".") acc.push(part);
          return acc;
        }, [])
        .join("/");
    }

    const results: { rowIndex: number; base64: string; mimeType: string; fileName: string }[] = [];

    // ══════════════════════════════════════════════════════════════════════════
    // Path 1: Traditional floating pictures (xl/drawings/drawingN.xml)
    // ══════════════════════════════════════════════════════════════════════════
    const drawingKeys = allZipKeys.filter(
      (k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k)
    );
    console.log("[extract-xlsx-images] Drawing keys:", drawingKeys);

    for (const drawingKey of drawingKeys) {
      const drawingName = drawingKey.split("/").pop()!;
      const relsKey     = `xl/drawings/_rels/${drawingName}.rels`;
      const drawingFile = zip.file(drawingKey);
      const relsFile    = zip.file(relsKey);
      if (!drawingFile || !relsFile) continue;

      const [drawingXml, relsXml] = await Promise.all([
        drawingFile.async("string"),
        relsFile.async("string"),
      ]);

      // Parse rels: rId → target path
      const rIdToTarget = new Map<string, string>();
      for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
        rIdToTarget.set(m[1], m[2]);
      }

      // Parse each anchor block → rowIndex + rId
      const anchorRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
      for (const anchor of drawingXml.matchAll(anchorRe)) {
        const block    = anchor[1];
        const rowMatch = block.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
        const rIdMatch = block.match(/r:embed="([^"]+)"/);
        if (!rowMatch || !rIdMatch) continue;

        const rowIndex = parseInt(rowMatch[1], 10);
        const target   = rIdToTarget.get(rIdMatch[1]);
        if (!target) continue;

        const mediaPath = resolveZipPath("xl/drawings", target);
        const mediaFile = zip.file(mediaPath);
        if (!mediaFile) continue;

        const base64 = Buffer.from(await mediaFile.async("arraybuffer")).toString("base64");
        results.push({ rowIndex, base64, mimeType: extMime(mediaPath), fileName: mediaPath.split("/").pop() ?? "image.png" });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Path 2: Excel 365 "Place in Cell" images
    // Images live in worksheet cells, stored in xl/cellImages/.
    // We parse sheet1.xml to find which row each cell-image is in, then
    // resolve: sheet rels → cellImageN.xml rels → media file.
    // ══════════════════════════════════════════════════════════════════════════
    const cellImageKeys = allZipKeys.filter((k) => /^xl\/cellImages\/cellImage\d+\.xml$/.test(k));
    console.log("[extract-xlsx-images] Cell image keys:", cellImageKeys);

    if (cellImageKeys.length > 0 && results.length === 0) {
      // Find the first worksheet XML — try sheet1.xml first, then scan
      const sheetKey = allZipKeys.find((k) => k === "xl/worksheets/sheet1.xml")
        ?? allZipKeys.find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
      const sheetRelsKey = sheetKey
        ? sheetKey.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels"
        : null;

      if (sheetKey && sheetRelsKey) {
        const sheetFile     = zip.file(sheetKey);
        const sheetRelsFile = zip.file(sheetRelsKey);

        if (sheetFile && sheetRelsFile) {
          const [sheetXml, sheetRelsXml] = await Promise.all([
            sheetFile.async("string"),
            sheetRelsFile.async("string"),
          ]);

          // Parse sheet rels: rId → cellImage path (relative to xl/worksheets/)
          const sheetRIdToTarget = new Map<string, string>();
          for (const m of sheetRelsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
            sheetRIdToTarget.set(m[1], m[2]);
          }

          // Parse sheet XML: find <c r="XN"> cells that contain a cellImage rId
          // Excel stores in-cell images in a cell's <extLst> like:
          //   <ext uri="{...}"><x14:cellImage><xdr:pic>...<a:blip r:embed="rId1"/>
          // We find the row number from the cell reference (e.g. "E3" → row 3).
          const cellRe = /<c\s[^>]*r="([A-Z]+(\d+))"[^>]*>([\s\S]*?)<\/c>/g;
          for (const cellMatch of sheetXml.matchAll(cellRe)) {
            const rowNum   = parseInt(cellMatch[2], 10); // 1-based Excel row
            const cellBody = cellMatch[3];
            // Look for r:embed inside extLst (cell image reference)
            const rIdMatch = cellBody.match(/r:embed="([^"]+)"/);
            if (!rIdMatch) continue;

            const rId     = rIdMatch[1];
            const relTarget = sheetRIdToTarget.get(rId); // e.g. "../cellImages/cellImage1.xml"
            if (!relTarget) continue;

            const cellImagePath = resolveZipPath("xl/worksheets", relTarget);
            const cellImageFile = zip.file(cellImagePath);
            if (!cellImageFile) continue;

            const cellImageXml = await cellImageFile.async("string");

            // Parse cellImage rels to find the actual media file
            const cellImageRelsPath = cellImagePath.replace(
              /^(xl\/cellImages\/)(.+)$/,
              "xl/cellImages/_rels/$2.rels"
            );
            const cellImageRelsFile = zip.file(cellImageRelsPath);
            if (!cellImageRelsFile) continue;

            const cellImageRelsXml = await cellImageRelsFile.async("string");

            // Get rId from cellImage XML blip
            const blipRIdMatch = cellImageXml.match(/r:embed="([^"]+)"/);
            if (!blipRIdMatch) continue;

            const mediaRIdMap = new Map<string, string>();
            for (const m of cellImageRelsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
              mediaRIdMap.set(m[1], m[2]);
            }
            const mediaTarget = mediaRIdMap.get(blipRIdMatch[1]);
            if (!mediaTarget) continue;

            const mediaPath = resolveZipPath("xl/cellImages", mediaTarget);
            const mediaFile = zip.file(mediaPath);
            if (!mediaFile) continue;

            const base64 = Buffer.from(await mediaFile.async("arraybuffer")).toString("base64");
            // rowNum is 1-based Excel row; row 1 = header, row 2 = data[0] → rowIndex = rowNum - 1
            results.push({
              rowIndex: rowNum - 1,
              base64,
              mimeType: extMime(mediaPath),
              fileName: mediaPath.split("/").pop() ?? "image.png",
            });
          }
        }
      }
    }

    results.sort((a, b) => a.rowIndex - b.rowIndex);
    console.log("[extract-xlsx-images] Found", results.length, "images, rowIndexes:", results.map(r => r.rowIndex));

    return NextResponse.json({ images: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[extract-xlsx-images] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
