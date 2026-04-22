import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/ivanti-attachment
 *
 * Downloads a file from Supabase Storage (task_files bucket) and attaches it
 * to an Ivanti HEAT record using the FRSHEATIntegration SOAP service.
 *
 * Flow:
 *   1. Connect  (SOAP) -> sessionKey
 *   2. Download file from Supabase Storage
 *   3. AddAttachment (SOAP) with base64-encoded file data
 *   4. Disconnect (SOAP) — always, even on error
 *
 * Body:
 *   ivantiUrl      - Ivanti base URL  (e.g. https://host.company.com)
 *   username       - Ivanti login username  (login_username in connection config)
 *   password       - Ivanti login password  (login_password in connection config)
 *   tenant         - Ivanti tenant name     (tenant_id in connection config)
 *   businessObject - Ivanti BO type         (e.g. "CI#")
 *   recordRecId    - RecId of the target record
 *   storageKey     - Supabase Storage path in the task_files bucket
 *   fileName       - filename to attach     (e.g. "image.png")
 */

const SOAP_NS  = "http://www.frontrange.com/";
const SOAP_ENV = 'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"';

function escXml(s: string): string {
  return s
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&apos;");
}

function buildConnectEnvelope(username: string, password: string, tenant: string): string {
  const ns = `${SOAP_ENV} xmlns:frs="${SOAP_NS}"`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope ${ns}><soap:Body>` +
    `<frs:Connect>` +
    `<frs:sessionType>User</frs:sessionType>` +
    `<frs:username>${escXml(username)}</frs:username>` +
    `<frs:password>${escXml(password)}</frs:password>` +
    `<frs:authType>Auto</frs:authType>` +
    `<frs:profileType>Default</frs:profileType>` +
    `<frs:tenant>${escXml(tenant)}</frs:tenant>` +
    `</frs:Connect>` +
    `</soap:Body></soap:Envelope>`
  );
}

function buildAddAttachmentEnvelope(
  sessionKey: string, tenant: string,
  objectType: string, objectId: string,
  fileName: string, fileDataB64: string,
): string {
  const ns = `${SOAP_ENV} xmlns:frs="${SOAP_NS}"`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope ${ns}><soap:Body>` +
    `<frs:AddAttachment>` +
    `<frs:sessionKey>${escXml(sessionKey)}</frs:sessionKey>` +
    `<frs:tenant>${escXml(tenant)}</frs:tenant>` +
    `<frs:objAttachmentCommandData>` +
    `<frs:ObjectId>${escXml(objectId)}</frs:ObjectId>` +
    `<frs:ObjectType>${escXml(objectType)}</frs:ObjectType>` +
    `<frs:fileName>${escXml(fileName)}</frs:fileName>` +
    `<frs:fileData>${fileDataB64}</frs:fileData>` +
    `</frs:objAttachmentCommandData>` +
    `</frs:AddAttachment>` +
    `</soap:Body></soap:Envelope>`
  );
}

function buildDisconnectEnvelope(sessionKey: string): string {
  const ns = `${SOAP_ENV} xmlns:frs="${SOAP_NS}"`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope ${ns}><soap:Body>` +
    `<frs:Disconnect>` +
    `<frs:sessionKey>${escXml(sessionKey)}</frs:sessionKey>` +
    `</frs:Disconnect>` +
    `</soap:Body></soap:Envelope>`
  );
}

/** Extract the text content of the first matching XML element (namespace-agnostic). */
function extractXml(xml: string, tag: string): string | null {
  const re = new RegExp(`<[^>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, "i");
  const m  = xml.match(re);
  return m ? m[1].trim() : null;
}

async function soapPost(endpoint: string, envelope: string, action: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction":   `"${SOAP_NS}${action}"`,
    },
    body: envelope,
  });
  const text = await res.text();
  if (res.status >= 400) {
    throw new Error(`SOAP ${action} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return text;
}

export async function POST(request: NextRequest) {
  let sessionKey:  string | null = null;
  let soapEndpoint = "";

  try {
    const body = await request.json() as {
      ivantiUrl:      string;
      username:       string;
      password:       string;
      tenant:         string;
      businessObject: string;
      recordRecId:    string;
      storageKey:     string;
      fileName:       string;
    };

    const {
      ivantiUrl, username, password, tenant,
      businessObject, recordRecId, storageKey, fileName,
    } = body;

    const missing = [
      !ivantiUrl      && "ivantiUrl",
      !username       && "username",
      !password       && "password",
      !businessObject && "businessObject",
      !recordRecId    && "recordRecId",
      !storageKey     && "storageKey",
      !fileName       && "fileName",
    ].filter(Boolean);

    if (missing.length > 0) {
      return NextResponse.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const effectiveTenant = tenant || "default";
    const base = ivantiUrl.replace(/\/$/, "");
    soapEndpoint = `${base}/ServiceAPI/FRSHEATIntegration.asmx`;

    // ── Step 1: Connect ───────────────────────────────────────────────────────
    console.log(`[ivanti-attachment] Connecting to ${soapEndpoint} as ${username}`);
    const connectXml = await soapPost(
      soapEndpoint,
      buildConnectEnvelope(username, password, effectiveTenant),
      "Connect",
    );

    const connectStatus = extractXml(connectXml, "status");
    if (connectStatus !== "Success") {
      const reason = extractXml(connectXml, "exceptionReason") ?? connectXml.slice(0, 300);
      throw new Error(`SOAP Connect failed (${connectStatus}): ${reason}`);
    }

    sessionKey = extractXml(connectXml, "sessionKey");
    if (!sessionKey) {
      throw new Error("SOAP Connect: no sessionKey in response");
    }
    console.log(`[ivanti-attachment] Connected, key=${sessionKey.slice(0, 8)}...`);

    // ── Step 2: Download file from Supabase Storage ───────────────────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("task_files")
      .download(storageKey);

    if (downloadError || !fileBlob) {
      throw new Error(`Storage download failed: ${downloadError?.message ?? "no data"}`);
    }

    const fileBuffer  = await fileBlob.arrayBuffer();
    const fileDataB64 = Buffer.from(fileBuffer).toString("base64");
    console.log(`[ivanti-attachment] File ready: ${fileName} (${fileBuffer.byteLength} bytes)`);

    // ── Step 3: AddAttachment ─────────────────────────────────────────────────
    const addXml = await soapPost(
      soapEndpoint,
      buildAddAttachmentEnvelope(sessionKey, effectiveTenant, businessObject, recordRecId, fileName, fileDataB64),
      "AddAttachment",
    );

    const addStatus  = extractXml(addXml, "status") ?? "";
    const addReason  = extractXml(addXml, "exceptionReason") ?? "";
    console.log(`[ivanti-attachment] AddAttachment status=${addStatus} reason=${addReason}`);

    const alreadyAttached = addReason.toLowerCase().includes("is already attached");
    if (addStatus !== "Success" && !alreadyAttached) {
      throw new Error(`AddAttachment failed (${addStatus}): ${addReason}`);
    }

    return NextResponse.json({ success: true, status: addStatus, alreadyAttached });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ivanti-attachment] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });

  } finally {
    // Step 4: Disconnect (best-effort)
    if (sessionKey && soapEndpoint) {
      soapPost(soapEndpoint, buildDisconnectEnvelope(sessionKey), "Disconnect")
        .then(() => console.log("[ivanti-attachment] Disconnected"))
        .catch((e: unknown) => console.warn("[ivanti-attachment] Disconnect failed (ignored):", e));
    }
  }
}
