import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

// Two-step cancellation: create cancellation -> confirm
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { order_id, confirm = false, cancellation_id } = await req.json();
    if (!order_id && !cancellation_id) return jsonResponse({ error: "order_id required" }, 400);

    if (!confirm) {
      const res = await duffel(`/air/order_cancellations`, {
        method: "POST",
        body: { order_id },
      });
      return jsonResponse({ cancellation: res?.data });
    }

    const res = await duffel(`/air/order_cancellations/${cancellation_id}/actions/confirm`, {
      method: "POST",
      body: {},
    });

    // mark local order as cancelled
    if (order_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );
      await supabase.from("travel_orders").update({ status: "cancelled" }).eq("duffel_order_id", order_id);
    }
    return jsonResponse({ cancellation: res?.data });
  } catch (e) {
    return errorResponse(e);
  }
});
