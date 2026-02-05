 import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
 import Stripe from "https://esm.sh/stripe@18.5.0";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
 };
 
 const logStep = (step: string, details?: any) => {
   const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
   console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
 };
 
 // Product IDs mapping
 const PRODUCTS = {
   JOB_AGENT: "prod_TvEWrkTVZcJFmZ",
   AUTO_SHOP: "prod_TvEW5RJ5CGqvIc",
 };
 
 serve(async (req) => {
   if (req.method === "OPTIONS") {
     return new Response(null, { headers: corsHeaders });
   }
 
   const supabaseClient = createClient(
     Deno.env.get("SUPABASE_URL") ?? "",
     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
     { auth: { persistSession: false } }
   );
 
   try {
     logStep("Function started");
 
     const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
     if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
 
     const authHeader = req.headers.get("Authorization");
     if (!authHeader) throw new Error("No authorization header provided");
 
     const token = authHeader.replace("Bearer ", "");
     const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
     if (userError) throw new Error(`Authentication error: ${userError.message}`);
     const user = userData.user;
     if (!user?.email) throw new Error("User not authenticated or email not available");
     logStep("User authenticated", { userId: user.id, email: user.email });
 
     const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
     const customers = await stripe.customers.list({ email: user.email, limit: 1 });
 
     if (customers.data.length === 0) {
       logStep("No customer found");
       return new Response(JSON.stringify({ 
         subscribed: false,
         jobAgent: { active: false },
         autoShop: { active: false }
       }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: 200,
       });
     }
 
     const customerId = customers.data[0].id;
     logStep("Found Stripe customer", { customerId });
 
     const subscriptions = await stripe.subscriptions.list({
       customer: customerId,
       status: "active",
     });
 
     let jobAgentSub = { active: false, endDate: null as string | null, priceId: null as string | null };
     let autoShopSub = { active: false, endDate: null as string | null, priceId: null as string | null };
 
     for (const sub of subscriptions.data) {
       for (const item of sub.items.data) {
         const productId = typeof item.price.product === 'string' 
           ? item.price.product 
           : item.price.product.id;
         
         const endDate = new Date(sub.current_period_end * 1000).toISOString();
         
         if (productId === PRODUCTS.JOB_AGENT) {
           jobAgentSub = { active: true, endDate, priceId: item.price.id };
           logStep("Found Job Agent subscription", { endDate });
         }
         if (productId === PRODUCTS.AUTO_SHOP) {
           autoShopSub = { active: true, endDate, priceId: item.price.id };
           logStep("Found Auto-Shop subscription", { endDate });
         }
       }
     }
 
     return new Response(JSON.stringify({
       subscribed: jobAgentSub.active || autoShopSub.active,
       jobAgent: jobAgentSub,
       autoShop: autoShopSub,
     }), {
       headers: { ...corsHeaders, "Content-Type": "application/json" },
       status: 200,
     });
   } catch (error) {
     const errorMessage = error instanceof Error ? error.message : String(error);
     logStep("ERROR", { message: errorMessage });
     return new Response(JSON.stringify({ error: errorMessage }), {
       headers: { ...corsHeaders, "Content-Type": "application/json" },
       status: 500,
     });
   }
 });