import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type FinderInput = {
  objective: string;
  location?: string | null;
  constraints?: string | null;
  limit?: number;
};

async function callAI(system: string, user: string, maxTokens = 900) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    throw new Error(`AI error ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 11 && raw.startsWith("+")) return `+${digits}`;
  return null;
}

async function searchWithFirecrawl(query: string, limit = 6) {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return [];

  const resp = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      scrapeOptions: { formats: ["markdown"] },
    }),
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  return data.data || data.results || [];
}

async function findCandidates(input: FinderInput) {
  const runId = crypto.randomUUID();
  const objective = String(input.objective || "").trim();
  const location = input.location || null;
  const constraints = input.constraints || null;
  const limit = Math.max(1, Math.min(input.limit || 8, 15));

  const intentSystem = `You are PRODUCT_FINDER. Return strict JSON only. Never invent phone numbers.`;
  const intentUser = `Objective: ${objective}\nLocation: ${location || "none"}\nConstraints: ${constraints || "none"}\nOutput JSON:\n{\n  "normalized_product":"string",\n  "category":"string",\n  "store_types":["string"],\n  "search_queries":["string"],\n  "must_have_signals":["string"],\n  "must_avoid_signals":["string"]\n}`;

  const intentRaw = await callAI(intentSystem, intentUser, 500);
  const intentJson = intentRaw.match(/\{[\s\S]*\}/)?.[0] || "{}";
  const productIntent = JSON.parse(intentJson);

  const searches = (productIntent.search_queries || []) as string[];
  const snippets: Array<{ title: string; url: string; content: string }> = [];
  const errors: Array<{ type: string; message: string; url: string | null }> = [];

  for (const query of searches.slice(0, 4)) {
    const rows = await searchWithFirecrawl(`${query}${location ? ` ${location}` : ""} phone contact`);
    if (!rows.length) {
      errors.push({ type: "search_empty", message: `No results for query: ${query}`, url: null });
      continue;
    }

    for (const row of rows.slice(0, 5)) {
      snippets.push({
        title: row.title || "",
        url: row.url || "",
        content: String(row.markdown || row.description || "").slice(0, 800),
      });
    }
  }

  const extractSystem = `You are PRODUCT_FINDER. Output strict JSON only. Never invent phone numbers/addresses. For each candidate include evidence quotes from snippets. If phone is not visible in snippets, set phone_e164 to null.`;
  const extractUser = `Objective: ${objective}\nLocation: ${location || "none"}\nSnippets JSON:\n${JSON.stringify(snippets)}\n\nReturn JSON:\n{\n  "candidates": [{\n    "store_id":"string",\n    "name":"string",\n    "brand":"string|null",\n    "phone_e164":"string|null",\n    "address":"string|null",\n    "city":"string|null",\n    "region":"string|null",\n    "country":"string|null",\n    "website":"string|null",\n    "department_hint":"string|null",\n    "evidence":[{"url":"string","source_type":"official_site|directory|other","quote":"string"}],\n    "score":0,\n    "confidence":"low|medium|high",\n    "why_ranked":"string"\n  }]\n}`;

  const extractedRaw = await callAI(extractSystem, extractUser);
  const extractedJson = extractedRaw.match(/\{[\s\S]*\}/)?.[0] || "{}";
  const extracted = JSON.parse(extractedJson);
  const dedupe = new Set<string>();

  const candidates = (extracted.candidates || [])
    .map((c: any) => {
      const phone = normalizePhone(c.phone_e164);
      const website = c.website || c.evidence?.[0]?.url || null;
      const storeId = c.store_id || crypto.randomUUID();
      const evidence = Array.isArray(c.evidence) ? c.evidence.filter((e: any) => e?.url && e?.quote) : [];
      return {
        store_id: storeId,
        name: c.name || "Unknown Store",
        brand: c.brand || null,
        phone_e164: phone,
        address: c.address || null,
        city: c.city || null,
        region: c.region || null,
        country: c.country || null,
        website,
        department_hint: c.department_hint || null,
        evidence,
        score: Number(c.score || 0),
        confidence: ["low", "medium", "high"].includes(c.confidence) ? c.confidence : "low",
        why_ranked: c.why_ranked || "",
      };
    })
    .filter((c: any) => {
      if (!c.phone_e164 || !c.evidence?.length) return false;
      const key = `${c.phone_e164}|${c.name.toLowerCase()}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    })
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit);

  return {
    product_finder_result: {
      run_id: runId,
      product_intent: {
        normalized_product: productIntent.normalized_product || objective,
        category: productIntent.category || "unknown",
        store_types: productIntent.store_types || [],
        search_queries: productIntent.search_queries || [],
        must_have_signals: productIntent.must_have_signals || [],
        must_avoid_signals: productIntent.must_avoid_signals || [],
      },
      candidates,
      errors,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "find-candidates";
    const body = await req.json().catch(() => ({}));

    if (!body?.objective) {
      return new Response(JSON.stringify({ error: "objective is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action !== "find-candidates" && action !== "expand-search") {
      return new Response(JSON.stringify({ error: `Unknown action ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await findCandidates(body);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[product-finder]", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
