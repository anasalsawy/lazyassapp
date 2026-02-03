import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PaymentCard {
  id: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
  cardholderName: string;
  billingAddress?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingCountry?: string;
}

interface ShippingAddress {
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  phone?: string;
}

interface AutoShopPayload {
  orderId: string;
  productQuery: string;
  maxPrice?: number;
  quantity: number;
  shippingAddress: ShippingAddress;
  paymentCards: PaymentCard[];
}

// Generate email alias for account creation
async function generateEmailAlias(supabase: any, userId: string, orderId: string, productQuery: string): Promise<string> {
  const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");
  
  if (!MAILGUN_DOMAIN) {
    console.warn("[AutoShop] MAILGUN_DOMAIN not set, using fallback");
    return `shop-${orderId.substring(0, 8)}@example.com`;
  }

  // Generate unique alias
  const shortId = orderId.substring(0, 8);
  const timestamp = Date.now().toString(36);
  const productSlug = productQuery.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10) || 'order';
  const emailAlias = `shop-${productSlug}-${shortId}-${timestamp}@${MAILGUN_DOMAIN}`;

  console.log(`[AutoShop] Generated email alias: ${emailAlias}`);

  // Log the alias creation
  await supabase.from("agent_logs").insert({
    user_id: userId,
    agent_name: "auto_shop",
    log_level: "info",
    message: `Generated email alias for shopping: ${emailAlias}`,
    metadata: { emailAlias, orderId, productQuery },
  });

  return emailAlias;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const BROWSER_USE_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!BROWSER_USE_API_KEY) {
      throw new Error("BROWSER_USE_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const payload: AutoShopPayload = await req.json();
    const { orderId, productQuery, maxPrice, quantity, shippingAddress, paymentCards } = payload;

    console.log(`[AutoShop] Starting search for: "${productQuery}"`);
    console.log(`[AutoShop] Max price: $${maxPrice || "no limit"}, Quantity: ${quantity}`);

    // Generate email alias for account creation
    const emailAlias = await generateEmailAlias(supabase, user.id, orderId, productQuery);
    console.log(`[AutoShop] Email for account creation: ${emailAlias}`);

    // Update order status to searching
    await supabase
      .from("auto_shop_orders")
      .update({ status: "searching" })
      .eq("id", orderId);

    // Log the start
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "auto_shop",
      log_level: "info",
      message: `Starting product search: "${productQuery}"`,
      metadata: { orderId, productQuery, maxPrice, quantity },
    });

    // Build the agent instruction
    const agentInstruction = buildShoppingAgentInstruction(
      productQuery,
      maxPrice,
      quantity,
      shippingAddress,
      paymentCards
    );

    console.log(`[AutoShop] Sending task to Browser Use...`);

    // Call Browser Use Cloud API
    const browserUseResponse = await fetch("https://api.browser-use.com/api/v2/tasks", {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: agentInstruction,
        startUrl: "https://www.google.com/shopping",
        llm: "browser-use-llm",
        maxSteps: 100,
        highlightElements: true,
      }),
    });

    if (!browserUseResponse.ok) {
      const errorData = await browserUseResponse.text();
      console.error("[AutoShop] Browser Use API error:", errorData);
      
      await supabase
        .from("auto_shop_orders")
        .update({ 
          status: "failed",
          error_message: `Browser Use API error: ${browserUseResponse.status}` 
        })
        .eq("id", orderId);

      throw new Error(`Shopping agent error: ${browserUseResponse.status}`);
    }

    const agentResult = await browserUseResponse.json();
    const taskId = agentResult.id || agentResult.task_id;
    console.log("[AutoShop] Task submitted:", taskId);

    // Update order with task ID
    await supabase
      .from("auto_shop_orders")
      .update({ 
        browser_use_task_id: taskId,
        status: "searching",
      })
      .eq("id", orderId);

    // Log success
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "auto_shop",
      log_level: "info",
      message: `Browser Use task submitted: ${taskId}`,
      metadata: { orderId, taskId },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Shopping agent is searching for deals",
        orderId,
        taskId,
        status: "searching",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[AutoShop] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to start shopping agent";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildShoppingAgentInstruction(
  productQuery: string,
  maxPrice: number | undefined,
  quantity: number,
  shipping: ShippingAddress,
  cards: PaymentCard[]
): string {
  const priceConstraint = maxPrice 
    ? `\n- MAXIMUM PRICE: $${maxPrice} - DO NOT buy anything over this price` 
    : "";

  const cardInstructions = cards.map((card, index) => `
CARD ${index + 1}:
- Number: ${card.cardNumber}
- Expiry: ${card.expiry}
- CVV: ${card.cvv}
- Name: ${card.cardholderName}
- Billing: ${card.billingAddress || ""}, ${card.billingCity || ""}, ${card.billingState || ""} ${card.billingZip || ""}, ${card.billingCountry || "US"}
`).join("\n");

  return `AUTONOMOUS SHOPPING AGENT - FIND AND PURCHASE PRODUCT

YOUR MISSION: Find the best deal for the requested product and complete the purchase autonomously.

PRODUCT TO FIND:
- Search query: "${productQuery}"
- Quantity needed: ${quantity}${priceConstraint}

STEP 1 - SEARCH FOR DEALS:
1. Start at Google Shopping and search for "${productQuery}"
2. Look at multiple results - compare prices across different sites
3. Check these sites for deals:
   - Amazon
   - eBay
   - Walmart
   - Target
   - Best Buy
   - Any other reputable e-commerce site
4. Find the BEST DEAL (lowest price with good seller rating)

STEP 2 - VERIFY THE DEAL:
1. Click through to the product page
2. Verify:
   - Product matches the search query
   - Price is acceptable${maxPrice ? ` (under $${maxPrice})` : ""}
   - Item is in stock
   - Can ship to the delivery address
3. If this deal doesn't work, go back and try the next best option

STEP 3 - ADD TO CART AND CHECKOUT:
1. Select quantity: ${quantity}
2. Add to cart
3. Proceed to checkout
4. Handle any account creation or guest checkout

STEP 4 - ENTER SHIPPING INFORMATION:
Full Name: ${shipping.full_name}
Address Line 1: ${shipping.address_line1}
${shipping.address_line2 ? `Address Line 2: ${shipping.address_line2}` : ""}
City: ${shipping.city}
State: ${shipping.state}
ZIP Code: ${shipping.zip_code}
Country: ${shipping.country}
Phone: ${shipping.phone || "Not provided"}

STEP 5 - PAYMENT (TRY CARDS IN ORDER):
${cardInstructions}

PAYMENT STRATEGY:
1. Try CARD 1 first
2. If CARD 1 is declined, try CARD 2
3. If all cards fail on this site, ABANDON this site and try the NEXT BEST DEAL on a DIFFERENT site
4. Repeat until order is successful or all options exhausted

STEP 6 - COMPLETE ORDER:
1. Review the order
2. Place the order
3. Take screenshot of confirmation page
4. Report: "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]"

ERROR HANDLING:
- If card declined: Try next card, if all fail try different site
- If out of stock: Try next best deal
- If shipping not available: Try different site
- If CAPTCHA: Solve it
- If price changed: Only proceed if still under max price

NEVER STOP. NEVER ASK FOR HELP. COMPLETE THE PURCHASE.

Report final status as one of:
- "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]"
- "FAILED: Could not complete purchase. Reason: [details]"
- "BLOCKED: [specific blocker like MFA, unsolvable CAPTCHA, etc.]"`;
}
