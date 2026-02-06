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
  action?: string;
  orderId?: string;
  productQuery?: string;
  maxPrice?: number;
  quantity?: number;
  shippingAddress?: ShippingAddress;
  paymentCards?: PaymentCard[];
  site?: string;
}

type SkyvernJson = Record<string, unknown>;

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Skyvern API v1 status values
// Task status: created, queued, running, completed, failed, terminated, timed_out, canceled
const SKYVERN_TASK_ACTIVE_STATUSES = ["created", "queued", "running"];
const SKYVERN_TASK_DONE_STATUSES = ["completed", "failed", "terminated", "timed_out", "canceled"];

// Skyvern API helper
async function skyvernFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: SkyvernJson }> {
  const url = `https://api.skyvern.com${path}`;
  console.log(`[Skyvern] ${init.method || "GET"} ${url}`);

  const res = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> || {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[Skyvern] Error ${res.status}: ${text}`);
    throw new Error(`Skyvern API ${res.status} for ${path}: ${text || "(empty)"}`);
  }

  let data: SkyvernJson = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { status: res.status, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SKYVERN_API_KEY) {
      throw new Error("SKYVERN_API_KEY is not configured");
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
    const action = payload.action || "start_order";

    console.log(`[AutoShop] Action: ${action} for user: ${user.id}`);

    switch (action) {
      case "get_status":
        return await handleGetStatus(supabase, user.id);
      case "create_profile":
        return await handleCreateProfile(supabase, user.id);
      case "start_login":
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", SKYVERN_API_KEY);
      case "confirm_login":
        return await handleConfirmLogin(supabase, user.id, payload.site || "gmail", SKYVERN_API_KEY);
      case "cancel_login":
        return await handleCancelLogin(supabase, user.id, SKYVERN_API_KEY);
      case "restart_session":
        await cleanupStaleSessions(supabase, user.id, SKYVERN_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", SKYVERN_API_KEY);
      case "cleanup_sessions":
        return await handleCleanupSessions(supabase, user.id, SKYVERN_API_KEY);
      case "start_order":
        return await handleStartOrder(supabase, user, payload, SKYVERN_API_KEY);
      case "check_order_status":
        return await handleCheckOrderStatus(supabase, user.id, payload.orderId!, SKYVERN_API_KEY);
      case "sync_all_orders":
        return await handleSyncAllOrders(supabase, user.id, SKYVERN_API_KEY);
      case "sync_order_emails":
        return await handleSyncOrderEmails(supabase, user.id, SKYVERN_API_KEY);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    console.error("[AutoShop] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to process request";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// ACTION HANDLERS
// ============================================================

// deno-lint-ignore no-explicit-any
async function handleGetStatus(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  const { data: tracking } = await supabase
    .from("order_tracking")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  return new Response(
    JSON.stringify({
      success: true,
      profile: profile ? {
        hasProfile: true,
        sitesLoggedIn: profile.shop_sites_logged_in || [],
        lastLoginAt: profile.last_login_at,
        status: profile.status,
        proxyServer: null, // Skyvern uses built-in residential proxies
        proxyUsername: null,
      } : null,
      tracking: tracking || [],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleCreateProfile(supabase: any, userId: string) {
  const { data: existing } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (existing) {
    return new Response(
      JSON.stringify({ success: true, message: "Profile already exists" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Skyvern doesn't require a separate profile creation — browser sessions handle state.
  // We just create the DB record to track the user's configuration.
  await supabase.from("browser_profiles").upsert({
    user_id: userId,
    browser_use_profile_id: `skyvern-${userId.substring(0, 8)}`,
    status: "ready",
    shop_sites_logged_in: [],
  }, { onConflict: "user_id" });

  console.log(`[AutoShop] Profile created for user ${userId}`);

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleStartLogin(
  supabase: any,
  userId: string,
  site: string,
  apiKey: string
) {
  // Ensure profile exists
  let { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    await supabase.from("browser_profiles").upsert({
      user_id: userId,
      browser_use_profile_id: `skyvern-${userId.substring(0, 8)}`,
      status: "ready",
      shop_sites_logged_in: [],
    }, { onConflict: "user_id" });

    const { data: newProfile } = await supabase
      .from("browser_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    profile = newProfile;
  }

  const siteUrls: Record<string, string> = {
    gmail: "https://mail.google.com",
    amazon: "https://www.amazon.com/ap/signin",
    ebay: "https://signin.ebay.com",
    walmart: "https://www.walmart.com/account/login",
  };

  const loginUrl = siteUrls[site] || `https://www.${site}.com/login`;

  // Create a Skyvern browser session for interactive login
  console.log(`[AutoShop] Creating Skyvern browser session for ${site} login`);

  const sessionRes = await skyvernFetch(apiKey, "/v1/browser-sessions", {
    method: "POST",
    body: JSON.stringify({
      timeout: 30, // 30 minutes for user to log in
      proxy_location: "RESIDENTIAL",
    }),
  });

  const browserSessionId = sessionRes.data.browser_session_id as string;
  console.log(`[AutoShop] Browser session created: ${browserSessionId}`);

  // Run a navigation task in the session to open the login page
  const taskRes = await skyvernFetch(apiKey, "/v1/run/tasks", {
    method: "POST",
    body: JSON.stringify({
      prompt: `Navigate to ${loginUrl} and wait. The user will log in manually. Do not interact with the page.`,
      url: loginUrl,
      engine: "skyvern-2.0",
      proxy_location: "RESIDENTIAL",
      browser_session_id: browserSessionId,
      max_steps: 3,
    }),
  });

  const runId = taskRes.data.run_id as string;
  const appUrl = taskRes.data.app_url as string || "";

  // Update pending login state
  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: site,
      shop_pending_task_id: runId,
      shop_pending_session_id: browserSessionId,
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Login session started: session=${browserSessionId}, task=${runId}, appUrl=${appUrl}`);

  return new Response(
    JSON.stringify({
      success: true,
      taskId: runId,
      sessionId: browserSessionId,
      liveViewUrl: appUrl,
      site,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleConfirmLogin(
  supabase: any,
  userId: string,
  site: string,
  apiKey: string
) {
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) throw new Error("Profile not found");

  // Close the Skyvern browser session to save state
  const sessionId = profile.shop_pending_session_id;
  if (sessionId) {
    try {
      console.log(`[AutoShop] Closing Skyvern browser session ${sessionId}`);
      await skyvernFetch(apiKey, `/v1/browser-sessions/${sessionId}/close`, {
        method: "POST",
      });
      console.log(`[AutoShop] Session closed, login state saved`);
    } catch (e) {
      console.error(`[AutoShop] Failed to close session:`, e);
    }
  }

  // Add site to logged-in list
  const currentSites: string[] = Array.isArray(profile.shop_sites_logged_in)
    ? profile.shop_sites_logged_in
    : [];
  if (!currentSites.includes(site)) {
    currentSites.push(site);
  }

  await supabase
    .from("browser_profiles")
    .update({
      shop_sites_logged_in: currentSites,
      shop_pending_login_site: null,
      shop_pending_task_id: null,
      shop_pending_session_id: null,
      last_login_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Login confirmed for ${site}`);

  return new Response(
    JSON.stringify({ success: true, site }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleCancelLogin(
  supabase: any,
  userId: string,
  apiKey: string
) {
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    return new Response(
      JSON.stringify({ success: true, message: "No profile found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Close the browser session
  if (profile.shop_pending_session_id) {
    try {
      await skyvernFetch(apiKey, `/v1/browser-sessions/${profile.shop_pending_session_id}/close`, {
        method: "POST",
      });
    } catch (e) {
      console.error(`[AutoShop] Failed to close session:`, e);
    }
  }

  // Clear pending state
  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: null,
      shop_pending_task_id: null,
      shop_pending_session_id: null,
    })
    .eq("user_id", userId);

  return new Response(
    JSON.stringify({ success: true, message: "Login session cancelled" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function cleanupStaleSessions(
  supabase: any,
  userId: string,
  apiKey: string
): Promise<{ sessionsKilled: number }> {
  console.log(`[AutoShop] Cleaning up stale sessions for user ${userId}`);
  let sessionsKilled = 0;

  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("shop_pending_session_id, shop_pending_task_id")
    .eq("user_id", userId)
    .single();

  if (profile?.shop_pending_session_id) {
    try {
      await skyvernFetch(apiKey, `/v1/browser-sessions/${profile.shop_pending_session_id}/close`, {
        method: "POST",
      });
      sessionsKilled++;
    } catch (e) {
      console.error(`[AutoShop] Failed to close session:`, e);
    }
  }

  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: null,
      shop_pending_task_id: null,
      shop_pending_session_id: null,
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Cleanup complete: ${sessionsKilled} sessions closed`);
  return { sessionsKilled };
}

// deno-lint-ignore no-explicit-any
async function handleCleanupSessions(
  supabase: any,
  userId: string,
  apiKey: string
) {
  const result = await cleanupStaleSessions(supabase, userId, apiKey);
  return new Response(
    JSON.stringify({
      success: true,
      message: `Cleaned up ${result.sessionsKilled} sessions`,
      ...result,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================
// ORDER HANDLING
// ============================================================

// deno-lint-ignore no-explicit-any
async function handleStartOrder(
  supabase: any,
  user: { id: string; email?: string },
  payload: AutoShopPayload,
  apiKey: string
) {
  const { orderId, productQuery, maxPrice, quantity, shippingAddress, paymentCards } = payload;

  if (!orderId || !productQuery || !shippingAddress || !paymentCards?.length) {
    throw new Error("Missing required order data");
  }

  // Concurrent order limit
  const MAX_CONCURRENT_ORDERS = 6;
  const { data: runningOrders } = await supabase
    .from("auto_shop_orders")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["pending", "searching", "found_deal", "checkout"]);

  if (runningOrders && runningOrders.length >= MAX_CONCURRENT_ORDERS) {
    throw new Error(`Maximum ${MAX_CONCURRENT_ORDERS} orders can run simultaneously.`);
  }

  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const sitesLoggedIn: string[] = Array.isArray(profile?.shop_sites_logged_in)
    ? profile.shop_sites_logged_in
    : [];
  const userEmail = user.email || "";

  console.log(`[AutoShop] Starting order: "${productQuery}"`);
  console.log(`[AutoShop] Sites logged in: ${sitesLoggedIn.join(", ") || "none"}`);

  // Update order status
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
    metadata: { orderId, productQuery, maxPrice, quantity, userEmail },
  });

  // Build agent instruction
  const agentInstruction = buildShoppingAgentInstruction(
    productQuery,
    maxPrice,
    quantity || 1,
    shippingAddress,
    paymentCards,
    userEmail,
    sitesLoggedIn
  );

  // Run Skyvern task — each order gets its own independent task
  // Skyvern uses built-in residential proxies by default
  console.log(`[AutoShop] Creating Skyvern task for order ${orderId}`);

  const taskRes = await skyvernFetch(apiKey, "/v1/run/tasks", {
    method: "POST",
    body: JSON.stringify({
      prompt: agentInstruction,
      url: "https://www.google.com/shopping",
      engine: "skyvern-2.0",
      proxy_location: "RESIDENTIAL",
      max_steps: 100,
      data_extraction_schema: {
        type: "object",
        properties: {
          success: { type: "boolean", description: "Whether the order was placed successfully" },
          site: { type: "string", description: "The site where the order was placed" },
          price: { type: "number", description: "The final price paid" },
          confirmation: { type: "string", description: "Order confirmation number" },
          failure_reason: { type: "string", description: "Why the order failed, if applicable" },
        },
      },
    }),
  });

  const runId = taskRes.data.run_id as string;
  console.log(`[AutoShop] Skyvern task submitted: ${runId}`);

  // Update order with task ID
  await supabase
    .from("auto_shop_orders")
    .update({
      browser_use_task_id: runId, // Reusing column for Skyvern run_id
      status: "searching",
    })
    .eq("id", orderId);

  await supabase.from("agent_logs").insert({
    user_id: user.id,
    agent_name: "auto_shop",
    log_level: "info",
    message: `Skyvern task submitted: ${runId}`,
    metadata: { orderId, runId },
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: "Shopping agent is searching for deals",
      orderId,
      taskId: runId,
      status: "searching",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function buildShoppingAgentInstruction(
  productQuery: string,
  maxPrice: number | undefined,
  quantity: number,
  shipping: ShippingAddress,
  cards: PaymentCard[],
  userEmail: string,
  sitesLoggedIn: string[]
): string {
  const priceConstraint = maxPrice
    ? `\n- MAXIMUM PRICE: $${maxPrice} - DO NOT buy anything over this price`
    : "";

  const shuffledCards = shuffleArray(cards);

  const cardInstructions = shuffledCards.map((card, index) => `
CARD ${index + 1}:
- Number: ${card.cardNumber}
- Expiry: ${card.expiry}
- CVV: ${card.cvv}
- Name: ${card.cardholderName}
- Billing: ${card.billingAddress || ""}, ${card.billingCity || ""}, ${card.billingState || ""} ${card.billingZip || ""}, ${card.billingCountry || "US"}
`).join("\n");

  const loggedInSites = sitesLoggedIn.length > 0
    ? `\nYou are already logged into: ${sitesLoggedIn.join(", ")}. USE THESE ACCOUNTS when possible.`
    : "";

  const emailInstructions = userEmail
    ? `
=== USER EMAIL ACCESS ===
The user's email is: ${userEmail}
${sitesLoggedIn.includes("gmail") ? "You have access to their Gmail inbox." : ""}

WHEN YOU NEED TO:
1. Create an account on a shopping site - USE THIS EMAIL: ${userEmail}
2. Retrieve a verification code - Check Gmail inbox for recent emails
3. Click verification links - Open Gmail and click the link in the email

If a site requires email verification:
1. After submitting the form, go to Gmail (mail.google.com)
2. Look for the most recent email from the site
3. Click the verification link OR copy the code
4. Return to the site and complete verification
=== END EMAIL ACCESS ===
`
    : "";

  return `AUTONOMOUS SHOPPING AGENT - FIND AND PURCHASE PRODUCT

YOUR MISSION: Find the best deal for the requested product and complete the purchase autonomously.
${loggedInSites}
${emailInstructions}
PRODUCT TO FIND:
- Search query: "${productQuery}"
- Quantity needed: ${quantity}${priceConstraint}

=== BROWSING MODE ===

You are using Skyvern with built-in residential proxies. Navigate directly to shopping sites.

POPUP HANDLING:
- Cookie / site consent modals → click "Accept" or "Close"
- Newsletter popups → click X or "No thanks"
- Handle them and continue — do NOT abandon for normal popups

=== ANTI-LOOP RULE ===
🚨 NEVER repeat the same failed action more than TWICE. Move on to alternatives. 🚨

STEP 1 - SEARCH FOR DEALS:
1. Start at Google Shopping and search for "${productQuery}"
2. Compare prices across different sites
3. Find the BEST DEAL from any reputable site
4. PRIORITIZE sites you're already logged into${sitesLoggedIn.length > 0 ? `: ${sitesLoggedIn.join(", ")}` : ""}

STEP 2 - VERIFY THE DEAL:
1. Click through to the product page
2. Verify: product matches, price is acceptable${maxPrice ? ` (under $${maxPrice})` : ""}, item in stock, ships to address
3. If not, try the next best option

STEP 3 - ADD TO CART AND CHECKOUT:
1. Select quantity: ${quantity}
2. Add to cart → proceed to checkout
3. Use existing account if logged in
4. Try guest checkout if must create account

STEP 4 - SHIPPING INFORMATION:
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
⚠️ Cards are RANDOMLY SHUFFLED — use them in the order shown.
1. Try CARD 1 first
2. If declined, try CARD 2, then CARD 3...
3. If all cards fail on this site, try a DIFFERENT site
4. Repeat until success or all options exhausted

STEP 6 - COMPLETE ORDER:
1. Review and place the order
2. Report: "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]"

=== FAILURE RECOVERY ===
- CARD DECLINED → try next card
- CHECKOUT BLOCKED → slow down, retry once, then try different site
- OUT OF STOCK → immediately try next deal
- BOT DETECTION → abandon site, try different retailer

=== FINAL STATUS ===
NEVER STOP. COMPLETE THE PURCHASE OR EXHAUST ALL OPTIONS.

Report:
- "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]"
- "FAILED: Could not complete. Sites tried: [list]. Reasons: [causes]"
- "BLOCKED: [blocker]. Suggestion: [fix]"`;
}

// ============================================================
// ORDER STATUS & SYNC
// ============================================================

// deno-lint-ignore no-explicit-any
async function handleCheckOrderStatus(
  supabase: any,
  userId: string,
  orderId: string,
  apiKey: string
) {
  const { data: order, error } = await supabase
    .from("auto_shop_orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", userId)
    .single();

  if (error || !order) throw new Error("Order not found");

  if (!order.browser_use_task_id) {
    return new Response(
      JSON.stringify({ success: true, order, taskStatus: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const taskRes = await skyvernFetch(apiKey, `/v1/run/tasks/${order.browser_use_task_id}`, {
      method: "GET",
    });

    const taskData = taskRes.data;
    console.log(`[AutoShop] Task ${order.browser_use_task_id} status: ${taskData.status}`);

    const updatedOrder = await updateOrderFromTask(supabase, order, taskData);

    return new Response(
      JSON.stringify({
        success: true,
        order: updatedOrder,
        taskStatus: taskData.status,
        taskOutput: taskData.output,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[AutoShop] Failed to fetch task status:", e);
    return new Response(
      JSON.stringify({ success: true, order, taskStatus: "unknown" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// deno-lint-ignore no-explicit-any
async function handleSyncAllOrders(
  supabase: any,
  userId: string,
  apiKey: string
) {
  const { data: orders } = await supabase
    .from("auto_shop_orders")
    .select("*")
    .eq("user_id", userId)
    .not("browser_use_task_id", "is", null)
    .in("status", ["pending", "searching", "found_deals", "ordering"]);

  if (!orders || orders.length === 0) {
    return new Response(
      JSON.stringify({ success: true, synced: 0, orders: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const updatedOrders = [];
  for (const order of orders) {
    try {
      const taskRes = await skyvernFetch(apiKey, `/v1/run/tasks/${order.browser_use_task_id}`, {
        method: "GET",
      });
      const updated = await updateOrderFromTask(supabase, order, taskRes.data);
      updatedOrders.push(updated);
    } catch (e) {
      console.error(`[AutoShop] Failed to sync order ${order.id}:`, e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, synced: updatedOrders.length, orders: updatedOrders }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function updateOrderFromTask(supabase: any, order: any, taskData: any) {
  // Skyvern statuses: created, queued, running, completed, failed, terminated, timed_out, canceled
  const taskStatus = taskData.status as string;
  const output = taskData.output || "";
  const outputStr = typeof output === "string" ? output : JSON.stringify(output);

  let newStatus = order.status;
  let errorMessage = order.error_message;
  let orderConfirmation = order.order_confirmation;
  let selectedDealSite = order.selected_deal_site;
  let selectedDealPrice = order.selected_deal_price;

  if (taskStatus === "completed") {
    const outputLower = outputStr.toLowerCase();

    // Check structured output first
    if (typeof output === "object" && output !== null) {
      const structured = output as Record<string, unknown>;
      if (structured.success === true) {
        newStatus = "completed";
        if (structured.confirmation) orderConfirmation = String(structured.confirmation);
        if (structured.site) selectedDealSite = String(structured.site);
        if (structured.price) selectedDealPrice = Number(structured.price);
      } else if (structured.success === false) {
        newStatus = "failed";
        errorMessage = String(structured.failure_reason || "Agent could not complete order");
      }
    } else if (outputLower.includes("success") && outputLower.includes("order placed")) {
      newStatus = "completed";
      const confMatch = outputStr.match(/confirmation[:\s]*([A-Z0-9-]+)/i);
      if (confMatch) orderConfirmation = confMatch[1];
      const siteMatch = outputStr.match(/at\s+(\w+)/i);
      if (siteMatch) selectedDealSite = siteMatch[1];
      const priceMatch = outputStr.match(/\$([0-9,.]+)/);
      if (priceMatch) selectedDealPrice = parseFloat(priceMatch[1].replace(",", ""));
    } else if (outputLower.includes("failed") || outputLower.includes("could not") || outputLower.includes("blocked")) {
      newStatus = "failed";
      errorMessage = outputStr.substring(0, 500);
    } else {
      newStatus = "completed";
    }
  } else if (SKYVERN_TASK_DONE_STATUSES.includes(taskStatus)) {
    // failed, terminated, timed_out, canceled
    newStatus = "failed";
    errorMessage = (taskData.failure_reason as string) || `Task ${taskStatus}`;
  } else if (SKYVERN_TASK_ACTIVE_STATUSES.includes(taskStatus)) {
    if (order.status === "pending") newStatus = "searching";
  }

  if (newStatus !== order.status || orderConfirmation || selectedDealSite) {
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (errorMessage) updateData.error_message = errorMessage;
    if (orderConfirmation) updateData.order_confirmation = orderConfirmation;
    if (selectedDealSite) updateData.selected_deal_site = selectedDealSite;
    if (selectedDealPrice) updateData.selected_deal_price = selectedDealPrice;
    if (newStatus === "completed" || newStatus === "failed") {
      updateData.completed_at = new Date().toISOString();
    }

    await supabase
      .from("auto_shop_orders")
      .update(updateData)
      .eq("id", order.id);

    return { ...order, ...updateData };
  }

  return order;
}

// ============================================================
// EMAIL SYNC
// ============================================================

// deno-lint-ignore no-explicit-any
async function handleSyncOrderEmails(
  supabase: any,
  userId: string,
  apiKey: string
) {
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  const sitesLoggedIn: string[] = Array.isArray(profile?.shop_sites_logged_in)
    ? profile.shop_sites_logged_in
    : [];

  if (!sitesLoggedIn.includes("gmail")) {
    throw new Error("Gmail not logged in. Please log into Gmail first via Accounts tab.");
  }

  console.log(`[AutoShop] Syncing order emails for user ${userId}`);

  const { data: existingEmails } = await supabase
    .from("order_emails")
    .select("gmail_message_id")
    .eq("user_id", userId);

  const existingIds = new Set((existingEmails || []).map((e: { gmail_message_id: string }) => e.gmail_message_id));

  const searchInstruction = `GMAIL ORDER EMAIL EXTRACTION TASK

You are logged into Gmail. Find and extract all shopping/order related emails.

STEP 1: Go to https://mail.google.com

STEP 2: Search for:
"order confirmation OR shipping OR tracking OR delivery OR purchase OR receipt"

Also search from common shopping sites:
"from:amazon OR from:ebay OR from:walmart OR from:target OR from:bestbuy"

STEP 3: For each email (up to 20 most recent), extract:
1. Subject line
2. From email address
3. From name
4. Snippet (first ~100 chars)
5. Date received
6. Unique message ID
7. Email type: "confirmation" | "shipping" | "tracking" | "receipt" | "other"

Also extract if visible: order number, tracking number, estimated delivery, total amount.

STEP 4: Return ALL as JSON array:
[{"messageId":"id","subject":"...","fromEmail":"...","fromName":"...","snippet":"...","receivedAt":"2024-01-15T10:30:00Z","emailType":"shipping","extractedData":{"orderNumber":"123","trackingNumber":"1Z999","carrier":"UPS"}}]

Return ONLY the JSON array. Max 20 emails. If no emails found, return: []`;

  // Run Skyvern task for email extraction
  const taskRes = await skyvernFetch(apiKey, "/v1/run/tasks", {
    method: "POST",
    body: JSON.stringify({
      prompt: searchInstruction,
      url: "https://mail.google.com",
      engine: "skyvern-2.0",
      proxy_location: "RESIDENTIAL",
      max_steps: 50,
      data_extraction_schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            messageId: { type: "string" },
            subject: { type: "string" },
            fromEmail: { type: "string" },
            fromName: { type: "string" },
            snippet: { type: "string" },
            receivedAt: { type: "string" },
            emailType: { type: "string" },
            extractedData: { type: "object" },
          },
        },
      },
    }),
  });

  const runId = taskRes.data.run_id as string;
  console.log(`[AutoShop] Email sync task started: ${runId}`);

  // Poll for completion (max 3 minutes)
  let attempts = 0;
  const maxAttempts = 90;
  let taskStatus = "created";
  let taskOutput: unknown = "";

  while (attempts < maxAttempts && !SKYVERN_TASK_DONE_STATUSES.includes(taskStatus)) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const statusRes = await skyvernFetch(apiKey, `/v1/run/tasks/${runId}`, { method: "GET" });
      taskStatus = statusRes.data.status as string;
      taskOutput = statusRes.data.output || "";
    } catch {
      // Continue polling
    }
    attempts++;
  }

  console.log(`[AutoShop] Email sync task finished: status=${taskStatus}`);

  if (taskStatus !== "completed") {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Email sync did not complete: ${taskStatus}`,
        taskId: runId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse output
  let emails: Array<{
    messageId: string;
    threadId?: string;
    subject: string;
    fromEmail: string;
    fromName?: string;
    toEmail?: string;
    snippet?: string;
    receivedAt: string;
    emailType?: string;
    extractedData?: Record<string, unknown>;
  }> = [];

  try {
    if (Array.isArray(taskOutput)) {
      emails = taskOutput;
    } else if (typeof taskOutput === "string") {
      const jsonMatch = taskOutput.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        emails = JSON.parse(jsonMatch[0]);
      }
    } else if (typeof taskOutput === "object" && taskOutput !== null) {
      // Skyvern might return structured output directly
      const arr = Object.values(taskOutput);
      if (arr.length > 0 && Array.isArray(arr[0])) {
        emails = arr[0];
      }
    }
  } catch (parseError) {
    console.error("[AutoShop] Failed to parse email output:", parseError);
  }

  // Get orders for matching
  const { data: orders } = await supabase
    .from("auto_shop_orders")
    .select("id, product_query, selected_deal_site, order_confirmation")
    .eq("user_id", userId);

  let inserted = 0;
  let skipped = 0;

  for (const email of emails) {
    if (!email.messageId || existingIds.has(email.messageId)) {
      skipped++;
      continue;
    }

    // Try to match to an order
    let matchedOrderId: string | null = null;
    if (orders && email.extractedData) {
      const orderNum = email.extractedData.orderNumber as string | undefined;
      if (orderNum) {
        for (const order of orders) {
          if (order.order_confirmation === orderNum) {
            matchedOrderId = order.id;
            break;
          }
        }
      }
    }

    if (!matchedOrderId && orders) {
      for (const order of orders) {
        if (order.selected_deal_site) {
          const siteLower = order.selected_deal_site.toLowerCase();
          const subjectLower = (email.subject || "").toLowerCase();
          const fromLower = (email.fromEmail || "").toLowerCase();
          if (subjectLower.includes(siteLower) || fromLower.includes(siteLower)) {
            matchedOrderId = order.id;
            break;
          }
        }
      }
    }

    const { error: insertError } = await supabase
      .from("order_emails")
      .insert({
        user_id: userId,
        order_id: matchedOrderId,
        gmail_message_id: email.messageId,
        thread_id: email.threadId || null,
        from_email: email.fromEmail,
        from_name: email.fromName || null,
        to_email: email.toEmail || null,
        subject: email.subject,
        snippet: email.snippet || null,
        received_at: email.receivedAt || new Date().toISOString(),
        email_type: email.emailType || "other",
        extracted_data: email.extractedData || {},
      });

    if (insertError) {
      console.error(`[AutoShop] Failed to insert email:`, insertError);
    } else {
      inserted++;
      existingIds.add(email.messageId);

      if (email.extractedData?.trackingNumber) {
        await supabase.from("order_tracking").upsert({
          user_id: userId,
          order_id: matchedOrderId,
          tracking_number: email.extractedData.trackingNumber,
          carrier: email.extractedData.carrier || null,
          estimated_delivery: email.extractedData.estimatedDelivery || null,
          status: "in_transit",
          email_source: email.fromEmail,
        }, { onConflict: "tracking_number" });
      }
    }
  }

  await supabase.from("agent_logs").insert({
    user_id: userId,
    agent_name: "auto_shop",
    log_level: "info",
    message: `Email sync complete: ${inserted} new, ${skipped} skipped`,
    metadata: { taskId: runId, inserted, skipped, totalFound: emails.length },
  });

  return new Response(
    JSON.stringify({
      success: true,
      inserted,
      skipped,
      totalFound: emails.length,
      taskId: runId,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
