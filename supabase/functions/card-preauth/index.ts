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

    const { cardNumber, expiry, cvv, cardholderName, email } = await req.json();

    if (!cardNumber || !expiry || !cvv) {
      throw new Error("Card number, expiry, and CVV are required");
    }

    console.log("[CardPreauth] Processing card for:", { email, cardholderName });

    // Parse expiry (MM/YY or MM/YYYY)
    const [expMonth, expYear] = expiry.split("/").map((s: string) => s.trim());
    const expMonthNum = parseInt(expMonth, 10);
    let expYearNum = parseInt(expYear, 10);
    if (expYearNum < 100) expYearNum += 2000;

    // Create PaymentMethod from raw card details
    const paymentMethod = await stripe.paymentMethods.create({
      type: "card",
      card: {
        number: cardNumber.replace(/\s/g, ""),
        exp_month: expMonthNum,
        exp_year: expYearNum,
        cvc: cvv,
      },
      billing_details: {
        name: cardholderName || undefined,
        email: email || undefined,
      },
    });

    console.log("[CardPreauth] PaymentMethod created:", paymentMethod.id);

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
    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId });

    // Create $1.00 preauthorization (hold, not charge)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethod.id,
      capture_method: "manual",
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Card verification - $1.00 preauthorization",
      metadata: { type: "card_verification", cardholder_name: cardholderName || "" },
    });

    console.log("[CardPreauth] PaymentIntent:", { id: paymentIntent.id, status: paymentIntent.status });

    if (paymentIntent.status === "requires_capture" || paymentIntent.status === "succeeded") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Card verified with $1.00 preauthorization",
          paymentIntentId: paymentIntent.id,
          status: paymentIntent.status,
          last4: paymentMethod.card?.last4,
          brand: paymentMethod.card?.brand,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      throw new Error(`Unexpected status: ${paymentIntent.status}`);
    }
  } catch (error: any) {
    console.error("[CardPreauth] Error:", error);
    
    if (error.type === "StripeCardError") {
      return new Response(
        JSON.stringify({ success: false, error: error.message, code: error.code, decline_code: error.decline_code }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to verify card" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});