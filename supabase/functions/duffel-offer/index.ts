import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

// Get full offer details (with available services + passenger requirements)
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { offer_id, include_services = true } = await req.json();
    if (!offer_id) return jsonResponse({ error: "offer_id required" }, 400);

    const res = await duffel(`/air/offers/${offer_id}`, {
      query: { return_available_services: include_services },
    });
    return jsonResponse({ offer: res?.data });
  } catch (e) {
    console.error("duffel-offer", e);
    return errorResponse(e);
  }
});
