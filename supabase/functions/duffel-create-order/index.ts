import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;

    const body = await req.json();
    const {
      offer_id,
      passengers,           // full passenger objects with id, given_name, family_name, etc.
      services = [],        // [{ id, quantity }]
      payment_type = "balance", // 'balance' | 'arc_bsp_cash'
      contact,              // { email, phone_number }
      metadata,
    } = body ?? {};

    if (!offer_id) return jsonResponse({ error: "offer_id required" }, 400);
    if (!Array.isArray(passengers)) return jsonResponse({ error: "passengers required" }, 400);

    // Re-fetch offer to get current total + currency
    const offerRes = await duffel(`/air/offers/${offer_id}`, { query: { return_available_services: true }});
    const offer = offerRes?.data;
    if (!offer) return jsonResponse({ error: "Offer not found" }, 404);

    // Compute total including selected services
    let total = parseFloat(offer.total_amount);
    const currency = offer.total_currency;
    if (services.length && offer.available_services) {
      for (const s of services) {
        const svc = offer.available_services.find((x: any) => x.id === s.id);
        if (svc) total += parseFloat(svc.total_amount) * (s.quantity ?? 1);
      }
    }

    const orderPayload: any = {
      type: "instant",
      selected_offers: [offer_id],
      passengers,
      payments: [{
        type: payment_type,
        amount: total.toFixed(2),
        currency,
      }],
    };
    if (services.length) orderPayload.services = services;
    if (contact) {
      // Apply contact info to first passenger if not already there
      if (!passengers[0].email && contact.email) passengers[0].email = contact.email;
      if (!passengers[0].phone_number && contact.phone_number) passengers[0].phone_number = contact.phone_number;
      orderPayload.passengers = passengers;
    }
    if (metadata) orderPayload.metadata = metadata;

    const orderRes = await duffel(`/air/orders`, { method: "POST", body: orderPayload });
    const order = orderRes?.data;

    // Persist locally
    if (user) {
      await supabase.from("travel_orders").insert({
        user_id: user.id,
        duffel_order_id: order.id,
        booking_reference: order.booking_reference,
        status: "confirmed",
        total_amount: order.total_amount,
        total_currency: order.total_currency,
        passengers: order.passengers ?? [],
        slices: order.slices ?? [],
        services: order.services ?? [],
        payment_status: order.payment_status?.awaiting_payment === false ? "paid" : "pending",
        raw: order,
      });
    }

    return jsonResponse({ order });
  } catch (e) {
    console.error("duffel-create-order", e);
    return errorResponse(e);
  }
});
