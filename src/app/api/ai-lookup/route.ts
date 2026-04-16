import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase-admin";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

// ── Singleton admin client ────────────────────────────────────────────────────
// Created once per process so every cache read/write reuses the same connection
// pool rather than reinitialising the client on every request (~100-200 ms saved).
let _adminClient: ReturnType<typeof createAdminClient> | null = null;
function getAdmin() {
  if (!_adminClient) _adminClient = createAdminClient();
  return _adminClient;
}

// ── Persistent cache helpers ──────────────────────────────────────────────────
//
// Cache key = SHA-256 of the canonical (sorted) inputs so identical lookups
// never hit the Anthropic API twice — regardless of session or user.

function makeCacheKey(inputs: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)))
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fetch multiple cache entries in a single IN query.
 * Returns a map of cache_key → result string for every hit.
 */
async function batchGetCached(keys: string[]): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  if (keys.length === 0) return hits;
  try {
    const sb = getAdmin();
    const { data } = await sb
      .from("ai_lookup_cache")
      .select("cache_key, result, hit_count")
      .in("cache_key", keys);
    if (data) {
      const now = new Date().toISOString();
      for (const row of data) {
        if (row.result) {
          hits.set(row.cache_key as string, row.result as string);
          // Fire-and-forget stats bump
          void sb
            .from("ai_lookup_cache")
            .update({ last_used_at: now, hit_count: (row.hit_count as number) + 1 })
            .eq("cache_key", row.cache_key);
        }
      }
    }
  } catch { /* cache errors are non-fatal */ }
  return hits;
}

/** Single-key convenience wrapper around batchGetCached. */
async function getCached(key: string): Promise<string | null> {
  const hits = await batchGetCached([key]);
  return hits.get(key) ?? null;
}

/** Persist a new cache entry. Best-effort — never throws. */
async function setCached(key: string, mode: string, result: string): Promise<void> {
  try {
    await getAdmin().from("ai_lookup_cache").upsert(
      { cache_key: key, mode, result, hit_count: 1, last_used_at: new Date().toISOString() },
      { onConflict: "cache_key", ignoreDuplicates: false }
    );
  } catch { /* best-effort */ }
}

// ── Claude call with exponential backoff ──────────────────────────────────────

const RETRY_STATUSES = new Set([429, 529]);
const MAX_RETRIES    = 5;
const BASE_DELAY_MS  = 1_000;   // 1 s → 2 s → 4 s → 8 s → 16 s

// Pricing constants for claude-haiku-4-5 ($ per million tokens).
// Update if Anthropic changes the rate card.
const HAIKU_INPUT_COST_PER_M  = 0.80;
const HAIKU_OUTPUT_COST_PER_M = 4.00;

interface ClaudeResult { text: string; inputTokens: number; outputTokens: number; }

async function callClaude(apiKey: string, system: string, user: string, maxTokens = 512): Promise<ClaudeResult> {
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const base  = BASE_DELAY_MS * 2 ** (attempt - 1);
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      const delay = Math.round(base + jitter);
      console.log(`[ai-lookup] Retry ${attempt}/${MAX_RETRIES} after ${delay} ms (${lastErr?.message.slice(0, 60)})`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      lastErr = new Error(`Anthropic API error HTTP ${response.status}: ${err.slice(0, 200)}`);
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) continue;
      throw lastErr;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.type === "text" ? (data.content[0].text as string) : "";
    const inputTokens  = (data?.usage?.input_tokens  as number | undefined) ?? 0;
    const outputTokens = (data?.usage?.output_tokens as number | undefined) ?? 0;
    return { text, inputTokens, outputTokens };
  }

  throw lastErr ?? new Error("callClaude: max retries exceeded");
}

// ── Snap raw AI value to the closest valid value ──────────────────────────────

