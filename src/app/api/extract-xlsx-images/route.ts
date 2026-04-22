import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

/**
 * POST /api/extract-xlsx-images
 *
 * Downloads an xlsx from Supabase Storage and extracts embedded images.
 * Handles three Excel image storage formats:
 *
 * 1. Traditional floating pictures (xl/drawings/drawingN.xml)
 *    Images are anchored to rows via <xdr:from><xdr:row>N</xdr:row>.
 *    Row 0 = header, so data row i → drawing row i+1.
 *
 * 2. Excel 365 "Place in Cell" images — older format (xl/cellImages/)
 *    Images live in worksheet cells.  We parse the sheet XML to find
 *    which row each cell-image belongs to, then resolve through the
 *    cellImages rels → media files.
 *
 * 3. Excel 365 "Place in Cell" images — newer richData format (xl/richData/)
 *    Images stored via xl/richData/richValueRel.xml → xl/media/*.
 *    Row mapping via vm="N" attribute on cells in sheet1.xml, or
 *    positional fallback (image N → data row N).
 *
 * 4. Positional fallback — xl/media/ only, no structural mapping.
 *
 * In all cases rowIndex is 0-based and data row i → rowIndex i+1.
 *
 * Body:  { storageKey: string }
 * Response: { images: Array<{ rowIndex: number; base64: string; mimeType: string; fileName: string }>, zipKeys: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { storageKey?: string; xlsxBase64?: string };
    const { storageKey, xlsxBase64 } = body;

    let buffer: ArrayBuffer;

    if (xlsxBase64) {
      // Client already has the file buffer -- accept it directly to avoid a
      // redundant server-side Supabase storage download.
      console.log("[extract-xlsx-images] Using client-provided xlsxBase64 payload");
      const bytes = Buffer.from(xlsxBase64, "base64");
      buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } else if (storageKey) {
      // Fallback: download from Supabase Storage server-side.
      console.log("[extract-xlsx-images] Downloading from storage:", storageKey);
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const { data: fileBlob, error: dlErr } = await supabase.storage
        .from("task_files")
        .download(storageKey);
      if (dlErr || !fileBlob) {
        console.error("[extract-xlsx-images] Storage download failed:", dlErr?.message ?? "no data");
        return NextResponse.json(
          { error: `Failed to download file: ${dlErr?.message ?? "no data"}` },
          { status: 500 }
        );
      }
      buffer = await fileBlob.arrayBuffer();
    } else {
      return NextResponse.json({ error: "Missing storageKey or xlsxBase64" }, { status: 400 });
    }
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
    // Path 2: Excel 365 "Place in Cell" images — older cellImages format
    // Images live in worksheet cells, stored in xl/cellImages/.
    // ══════════════════════════════════════════════════════════════════════════
    const cellImageKeys = allZipKeys.filter((k) => /^xl\/cellImages\/cellImage\d+\.xml$/.test(k));
    console.log("[extract-xlsx-images] Cell image keys:", cellImageKeys);

    if (cellImageKeys.length > 0 && results.length === 0) {
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

          const sheetRIdToTarget = new Map<string, string>();
          for (const m of sheetRelsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
            sheetRIdToTarget.set(m[1], m[2]);
          }

          const cellRe = /<c\s[^>]*r="([A-Z]+(\d+))"[^>]*>([\s\S]*?)<\/c>/g;
          for (const cellMatch of sheetXml.matchAll(cellRe)) {
            const rowNum   = parseInt(cellMatch[2], 10);
            const cellBody = cellMatch[3];
            const rIdMatch = cellBody.match(/r:embed="([^"]+)"/);
            if (!rIdMatch) continue;

            const rId       = rIdMatch[1];
            const relTarget = sheetRIdToTarget.get(rId);
            if (!relTarget) continue;

            const cellImagePath = resolveZipPath("xl/worksheets", relTarget);
            const cellImageFile = zip.file(cellImagePath);
            if (!cellImageFile) continue;

            const cellImageXml = await cellImageFile.async("string");

            const cellImageRelsPath = cellImagePath.replace(
              /^(xl\/cellImages\/)(.+)$/,
              "xl/cellImages/_rels/$2.rels"
            );
            const cellImageRelsFile = zip.file(cellImageRelsPath);
            if (!cellImageRelsFile) continue;

            const cellImageRelsXml = await cellImageRelsFile.async("string");

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

    // ══════════════════════════════════════════════════════════════════════════
    // Path 3: Excel 365 "Place in Cell" images — newer richData format
    // xl/richData/richValueRel.xml lists ordered rIds → media files.
    // xl/worksheets/sheet1.xml cells with vm="N" attribute reference image N.
    // If vm attribute not present, fall back to positional mapping.
    // ══════════════════════════════════════════════════════════════════════════
    const richDataKeys = allZipKeys.filter((k) => k.startsWith("xl/richData/"));
    console.log("[extract-xlsx-images] richData keys:", richDataKeys);

    const richValueRelKey     = "xl/richData/richValueRel.xml";
    const richValueRelRelsKey = "xl/richData/_rels/richValueRel.xml.rels";

    if (richDataKeys.length > 0 && results.length === 0) {
      const richValueRelFile     = zip.file(richValueRelKey);
      const richValueRelRelsFile = zip.file(richValueRelRelsKey);

      console.log("[extract-xlsx-images] richValueRel file found:", !!richValueRelFile);
      console.log("[extract-xlsx-images] richValueRel rels file found:", !!richValueRelRelsFile);

      if (richValueRelFile && richValueRelRelsFile) {
        const [richValueRelXml, richValueRelRelsXml] = await Promise.all([
          richValueRelFile.async("string"),
          richValueRelRelsFile.async("string"),
        ]);

        console.log("[extract-xlsx-images] richValueRel XML:", richValueRelXml.slice(0, 800));
        console.log("[extract-xlsx-images] richValueRel rels XML:", richValueRelRelsXml.slice(0, 800));

        // Parse rels: rId → media target path
        const rIdToMedia = new Map<string, string>();
        for (const m of richValueRelRelsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
          rIdToMedia.set(m[1], m[2]);
        }

        // Get ordered rIds from richValueRel.xml
        const rIdOrder: string[] = [];
        for (const m of richValueRelXml.matchAll(/r:id="([^"]+)"/g)) {
          rIdOrder.push(m[1]);
        }
        console.log("[extract-xlsx-images] richData rId order:", rIdOrder);

        // Try to find row mapping via vm attribute on cells in sheet XML
        const sheetKey = allZipKeys.find((k) => k === "xl/worksheets/sheet1.xml")
          ?? allZipKeys.find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));

        const vmRowMap = new Map<number, number>(); // vmIndex (1-based) → Excel row (1-based)

        if (sheetKey) {
          const sheetFile = zip.file(sheetKey);
          if (sheetFile) {
            const sheetXml = await sheetFile.async("string");
            // Cells with vm="N" attribute: <c r="E2" ... vm="1" ...>
            const vmRe = /<c\s[^>]*r="[A-Z]+(\d+)"[^>]*\bvm="(\d+)"[^>]*/g;
            for (const m of sheetXml.matchAll(vmRe)) {
              const excelRow = parseInt(m[1], 10);
              const vmIndex  = parseInt(m[2], 10);
              vmRowMap.set(vmIndex, excelRow);
            }
            console.log("[extract-xlsx-images] vm→row map:", Array.from(vmRowMap.entries()));
          }
        }

        for (let idx = 0; idx < rIdOrder.length; idx++) {
          const rId         = rIdOrder[idx];
          const mediaTarget = rIdToMedia.get(rId);
          if (!mediaTarget) continue;

          const mediaPath = resolveZipPath("xl/richData", mediaTarget);
          const mediaFile = zip.file(mediaPath);
          if (!mediaFile) continue;

          // vm is 1-based so vmIndex idx+1 → Excel row; rowIndex = excelRow - 1
          // Fallback: image 0 → data row 1 → rowIndex 1
          let rowIndex: number;
          if (vmRowMap.has(idx + 1)) {
            rowIndex = vmRowMap.get(idx + 1)! - 1;
          } else {
            rowIndex = idx + 1;
          }

          const base64 = Buffer.from(await mediaFile.async("arraybuffer")).toString("base64");
          results.push({
            rowIndex,
            base64,
            mimeType: extMime(mediaPath),
            fileName: mediaPath.split("/").pop() ?? "image.png",
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Path 4: Positional fallback — xl/media/ image files, no structural mapping.
    // image[0] → rowIndex 1, image[1] → rowIndex 2, etc.
    // ══════════════════════════════════════════════════════════════════════════
    if (results.length === 0) {
      const mediaImageKeys = allZipKeys
        .filter((k) => /^xl\/media\//.test(k) && /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(k))
        .sort();
      console.log("[extract-xlsx-images] Fallback media keys:", mediaImageKeys);

      for (let idx = 0; idx < mediaImageKeys.length; idx++) {
        const mediaPath = mediaImageKeys[idx];
        const mediaFile = zip.file(mediaPath);
        if (!mediaFile) continue;
        const base64 = Buffer.from(await mediaFile.async("arraybuffer")).toString("base64");
        results.push({
          rowIndex: idx + 1,
          base64,
          mimeType: extMime(mediaPath),
          fileName: mediaPath.split("/").pop() ?? "image.png",
        });
      }
      if (mediaImageKeys.length > 0) {
        console.log("[extract-xlsx-images] Used positional fallback for", mediaImageKeys.length, "images");
      }
    }

    results.sort((a, b) => a.rowIndex - b.rowIndex);
    console.log("[extract-xlsx-images] Found", results.length, "images, rowIndexes:", results.map(r => r.rowIndex));

    return NextResponse.json({ images: results, zipKeys: allZipKeys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[extract-xlsx-images] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
