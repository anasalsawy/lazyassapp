import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

// Autocomplete airports & cities
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q") ?? "";
    if (!query || query.length < 2) return jsonResponse({ places: [] });
    const res = await duffel(`/places/suggestions`, { query: { query } });
    return jsonResponse({ places: res?.data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
});
