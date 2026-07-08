import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * AI classification for software_research_queue items — the software sibling
 * of /api/sku-research-suggest. Given a raw detected-app string (publisher /
 * name / version) plus its co-installed context, Claude proposes:
 *   verdict        product | component_of | noise
 *   canonical identity (manufacturer / title / version / edition)
 *   licensable     false for free software (Chrome, 7-Zip, ...)
 *   name_pattern   generalized LIKE pattern for the signature
 *   confidence     0..1
 * The suggestion only prefills the resolve form — a human still saves it, and
 * the resulting signature still needs admin activation before it matches.
 */

interface SoftwareSuggestion {
  verdict: "product" | "component_of" | "noise";
  manufacturer: string;
  title: string;
  version: string;
  edition: string;
  licensable: boolean;
  name_pattern: string;
  publisher_match: string;
  confidence: number;
  reasoning: string;
}

async function classifyApp(
  publisher: string | null,
  name: string,
  version: string | null,
  coInstalled: string[],
): Promise<SoftwareSuggestion> {
  const prompt = [
    "You are a software asset management (SAM) normalization expert. A Windows endpoint's",
    "installed-programs inventory (Add/Remove Programs / MSI registrations) contains the entry",
    "below. Classify it for license reconciliation.",
    "",
    `Registered name: ${name}`,
    `Publisher: ${publisher || "(none)"}`,
    version ? `Version: ${version}` : "",
    coInstalled.length ? `Co-installed on the same device: ${coInstalled.join(" | ")}` : "",
    "",
    "Verdicts:",
    '  "product"      — the entry IS a real software product a user would recognize/install',
    "                   (even free ones like Chrome or 7-Zip are products — mark them licensable=false).",
    '  "component_of" — install debris that evidences a PARENT product (e.g. "Autodesk Material',
    '                   Library 2024" evidences AutoCAD; "Teams Machine-Wide Installer" evidences',
    "                   Microsoft 365 Apps). Then manufacturer/title/version/edition describe the PARENT.",
    '  "noise"        — not a product at all: runtimes, redistributables, drivers, updaters,',
    "                   telemetry/genuine services, maintenance helpers, language packs.",
    "",
    "Canonical identity rules: manufacturer is the company's common short name (Microsoft, Adobe,",
    "Autodesk — not 'Microsoft Corporation'). title is the product name WITHOUT manufacturer or",
    "version (e.g. 'AutoCAD', 'Acrobat', 'Photoshop'). version only when it is license-relevant",
    "(year editions like 2024; skip build numbers). edition only when it affects licensing",
    "(Pro, Standard, Enterprise). licensable=true only if the product is something an organization",
    "purchases/subscribes to.",
    "",
    "name_pattern: generalize the registered name into a SQL LIKE pattern (% = wildcard) that would",
    "match this entry and obvious siblings (other languages/builds) but nothing unrelated —",
    "e.g. 'AutoCAD 2024%' or 'Microsoft Visual C++%Redistributable%'. Keep it anchored and specific.",
    "publisher_match: the exact publisher string to require, or empty string to match any publisher.",
    "",
    "Return ONLY a valid JSON object (no markdown, no extra keys):",
    "{",
    '  "verdict": "product|component_of|noise",',
    '  "manufacturer": "<canonical manufacturer, empty for noise>",',
    '  "title": "<canonical product title, empty for noise>",',
    '  "version": "<license-relevant version or empty>",',
    '  "edition": "<license-relevant edition or empty>",',
    '  "licensable": true,',
    '  "name_pattern": "<LIKE pattern>",',
    '  "publisher_match": "<exact publisher or empty>",',
    '  "confidence": 0.0,',
    '  "reasoning": "<one short sentence>"',
    "}",
  ].filter(Boolean).join("\n");

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
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error("Anthropic API error " + res.status + ": " + (await res.text()));
  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = data.content[0]?.type === "text" ? data.content[0].text.trim() : "";
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(clean) as Partial<SoftwareSuggestion>;

  const verdict = parsed.verdict === "component_of" || parsed.verdict === "noise" ? parsed.verdict : "product";
  return {
    verdict,
    manufacturer: parsed.manufacturer ?? "",
    title: parsed.title ?? "",
    version: parsed.version ?? "",
    edition: parsed.edition ?? "",
    licensable: parsed.licensable !== false,
    name_pattern: parsed.name_pattern || name,
    publisher_match: parsed.publisher_match ?? (publisher ?? ""),
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: parsed.reasoning ?? "",
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as { queue_id?: string };
    if (!body.queue_id) return NextResponse.json({ error: "queue_id required" }, { status: 400 });

    const admin = createAdminClient();
    const { data: item } = await admin
      .from("software_research_queue")
      .select("id, publisher, name, sample_version, context")
      .eq("id", body.queue_id)
      .single();
    if (!item) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });

    const coInstalled = Array.isArray((item.context as { co_installed_sample?: string[] } | null)?.co_installed_sample)
      ? ((item.context as { co_installed_sample: string[] }).co_installed_sample).slice(0, 10)
      : [];

    const suggestion = await classifyApp(item.publisher, item.name, item.sample_version, coInstalled);
    return NextResponse.json({ suggestion });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[software-research-suggest] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
