import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

interface TaxonomySuggestion {
  manufacturer: string;
  type: string;
  subtype: string;
  description: string;
  model: string;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Step 1: CDW product lookup ─────────────────────────────────────────────

async function lookupCdw(sku: string): Promise<string | null> {
  try {
    const url = `https://www.cdw.com/search/?key=${encodeURIComponent(sku)}&searchscope=all`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try JSON-LD structured data first (most reliable)
    const jsonLdMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of jsonLdMatches) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const nodes = item["@graph"] ? item["@graph"] : [item];
          for (const node of nodes) {
            if (node["@type"] === "Product" && node.name) return String(node.name);
          }
        }
      } catch { /* continue */ }
    }

    // Try og:title
    const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
      ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
    if (ogMatch?.[1] && !ogMatch[1].toLowerCase().includes("search")) return ogMatch[1].trim();

    // Try <title>
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      const t = titleMatch[1].replace(/\s*[|\-–]\s*CDW.*$/i, "").trim();
      if (t && !t.toLowerCase().includes("search") && t.length > 5) return t;
    }

    return null;
  } catch {
    return null;
  }
}

// ── Step 2: Extract model hints from purchase record context ───────────────

const MODEL_CONTEXT_KEYS = [
  "description", "product description", "product name", "item description",
  "line description", "mfr part", "mfr part #", "manufacturer part",
  "manufacturer part number", "part number", "part description",
  "short description", "long description", "catalog description",
];

function extractModelFromContext(context: Record<string, string> | null): string | null {
  if (!context) return null;
  for (const [k, v] of Object.entries(context)) {
    if (MODEL_CONTEXT_KEYS.some((key) => k.toLowerCase().includes(key.split(" ")[0]))) {
      if (v && v.trim().length > 3) return v.trim();
    }
  }
  return null;
}

// ── Step 3: Web search via DuckDuckGo ─────────────────────────────────────

async function webSearch(sku: string, manufacturer?: string): Promise<string | null> {
  try {
    const query = manufacturer
      ? `${manufacturer} "${sku}" product specifications`
      : `"${sku}" IT product specifications manufacturer`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract first few result titles and snippets
    const titles   = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)]
      .slice(0, 3).map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]
      .slice(0, 2).map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);

    return [...titles, ...snippets].join(" | ").slice(0, 400) || null;
  } catch {
    return null;
  }
}

// ── Main classify function ─────────────────────────────────────────────────

