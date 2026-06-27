import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { offer_id } = await req.json();
    if (!offer_id) return jsonResponse({ error: "offer_id required" }, 400);
    const res = await duffel(`/air/seat_maps`, { query: { offer_id } });
    return jsonResponse({ seat_maps: res?.data ?? [] });
  } catch (e) {
    console.error("duffel-seat-maps", e);
    return errorResponse(e);
  }
});
