import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { order_id } = await req.json();
    if (!order_id) return jsonResponse({ error: "order_id required" }, 400);
    const res = await duffel(`/air/orders/${order_id}`);
    return jsonResponse({ order: res?.data });
  } catch (e) {
    return errorResponse(e);
  }
});
