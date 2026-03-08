import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const { paymentMethodId, cardholderName, email } = await req.json();

    if (!paymentMethodId) {
      throw new Error("PaymentMethod ID is required");
    }

    console.log("[CardPreauth] Processing PaymentMethod:", paymentMethodId);

    // Retrieve the PaymentMethod to get card details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    console.log("[CardPreauth] PaymentMethod retrieved:", { 
      id: paymentMethod.id, 
      brand: paymentMethod.card?.brand,
      last4: paymentMethod.card?.last4 
    });

    // Create or retrieve customer
    let customerId: string;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log("[CardPreauth] Using existing customer:", customerId);
      } else {
        const customer = await stripe.customers.create({ email, name: cardholderName });
        customerId = customer.id;
        console.log("[CardPreauth] Created new customer:", customerId);
      }
    } else {
      const customer = await stripe.customers.create({ name: cardholderName || "Card Verification" });
      customerId = customer.id;
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    console.log("[CardPreauth] PaymentMethod attached to customer");

    // Use a REAL $1.00 pre-authorization (capture_method: manual) to truly test card
    // This places a temporary hold that we immediately cancel
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100, // $1.00 in cents
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      capture_method: "manual", // Auth only — won't capture/charge
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        type: "card_preauth_validation",
        cardholder_name: cardholderName || "",
        verified_at: new Date().toISOString(),
      },
    });

    console.log("[CardPreauth] PaymentIntent:", { id: paymentIntent.id, status: paymentIntent.status });

    if (paymentIntent.status === "requires_capture") {
      // Card is LIVE and valid — immediately cancel/release the hold
      await stripe.paymentIntents.cancel(paymentIntent.id);
      console.log("[CardPreauth] Hold released (cancelled) — card is valid");

      return new Response(
        JSON.stringify({
          success: true,
          message: "Card verified — $1 hold placed and immediately released",
          paymentIntentId: paymentIntent.id,
          status: "verified",
          last4: paymentMethod.card?.last4,
          brand: paymentMethod.card?.brand,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      // Unexpected status — card may have issues
      // Try to cancel if possible
      try { await stripe.paymentIntents.cancel(paymentIntent.id); } catch (_) {}
      
      return new Response(
        JSON.stringify({
          success: false,
          error: `Card validation returned unexpected status: ${paymentIntent.status}`,
          status: paymentIntent.status,
          last4: paymentMethod.card?.last4,
          brand: paymentMethod.card?.brand,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
  } catch (error: any) {
    console.error("[CardPreauth] Error:", error);
    
    if (error.type === "StripeCardError") {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error.message, 
          code: error.code, 
          decline_code: error.decline_code 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to verify card" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