function snapToValidValue(rawValue: string, validValues: string[]): { snapped: string; how: string } {
  // 1. Exact (case-insensitive)
  const exact = validValues.find((v) => v.toLowerCase() === rawValue.toLowerCase());
  if (exact) return { snapped: exact, how: "exact" };

  // 2. Substring containment
  const rawLower = rawValue.toLowerCase();
  const substr = validValues.find(
    (v) => rawLower.includes(v.toLowerCase()) || v.toLowerCase().includes(rawLower)
  );
  if (substr) return { snapped: substr, how: "substring" };

  // 3. Word-overlap scoring
  const rawWords = new Set(rawLower.split(/\W+/).filter(Boolean));
  let bestScore = 0;
  let bestMatch = "";
  for (const v of validValues) {
    const overlap = v.toLowerCase().split(/\W+/).filter((w) => rawWords.has(w)).length;
    if (overlap > bestScore) { bestScore = overlap; bestMatch = v; }
  }
  if (bestScore > 0) return { snapped: bestMatch, how: `word-overlap(${bestScore})` };

  return { snapped: rawValue, how: "no-snap" };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }

    // ── Mode: batch-guess ────────────────────────────────────────────────────
    // Accepts an array of guess requests, resolves all cache hits in one DB
    // query, then calls Claude only for the misses.  Returns Record<id, value>.
    if (body.mode === "batch-guess") {
      type BatchItem = {
        id: string;
        targetFieldName: string;
        sourceValues: Record<string, string>;
        validValues?: string[];
        customPrompt?: string;
      };
      const items = body.items as BatchItem[];
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: "items array is required" }, { status: 400 });
      }

      // Compute cache keys for every item
      const keyed = items.map((item) => ({
        item,
        cacheKey: makeCacheKey({
          mode: "guess",
          targetFieldName: item.targetFieldName,
          sourceValues: Object.fromEntries(Object.entries(item.sourceValues).sort()),
          validValues:   item.validValues ? [...item.validValues].sort() : [],
          customPrompt:  item.customPrompt ?? "",
        }),
      }));

      // Single DB query for all keys
      const allKeys  = keyed.map((k) => k.cacheKey);
      const cacheHits = await batchGetCached(allKeys);

      const results: Record<string, string> = {};
      const misses: typeof keyed = [];

      for (const { item, cacheKey } of keyed) {
        const hit = cacheHits.get(cacheKey);
        if (hit !== undefined) {
          results[item.id] = hit;
        } else {
          misses.push({ item, cacheKey });
        }
      }

      const hitCount  = Object.keys(results).length;
      const missCount = misses.length;
      console.log(`[ai-guess batch] ${items.length} items — ${hitCount} cache hits, ${missCount} Claude call(s)`);

      let batchInputTokens  = 0;
      let batchOutputTokens = 0;

      // Call Claude for each miss (sequential to respect rate limits)
      for (const { item, cacheKey } of misses) {
        try {
          const attributeLines = Object.entries(item.sourceValues)
            .filter(([, v]) => v != null && v !== "" && v !== "null")
            .map(([k, v]) => `- ${k}: ${v}`)
            .join("\n");

          const INLINE_LIMIT = 40;
          const useInline = (item.validValues?.length ?? 0) > 0 && (item.validValues?.length ?? 0) <= INLINE_LIMIT;
          const constraintLine = useInline
            ? `\nYou MUST return exactly one of these values (case-sensitive):\n${item.validValues!.map((v) => `  "${v}"`).join("\n")}\nReturn ONLY the value — no quotes, no explanation.`
            : `\nReturn ONLY the value text — no quotes, no explanation. If unknown, return "Unknown".`;

          const system = item.customPrompt?.trim()
            ? item.customPrompt.trim()
            : `You are an IT asset classification expert. Classify the asset into the correct CMDB field value.\n` +
              `Use the product model name and description as your primary signal — the model name almost always tells you the subtype.\n` +
              `Examples: "Dell Dock WD19S" → Docking Station; "Dell U2724D" → Monitor; "Dell OptiPlex" → Desktop; "Dell Latitude" → Laptop; "Dell Pro All-in-One" → All-In-One.\n` +
              `Be concise and accurate.`;

          const user = `Asset record:\n${attributeLines}\n\nWhat is the correct value for the field "${item.targetFieldName}"?${constraintLine}`;

          const { text: rawText, inputTokens, outputTokens } = await callClaude(apiKey, system, user, 128);
          batchInputTokens  += inputTokens;
          batchOutputTokens += outputTokens;
          let rawValue = rawText.trim().replace(/^["']|["']$/g, "").trim();

          if (item.validValues?.length) {
            const { snapped, how } = snapToValidValue(rawValue, item.validValues);
            if (how !== "no-snap") rawValue = snapped;
            console.log(`[ai-guess] "${item.targetFieldName}" AI="${rawValue}" snap=${how}`);
          } else {
            console.log(`[ai-guess] "${item.targetFieldName}" AI="${rawValue}" (no valid-values list)`);
          }

          results[item.id] = rawValue;
          if (rawValue) await setCached(cacheKey, "guess", rawValue);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[ai-guess] ERROR for item ${item.id}: ${msg}`);
          results[item.id] = "";
        }
      }

      return NextResponse.json({
        results,
        cacheHits: hitCount,
        claudeCalls: missCount,
        inputTokens:  batchInputTokens,
        outputTokens: batchOutputTokens,
      });
    }

    // ── Mode: ai_guess (single item — kept for backwards compat) ────────────
    if (body.mode === "guess") {
      const { targetFieldName, sourceValues, validValues, customPrompt } = body as {
        targetFieldName: string;
        sourceValues: Record<string, string>;
        validValues?: string[];
        customPrompt?: string;
      };
      if (!targetFieldName || !sourceValues) {
        return NextResponse.json({ error: "targetFieldName and sourceValues are required" }, { status: 400 });
      }

      const guessCacheKey = makeCacheKey({
        mode: "guess",
        targetFieldName,
        sourceValues: Object.fromEntries(Object.entries(sourceValues).sort()),
        validValues: validValues ? [...validValues].sort() : [],
        customPrompt: customPrompt ?? "",
      });
      const cachedGuess = await getCached(guessCacheKey);
      if (cachedGuess !== null) {
        console.log(`[ai-guess] CACHE HIT "${targetFieldName}" → "${cachedGuess}"`);
        return NextResponse.json({ value: cachedGuess });
      }

      const attributeLines = Object.entries(sourceValues)
        .filter(([, v]) => v != null && v !== "" && v !== "null")
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n");

      const INLINE_LIMIT = 40;
      const useInline = (validValues?.length ?? 0) > 0 && (validValues?.length ?? 0) <= INLINE_LIMIT;
      const constraintLine = useInline
        ? `\nYou MUST return exactly one of these values (case-sensitive):\n${validValues!.map((v) => `  "${v}"`).join("\n")}\nReturn ONLY the value — no quotes, no explanation.`
        : `\nReturn ONLY the value text — no quotes, no explanation. If unknown, return "Unknown".`;

      const system = customPrompt?.trim()
        ? customPrompt.trim()
        : `You are an IT asset classification expert. Classify the asset into the correct CMDB field value.\n` +
          `Use the product model name and description as your primary signal — the model name almost always tells you the subtype.\n` +
          `Examples: "Dell Dock WD19S" → Docking Station; "Dell U2724D" → Monitor; "Dell OptiPlex" → Desktop; "Dell Latitude" → Laptop; "Dell Pro All-in-One" → All-In-One.\n` +
          `Be concise and accurate.`;

      const user = `Asset record:\n${attributeLines}\n\nWhat is the correct value for the field "${targetFieldName}"?${constraintLine}`;

      const { text: rawGuessText, inputTokens: gi, outputTokens: go } = await callClaude(apiKey, system, user, 128);
      let rawValue = rawGuessText.trim().replace(/^["']|["']$/g, "").trim();

      if (validValues?.length) {
        const { snapped, how } = snapToValidValue(rawValue, validValues);
        if (how !== "no-snap") rawValue = snapped;
        console.log(`[ai-guess] "${targetFieldName}" AI="${rawValue}" snap=${how}`);
      }

      if (rawValue) await setCached(guessCacheKey, "guess", rawValue);
      return NextResponse.json({ value: rawValue, inputTokens: gi, outputTokens: go });
    }

    // ── Mode: ai_lookup (multi-key object) ───────────────────────────────────
    const { sourceValues, outputKeys, customPrompt } = body as {
      sourceValues: Record<string, string>;
      outputKeys: string[];
      customPrompt?: string;
    };
    if (!sourceValues || !outputKeys || outputKeys.length === 0) {
      return NextResponse.json({ error: "sourceValues and outputKeys are required" }, { status: 400 });
    }

    const lookupCacheKey = makeCacheKey({
      mode: "lookup",
      sourceValues: Object.fromEntries(Object.entries(sourceValues).sort()),
      outputKeys: [...outputKeys].sort(),
      customPrompt: customPrompt ?? "",
    });
    const cachedLookup = await getCached(lookupCacheKey);
    if (cachedLookup !== null) {
      console.log(`[ai-lookup] CACHE HIT keys=[${outputKeys.join(",")}]`);
      try { return NextResponse.json(JSON.parse(cachedLookup)); }
      catch { /* corrupt entry — fall through */ }
    }

    const attributeLines = Object.entries(sourceValues)
      .map(([k, v]) => `- ${k}: ${v ?? "(empty)"}`)
      .join("\n");
    const keyList = outputKeys.map((k) => `"${k}"`).join(", ");

    const system = customPrompt?.trim()
      ? customPrompt.trim()
      : `You are an IT asset and device classification expert. Given product attributes, accurately determine the requested fields using standard IT asset taxonomy (e.g. ITIL / CMDB conventions). Be concise and consistent. If a value genuinely cannot be determined, use "Unknown".`;

    const user =
      `Based on these product attributes:\n${attributeLines}\n\n` +
      `Return a JSON object with exactly these keys: ${keyList}\n\n` +
      `Rules:\n` +
      `- Respond with only valid JSON — no markdown, no explanation, no code fences.\n` +
      `- Values should be short, title-case strings.\n` +
      `- Do not add extra keys.`;

    const { text: rawLookupText, inputTokens: li, outputTokens: lo } = await callClaude(apiKey, system, user, 512);
    const cleaned = rawLookupText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    let result: Record<string, string>;
    try { result = JSON.parse(cleaned); }
    catch { result = Object.fromEntries(outputKeys.map((k) => [k, "Unknown"])); }
    for (const key of outputKeys) {
      if (!(key in result)) result[key] = "Unknown";
    }
    await setCached(lookupCacheKey, "lookup", JSON.stringify(result));
    console.log(`[ai-lookup] MISS → Claude called, result cached`);
    return NextResponse.json({ ...result, inputTokens: li, outputTokens: lo });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai-lookup] ERROR: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