async function classifySku(sku: string, context: Record<string, string> | null): Promise<TaxonomySuggestion> {
  // Step 1: CDW lookup
  const cdwProduct = await lookupCdw(sku);

  // Step 2: Context model hints
  const contextModel = extractModelFromContext(context);

  // Step 3: Web search — always run if CDW came up empty
  let webResult: string | null = null;
  if (!cdwProduct) {
    const knownManufacturers = ["Dell", "HP", "Lenovo", "Apple", "Cisco", "Microsoft", "Logitech", "Samsung", "Zebra", "Polycom", "Jabra", "Plantronics", "Yealink", "Avaya"];
    const productText = (contextModel ?? sku).toLowerCase();
    const detectedMfr = knownManufacturers.find((m) => productText.includes(m.toLowerCase()));
    webResult = await webSearch(sku, detectedMfr ?? undefined);
  }

  // Build enriched context for Claude
  const contextLines = context
    ? Object.entries(context)
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    : null;

  const enrichedLines = [
    cdwProduct   ? `CDW Product Name: ${cdwProduct}` : null,
    contextModel ? `Purchase Record Description: ${contextModel}` : null,
    webResult    ? `Web Search Results: ${webResult}` : null,
  ].filter(Boolean).join("\n");

  const promptParts = [
    "You are an IT asset classification expert. Classify the following manufacturer SKU into taxonomy fields.",
    "",
    "Manufacturer SKU: " + sku,
    enrichedLines ? ("\nProduct lookup results (use these to determine manufacturer and model):\n" + enrichedLines) : "",
    contextLines  ? ("\nAdditional context from purchase record:\n" + contextLines) : "",
    "",
    "Valid types (choose exactly one): Computer, MobileDevice, PeripheralDevice, ivnt_Infrastructure, ivnt_GeneralAsset",
    "",
    "Valid subtypes by type:",
    "  Computer: All-In-One, Desktop, Laptop, Server, Thin Client, Tablet, Virtual Client, Virtual Desktop, Virtual Server",
    "  MobileDevice: Audio Device, Smart Phone, Tablet, Wearable",
    "  PeripheralDevice: Badge, CC Reader, Display, Dock, Document Scanner, Fax, Hard-Drive, Monitor, Monitor 13 Inch, Monitor 15 Inch, Printer, Projector, Reader, Scanner, UPS, USB, Web Cam",
    "  ivnt_Infrastructure: Access Point, Barcode Scanner, Chassis, Database, Firewall, Generator, Hub, Management, Network MFD, Network Test, NIC Module, Phone, Printer, Projector, Rack, Router, SAN, Scanner, Security, Switch, Telephony, UPS, Video Conference",
    "  ivnt_GeneralAsset: BatchJob, Cart, Certificate, Cluster, Document, ESX, Headphones, Middleware, ProductivityApp, System, TV, VOIP",
    "",
    "Return ONLY a valid JSON object with ALL of these fields populated (no markdown, no explanation, no extra keys):",
    "{",
    '  "manufacturer": "<company name, e.g. Dell, HP, Cisco, Lenovo>",',
    '  "type": "<one of the valid types listed above>",',
    '  "subtype": "<one of the valid subtypes for the chosen type>",',
    '  "description": "<1 sentence product description under 100 chars>",',
    '  "model": "<exact model name/number — extract from CDW Product Name or Purchase Record Description above>"',
    "}",
    "",
    "Fill every field to the best of your ability. Use an empty string only if a field truly cannot be determined.",
  ];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: promptParts.join("\n") }],
    }),
  });

  if (!res.ok) throw new Error("Anthropic API error " + res.status + ": " + (await res.text()));
  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = data.content[0]?.type === "text" ? data.content[0].text.trim() : "";
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(clean) as Partial<TaxonomySuggestion>;

  return {
    manufacturer: parsed.manufacturer ?? "",
    type:         parsed.type ?? "",
    subtype:      parsed.subtype ?? "",
    description:  parsed.description ?? "",
    model:        parsed.model ?? "",
  };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { queue_id?: string; queue_ids?: string[]; sku?: string };
    const admin = createAdminClient();

    // Direct SKU lookup (no queue item required — used from Tasks with Exceptions view)
    if (body.sku && !body.queue_id && !body.queue_ids?.length) {
      const suggestion = await classifySku(body.sku.trim().toUpperCase(), null);
      return NextResponse.json({ suggestion, sku: body.sku });
    }

    if (body.queue_ids?.length) {
      const { data: items } = await admin
        .from("sku_research_queue")
        .select("id, manufacturer_sku, context")
        .in("id", body.queue_ids);

      if (!items?.length) {
        return NextResponse.json({ error: "No queue items found" }, { status: 404 });
      }

      const results = await Promise.all(
        items.map(async (item) => {
          try {
            const suggestion = await classifySku(
              item.manufacturer_sku,
              item.context as Record<string, string> | null,
            );
            return { queue_id: item.id, sku: item.manufacturer_sku, suggestion };
          } catch (e) {
            return { queue_id: item.id, sku: item.manufacturer_sku, error: String(e) };
          }
        })
      );

      return NextResponse.json({ results });
    }

    if (!body.queue_id) {
      return NextResponse.json({ error: "queue_id, queue_ids, or sku required" }, { status: 400 });
    }

    const { data: item } = await admin
      .from("sku_research_queue")
      .select("id, manufacturer_sku, context")
      .eq("id", body.queue_id)
      .single();

    if (!item) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    const suggestion = await classifySku(
      item.manufacturer_sku,
      item.context as Record<string, string> | null,
    );

    return NextResponse.json({ suggestion, sku: item.manufacturer_sku });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sku-research-suggest] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
