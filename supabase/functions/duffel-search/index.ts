import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, duffel, jsonResponse, errorResponse } from "../_shared/duffel.ts";

// Creates an offer request and returns the offers
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      slices,                  // [{ origin, destination, departure_date, departure_time?:{from,to} }]
      passengers,              // [{ type: 'adult'|'child'|'infant_without_seat', age? }]
      cabin_class = "economy", // economy|premium_economy|business|first
      max_connections,         // optional
      return_offers = true,
    } = body ?? {};

    if (!Array.isArray(slices) || slices.length === 0) {
      return jsonResponse({ error: "slices required" }, 400);
    }
    if (!Array.isArray(passengers) || passengers.length === 0) {
      return jsonResponse({ error: "passengers required" }, 400);
    }

    const payload: any = {
      slices: slices.map((s: any) => ({
        origin: s.origin,
        destination: s.destination,
        departure_date: s.departure_date,
        ...(s.departure_time ? { departure_time: s.departure_time } : {}),
      })),
      passengers,
      cabin_class,
    };
    if (typeof max_connections === "number") payload.max_connections = max_connections;

    const res = await duffel(`/air/offer_requests`, {
      method: "POST",
      body: payload,
      query: { return_offers, "supplier_timeout": 25000 },
    });

    const offers = (res?.data?.offers ?? []).sort(
      (a: any, b: any) => parseFloat(a.total_amount) - parseFloat(b.total_amount)
    );

    return jsonResponse({
      offer_request_id: res?.data?.id,
      currency: res?.data?.offers?.[0]?.total_currency ?? null,
      offers,
    });
  } catch (e) {
    console.error("duffel-search", e);
    return errorResponse(e);
  }
});
