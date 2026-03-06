import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { objective, location, product_hint } = await req.json();

    if (!objective) {
      return new Response(
        JSON.stringify({ success: false, error: "objective is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    console.log("[search-stores] Analyzing objective:", objective);

    // Step 1: Use AI to understand what KIND of store to search for
    const analysisResp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a smart shopping assistant. Given a user's call objective (what they want to order/buy by phone), determine:
1. The EXACT product they want
2. What TYPE of store actually sells this product
3. The correct search queries to find stores that carry this product

IMPORTANT RULES:
- Think about WHERE this product is actually sold. For example:
  - "Meta Ray-Ban smart glasses" → sold at electronics stores, Best Buy, Meta Store, tech retailers, NOT sunglasses shops
  - "Nike Air Max shoes" → sold at shoe stores, Foot Locker, Nike Store, NOT general clothing stores
  - "Large pepperoni pizza" → sold at pizza restaurants like Domino's, Papa John's, local pizzerias
  - "iPhone 15" → sold at Apple Store, Best Buy, carrier stores (AT&T, Verizon), NOT random phone accessory shops
  - "KitchenAid mixer" → sold at Williams Sonoma, Sur La Table, Best Buy, NOT grocery stores
  
- Generate 3-5 specific search queries that will find ACTUAL stores selling this product
- Include the location if provided
- Focus on stores that can take phone orders

Output EXACTLY this JSON:
{
  "product": "exact product name",
  "product_category": "the real category (e.g. 'electronics', 'pizza restaurant', 'shoe store')",
  "store_types": ["list of store types that actually sell this"],
  "search_queries": ["query1", "query2", "query3"],
  "known_retailers": ["list of well-known chains that sell this product with typical phone format"]
}`,
          },
          {
            role: "user",
            content: `Objective: ${objective}${location ? `\nLocation: ${location}` : ""}${product_hint ? `\nProduct hint: ${product_hint}` : ""}`,
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!analysisResp.ok) {
      throw new Error(`AI analysis failed: ${analysisResp.status}`);
    }

    const analysisData = await analysisResp.json();
    const analysisText = analysisData.choices?.[0]?.message?.content || "";
    console.log("[search-stores] AI analysis:", analysisText);

    let analysis: any;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      analysis = null;
    }

    if (!analysis) {
      return new Response(
        JSON.stringify({ success: false, error: "Could not analyze objective" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Search for actual stores using Firecrawl or web search
    const stores: Array<{ name: string; phone: string; address?: string; why?: string }> = [];

    if (FIRECRAWL_API_KEY) {
      // Use Firecrawl search for each query
      for (const query of (analysis.search_queries || []).slice(0, 3)) {
        try {
          console.log("[search-stores] Firecrawl search:", query);
          const searchResp = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `${query} phone number`,
              limit: 5,
              scrapeOptions: { formats: ["markdown"] },
            }),
          });

          if (searchResp.ok) {
            const searchData = await searchResp.json();
            const results = searchData.data || searchData.results || [];

            // Step 3: Extract store info from search results using AI
            if (results.length > 0) {
              const resultsText = results
                .map((r: any, i: number) => `Result ${i + 1}:\nTitle: ${r.title || "N/A"}\nURL: ${r.url || "N/A"}\nContent: ${(r.markdown || r.description || "").slice(0, 500)}`)
                .join("\n\n---\n\n");

              const extractResp = await fetch(AI_URL, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  messages: [
                    {
                      role: "system",
                      content: `Extract store names and phone numbers from these search results. 
ONLY include stores that ACTUALLY SELL "${analysis.product}". 
Store types that sell this: ${(analysis.store_types || []).join(", ")}

CRITICAL: Do NOT include stores that are irrelevant. For example:
- For "Meta smart glasses", do NOT include sunglasses shops, opticians, or eyewear stores
- For "pizza", do NOT include Italian fine dining or grocery stores
- Only include stores where you can actually BUY the specific product

Output JSON array:
[{"name": "Store Name", "phone": "+1XXXXXXXXXX", "address": "if available", "why": "brief reason this store sells the product"}]

If no relevant stores found, return empty array [].
Phone numbers MUST be in +1XXXXXXXXXX format. Convert any format like (555) 123-4567 to +15551234567.
If a phone number is not found for a result, skip it.`,
                    },
                    { role: "user", content: resultsText },
                  ],
                  max_tokens: 400,
                }),
              });

              if (extractResp.ok) {
                const extractData = await extractResp.json();
                const extractText = extractData.choices?.[0]?.message?.content || "";
                try {
                  const jsonMatch = extractText.match(/\[[\s\S]*\]/);
                  if (jsonMatch) {
                    const extracted = JSON.parse(jsonMatch[0]);
                    for (const s of extracted) {
                      if (s.name && s.phone && !stores.some((e) => e.phone === s.phone)) {
                        stores.push(s);
                      }
                    }
                  }
                } catch {
                  console.error("[search-stores] Failed to parse extracted stores");
                }
              }
            }
          }
        } catch (e) {
          console.error("[search-stores] Firecrawl search error:", e);
        }
      }
    }

    // Step 3b: If Firecrawl didn't find enough, use AI's known retailers as fallback
    if (stores.length < 3 && analysis.known_retailers?.length > 0) {
      console.log("[search-stores] Using known retailers as fallback");
      
      const fallbackResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a store directory. Given a product and list of known retailers, provide their real phone numbers.
ONLY include stores that ACTUALLY SELL the product "${analysis.product}".
Product category: ${analysis.product_category}
${location ? `Location preference: ${location}` : ""}

Output JSON array of stores with REAL phone numbers (not made up):
[{"name": "Store Name", "phone": "+1XXXXXXXXXX", "address": "location if known", "why": "sells this because..."}]

IMPORTANT: Only include phone numbers you are CONFIDENT are real. If unsure, don't include the store.
Return up to 5 stores. Prefer stores with phone ordering capability.`,
            },
            {
              role: "user",
              content: `Product: ${analysis.product}\nKnown retailers: ${analysis.known_retailers.join(", ")}`,
            },
          ],
          max_tokens: 400,
        }),
      });

      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        const fallbackText = fallbackData.choices?.[0]?.message?.content || "";
        try {
          const jsonMatch = fallbackText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const fallbackStores = JSON.parse(jsonMatch[0]);
            for (const s of fallbackStores) {
              if (s.name && s.phone && !stores.some((e) => e.phone === s.phone)) {
                stores.push(s);
              }
            }
          }
        } catch {
          console.error("[search-stores] Failed to parse fallback stores");
        }
      }
    }

    console.log(`[search-stores] Found ${stores.length} stores for "${analysis.product}"`);

    return new Response(
      JSON.stringify({
        success: true,
        product: analysis.product,
        product_category: analysis.product_category,
        store_types: analysis.store_types,
        stores: stores.slice(0, 8),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[search-stores] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Search failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
