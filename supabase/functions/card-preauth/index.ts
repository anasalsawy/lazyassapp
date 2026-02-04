import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const { paymentMethodId, cardholderName, email } = await req.json();

    if (!paymentMethodId) {
      throw new Error("paymentMethodId is required");
    }

    console.log("[CardPreauth] Creating $1.00 preauthorization for:", { paymentMethodId, email });

    // Create or retrieve customer
    let customerId: string;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        console.log("[CardPreauth] Using existing customer:", customerId);
      } else {
        const customer = await stripe.customers.create({
          email,
          name: cardholderName,
        });
        customerId = customer.id;
        console.log("[CardPreauth] Created new customer:", customerId);
      }
    } else {
      const customer = await stripe.customers.create({
        name: cardholderName || "Card Verification",
      });
      customerId = customer.id;
      console.log("[CardPreauth] Created anonymous customer:", customerId);
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
    console.log("[CardPreauth] Payment method attached to customer");

    // Create a $1.00 preauthorization (uncaptured payment intent)
    // capture_method: "manual" means the charge is authorized but NOT captured
    // This places a hold on the card without actually charging it
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100, // $1.00 in cents
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: "manual", // KEY: This creates a preauth/hold, not a charge
      confirm: true, // Automatically confirm the payment intent
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      description: "Card verification - $1.00 preauthorization",
      metadata: {
        type: "card_verification",
        cardholder_name: cardholderName || "",
      },
    });

    console.log("[CardPreauth] PaymentIntent created:", {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      capture_method: paymentIntent.capture_method,
    });

    // Check if the preauth was successful
    if (paymentIntent.status === "requires_capture") {
      // Success! The card is valid and has a $1 hold
      // Optionally cancel the preauth immediately to release the hold
      // await stripe.paymentIntents.cancel(paymentIntent.id);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: "Card verified successfully with $1.00 preauthorization",
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          customerId: customerId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (paymentIntent.status === "succeeded") {
      // This shouldn't happen with capture_method: manual, but handle it
      return new Response(
        JSON.stringify({
          success: true,
          message: "Card verified",
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          customerId: customerId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      throw new Error(`Unexpected payment intent status: ${paymentIntent.status}`);
    }
  } catch (error: any) {
    console.error("[CardPreauth] Error:", error);
    
    // Handle Stripe-specific errors
    if (error.type === "StripeCardError") {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
          code: error.code,
          decline_code: error.decline_code,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to verify card",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
