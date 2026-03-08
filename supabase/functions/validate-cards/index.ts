import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CardInput {
  number: string;
  exp_month: number;
  exp_year: number;
  cvv: string;
  cardholder_name?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const { cards, email } = await req.json() as { cards: CardInput[]; email?: string };

    if (!cards || !Array.isArray(cards) || cards.length === 0) {
      throw new Error("Provide an array of cards");
    }

    if (cards.length > 20) {
      throw new Error("Max 20 cards per batch");
    }

    // Create or find customer
    let customerId: string;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      customerId = customers.data.length > 0
        ? customers.data[0].id
        : (await stripe.customers.create({ email })).id;
    } else {
      customerId = (await stripe.customers.create({ name: "Card Validation" })).id;
    }

    const results: Array<{
      index: number;
      last4: string;
      brand?: string;
      status: "valid" | "declined" | "error";
      message: string;
      decline_code?: string;
    }> = [];

    // Process each card sequentially (Stripe rate limits apply)
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const last4 = card.number.replace(/\s/g, "").slice(-4);

      try {
        // Create PaymentMethod directly via Stripe API
        const pm = await stripe.paymentMethods.create({
          type: "card",
          card: {
            number: card.number.replace(/\s/g, ""),
            exp_month: card.exp_month,
            exp_year: card.exp_year,
            cvc: card.cvv,
          },
          billing_details: {
            name: card.cardholder_name || undefined,
          },
        });

        // Attach to customer
        await stripe.paymentMethods.attach(pm.id, { customer: customerId });

        // Real $1 preauth
        const pi = await stripe.paymentIntents.create({
          amount: 100,
          currency: "usd",
          customer: customerId,
          payment_method: pm.id,
          confirm: true,
          capture_method: "manual",
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        });

        if (pi.status === "requires_capture") {
          // Card is LIVE — release hold
          await stripe.paymentIntents.cancel(pi.id);
          results.push({
            index: i,
            last4,
            brand: pm.card?.brand || undefined,
            status: "valid",
            message: `✅ VALID — ${pm.card?.brand?.toUpperCase()} ****${last4} — $1 hold placed & released`,
          });
        } else {
          try { await stripe.paymentIntents.cancel(pi.id); } catch (_) {}
          results.push({
            index: i,
            last4,
            brand: pm.card?.brand || undefined,
            status: "error",
            message: `⚠️ Unexpected status: ${pi.status}`,
          });
        }

        // Detach PM after use
        try { await stripe.paymentMethods.detach(pm.id); } catch (_) {}

      } catch (err: any) {
        if (err.type === "StripeCardError") {
          results.push({
            index: i,
            last4,
            status: "declined",
            message: `❌ DECLINED — ****${last4} — ${err.message}`,
            decline_code: err.decline_code,
          });
        } else {
          results.push({
            index: i,
            last4,
            status: "error",
            message: `❌ ERROR — ****${last4} — ${err.message}`,
          });
        }
      }
    }

    console.log("[ValidateCards] Processed", results.length, "cards");

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("[ValidateCards] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
