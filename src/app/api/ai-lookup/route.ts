import { NextRequest, NextResponse } from "next/server";

// ── POST /api/ai-lookup ───────────────────────────────────────
//
// Body: {
//   sourceValues: Record<string, string>,  // { "Model Number": "1234", "Manufacturer": "Dell" }
//   outputKeys:   string[],                // ["device_type", "sub_type", "description"]
//   customPrompt?: string                  // optional additional instructions
// }
//
// Response: Record<string, string>         // { device_type: "Laptop", sub_type: "...", ... }
//
export async function POST(request: NextRequest) {
  try {
    const { sourceValues, outputKeys, customPrompt } = (await request.json()) as {
      sourceValues: Record<string, string>;
      outputKeys: string[];
      customPrompt?: string;
    };

    if (!sourceValues || !outputKeys || outputKeys.length === 0) {
      return NextResponse.json(
        { error: "sourceValues and outputKeys are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // ── Build prompt ──────────────────────────────────────────
    const attributeLines = Object.entries(sourceValues)
      .map(([k, v]) => `- ${k}: ${v ?? "(empty)"}`)
      .join("\n");

    const keyList = outputKeys.map((k) => `"${k}"`).join(", ");

    const systemPrompt = customPrompt?.trim()
      ? customPrompt.trim()
      : `You are an IT asset and device classification expert. Given product attributes, accurately determine the requested fields using standard IT asset taxonomy (e.g. ITIL / CMDB conventions). Be concise and consistent. If a value genuinely cannot be determined from the provided attributes, use "Unknown".`;

    const userPrompt =
      `Based on these product attributes:\n${attributeLines}\n\n` +
      `Return a JSON object with exactly these keys: ${keyList}\n\n` +
      `Rules:\n` +
      `- Respond with only valid JSON — no markdown, no explanation, no code fences.\n` +
      `- Values should be short, title-case strings (e.g. "Laptop", "Business Laptop", "Dell Latitude 1234 — 14\\" business laptop").\n` +
      `- Do not add extra keys.`;

    // ── Call Claude Haiku ─────────────────────────────────────
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `Anthropic API error — HTTP ${response.status}: ${err.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const anthropicData = await response.json();
    const rawText: string =
      anthropicData?.content?.[0]?.type === "text"
        ? (anthropicData.content[0].text as string)
        : "{}";

    // Strip markdown code fences if the model wraps in them
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    let result: Record<string, string>;
    try {
      result = JSON.parse(cleaned);
    } catch {
      // If parse fails, return Unknown for all requested keys
      result = Object.fromEntries(outputKeys.map((k) => [k, "Unknown"]));
    }

    // Ensure all requested keys are present
    for (const key of outputKeys) {
      if (!(key in result)) result[key] = "Unknown";
    }

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
