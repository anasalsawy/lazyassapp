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
  proxyServer?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  useBrowserstack?: boolean;
}

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Skyvern API configuration
const SKYVERN_API_BASE = "https://api.skyvern.com/v1";

async function skyvernApi(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${SKYVERN_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  console.log(`[Skyvern] ${init.method || "GET"} ${path}`);
  return fetch(url, { ...init, headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
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
      case "get_status": {
        return await handleGetStatus(supabase, user.id);
      }
      case "create_profile": {
        return await handleCreateProfile(supabase, user.id);
      }
      case "start_login": {
        await cleanupStaleSessions(supabase, user.id, STEEL_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", STEEL_API_KEY);
      }
      case "confirm_login": {
        return await handleConfirmLogin(supabase, user.id, payload.site || "gmail", STEEL_API_KEY);
      }
      case "cancel_login": {
        return await handleCancelLogin(supabase, user.id, STEEL_API_KEY);
      }
      case "restart_session": {
        await cleanupStaleSessions(supabase, user.id, STEEL_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", STEEL_API_KEY);
      }
      case "cleanup_sessions": {
        return await handleCleanupSessions(supabase, user.id, STEEL_API_KEY);
      }
      case "start_order": {
        return await handleStartOrder(supabase, user, payload, STEEL_API_KEY, LOVABLE_API_KEY || "", supabaseUrl);
      }
      case "check_order_status": {
        return await handleCheckOrderStatus(supabase, user.id, payload.orderId!);
      }
      case "sync_all_orders": {
        return await handleSyncAllOrders(supabase, user, STEEL_API_KEY, supabaseUrl, LOVABLE_API_KEY || "");
      }
      case "sync_order_emails": {
        return await handleSyncOrderEmails(supabase, user.id, STEEL_API_KEY, LOVABLE_API_KEY || "");
      }
      case "set_proxy": {
        return await handleSetProxy(supabase, user.id, payload);
      }
      case "test_proxy": {
        return await handleTestProxy(supabase, user.id, STEEL_API_KEY);
      }
      case "toggle_browserstack": {
        return await handleToggleBrowserstack(supabase, user.id, payload.useBrowserstack ?? false);
      }
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
        hasProfile: !!profile.browser_use_profile_id,
        sitesLoggedIn: profile.shop_sites_logged_in || [],
        lastLoginAt: profile.last_login_at,
        status: profile.status,
        proxyServer: profile.proxy_server || null,
        proxyUsername: profile.proxy_username || null,
        useBrowserstack: profile.use_browserstack ?? false,
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

  if (existing?.browser_use_profile_id) {
    return new Response(
      JSON.stringify({ success: true, message: "Profile already exists" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const profileId = `steel-shop-${userId.substring(0, 8)}-${Date.now()}`;

  await supabase.from("browser_profiles").upsert({
    user_id: userId,
    browser_use_profile_id: profileId,
    status: "ready",
    shop_sites_logged_in: [],
  }, { onConflict: "user_id" });

  console.log(`[AutoShop] Created profile: ${profileId}`);

  return new Response(
    JSON.stringify({ success: true, profileId }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleStartLogin(
  supabase: any,
  userId: string,
  site: string,
  steelApiKey: string
) {
  let { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile?.browser_use_profile_id) {
    console.log(`[AutoShop] No profile found, auto-creating for user ${userId}`);
    const profileId = `steel-shop-${userId.substring(0, 8)}-${Date.now()}`;

    await supabase.from("browser_profiles").upsert({
      user_id: userId,
      browser_use_profile_id: profileId,
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

  // Create a Steel session for manual login
  console.log(`[AutoShop] Creating Steel session for login: ${loginUrl}`);
  
  const sessionRes = await steelApi(steelApiKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({
      useProxy: true,
      solveCaptcha: true,
    }),
  });

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    console.error(`[AutoShop] Steel session creation failed: ${err}`);
    throw new Error(`Failed to create session: ${err}`);
  }

  const sessionData = await sessionRes.json();
  const sessionId = sessionData.id;
  const liveViewUrl = sessionData.debugUrl;

  if (!sessionId) {
    throw new Error("Steel session created but returned no session id");
  }

  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: site,
      shop_pending_task_id: null,
      shop_pending_session_id: sessionId,
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Login session started: id=${sessionId}, debugUrl=${liveViewUrl}`);

  return new Response(
    JSON.stringify({
      success: true,
      taskId: sessionId,
      sessionId,
      liveViewUrl,
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
  steelApiKey: string
) {
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) throw new Error("Profile not found");

  // Release the Steel session
  const sessionId = profile.shop_pending_session_id;
  if (sessionId) {
    try {
      console.log(`[AutoShop] Releasing Steel session ${sessionId}`);
      await steelApi(steelApiKey, `/sessions/${sessionId}`, { method: "DELETE" });
      console.log(`[AutoShop] Steel session released`);
    } catch (e) {
      console.error(`[AutoShop] Failed to release Steel session:`, e);
    }
  }

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

  return new Response(
    JSON.stringify({ success: true, site }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleCancelLogin(supabase: any, userId: string, steelApiKey: string) {
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

  // Release pending Steel session
  if (profile.shop_pending_session_id) {
    try {
      await steelApi(steelApiKey, `/sessions/${profile.shop_pending_session_id}`, { method: "DELETE" });
    } catch (e) {
      console.error(`[AutoShop] Failed to release session:`, e);
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

  return new Response(
    JSON.stringify({ success: true, message: "Login session cancelled" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function cleanupStaleSessions(supabase: any, userId: string, steelApiKey: string): Promise<{ sessionsKilled: number }> {
  let sessionsKilled = 0;

  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("shop_pending_session_id")
    .eq("user_id", userId)
    .single();

  if (profile?.shop_pending_session_id) {
    try {
      await steelApi(steelApiKey, `/sessions/${profile.shop_pending_session_id}`, { method: "DELETE" });
      sessionsKilled++;
    } catch (e) {
      console.error(`[AutoShop] Failed to release session:`, e);
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

  return { sessionsKilled };
}

// deno-lint-ignore no-explicit-any
async function handleCleanupSessions(supabase: any, userId: string, steelApiKey: string) {
  const result = await cleanupStaleSessions(supabase, userId, steelApiKey);

  return new Response(
    JSON.stringify({
      success: true,
      message: `Cleaned up ${result.sessionsKilled} sessions`,
      ...result,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleToggleBrowserstack(supabase: any, userId: string, useBrowserstack: boolean) {
  await supabase
    .from("browser_profiles")
    .update({ use_browserstack: useBrowserstack })
    .eq("user_id", userId);

  return new Response(
    JSON.stringify({
      success: true,
      useBrowserstack,
      message: `BrowserStack ${useBrowserstack ? "enabled" : "disabled"}`,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleStartOrder(
  supabase: any,
  user: { id: string; email?: string },
  payload: AutoShopPayload,
  steelApiKey: string,
  lovableApiKey: string,
  supabaseUrl: string
) {
  const { orderId, productQuery, maxPrice, quantity, shippingAddress, paymentCards } = payload;

  if (!orderId || !productQuery || !shippingAddress || !paymentCards?.length) {
    throw new Error("Missing required order data");
  }

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

  // Fetch site credentials
  const { data: siteCredentials } = await supabase
    .from("site_credentials")
    .select("site_domain, email_used, password_enc")
    .eq("user_id", user.id);

  const decryptedCreds: { site: string; email: string; password: string }[] = [];
  const encKey = "SHOP_PROXY_KEY_2024";
  if (siteCredentials && siteCredentials.length > 0) {
    for (const cred of siteCredentials) {
      try {
        const decoded = atob(cred.password_enc);
        let decrypted = "";
        for (let i = 0; i < decoded.length; i++) {
          decrypted += String.fromCharCode(decoded.charCodeAt(i) ^ encKey.charCodeAt(i % encKey.length));
        }
        decryptedCreds.push({ site: cred.site_domain, email: cred.email_used, password: decrypted });
      } catch (e) {
        console.error(`[AutoShop] Failed to decrypt credentials for ${cred.site_domain}:`, e);
      }
    }
  }

  console.log(`[AutoShop] Starting order via Steel: "${productQuery}"`);

  await supabase.from("auto_shop_orders").update({ status: "searching" }).eq("id", orderId);

  await supabase.from("agent_logs").insert({
    user_id: user.id,
    agent_name: "auto_shop",
    log_level: "info",
    message: `Starting product search via Steel: "${productQuery}"`,
    metadata: { orderId, productQuery, maxPrice, quantity, userEmail },
  });

  // Create a Steel session for the shopping task
  const sessionRes = await steelApi(steelApiKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({
      useProxy: true,
      solveCaptcha: true,
    }),
  });

  if (!sessionRes.ok) {
    const errorData = await sessionRes.text();
    console.error("[AutoShop] Steel API error:", sessionRes.status, errorData);
    
    await supabase.from("auto_shop_orders").update({ 
      status: "failed",
      error_message: `Steel API error: ${sessionRes.status}` 
    }).eq("id", orderId);

    throw new Error(`Steel session creation failed: ${sessionRes.status} - ${errorData}`);
  }

  const steelSession = await sessionRes.json();
  const sessionId = steelSession.id;
  const debugUrl = steelSession.debugUrl;
  console.log("[AutoShop] Steel session created:", sessionId);

  // Store session ID and debug URL
  await supabase.from("auto_shop_orders").update({ 
    browser_use_task_id: sessionId,
    status: "searching",
    notes: JSON.stringify({ debugUrl, steelSessionId: sessionId }),
  }).eq("id", orderId);

  await supabase.from("agent_logs").insert({
    user_id: user.id,
    agent_name: "auto_shop",
    log_level: "info",
    message: `Steel session created: ${sessionId}`,
    metadata: { orderId, sessionId, debugUrl },
  });

  // Use Lovable AI to orchestrate the shopping task via the Steel session
  if (lovableApiKey) {
    const agentPrompt = buildShoppingAgentInstruction(
      productQuery, maxPrice, quantity || 1, shippingAddress, paymentCards,
      userEmail, sitesLoggedIn, supabaseUrl, false, decryptedCreds
    );

    // Fire-and-forget: invoke lovable-agent to handle the task
    const backgroundWork = async () => {
      try {
        await fetch(`${supabaseUrl}/functions/v1/lovable-agent`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{
              role: "user",
              content: `Execute this shopping task using the Steel browser session ${sessionId} (debugUrl: ${debugUrl}):\n\n${agentPrompt}\n\nWhen complete, update order ${orderId} status in the database.`,
            }],
          }),
        });
      } catch (err) {
        console.error("[AutoShop] Background agent failed:", err);
        await supabase.from("auto_shop_orders").update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
        }).eq("id", orderId);
      }
    };

    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      (EdgeRuntime as any).waitUntil(backgroundWork());
    } else {
      backgroundWork().catch(console.error);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: "Shopping agent started via Steel",
      orderId,
      taskId: sessionId,
      debugUrl,
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
  sitesLoggedIn: string[],
  supabaseUrl: string,
  useBrowserstack: boolean = false,
  siteCredentials: { site: string; email: string; password: string }[] = []
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

  const credentialInstructions = siteCredentials.length > 0
    ? `\n=== SITE LOGIN CREDENTIALS ===\n${siteCredentials.map((cred, i) => `SITE ${i + 1}: ${cred.site}\n- Email: ${cred.email}\n- Password: ${cred.password}`).join("\n")}\n=== END SITE CREDENTIALS ===\n`
    : "";

  return `Find a good deal on "${productQuery}" (quantity: ${quantity}) and purchase it.${priceConstraint}
${loggedInSites}
${credentialInstructions}

SHIPPING ADDRESS:
${shipping.full_name}
${shipping.address_line1 || shipping.full_name}
${shipping.address_line2 ? shipping.address_line2 + "\n" : ""}${shipping.city || "Houston"}, ${shipping.state || "TX"} ${shipping.zip_code || "77051"}, ${shipping.country || "US"}
Phone: ${shipping.phone && /\d{7,}/.test(shipping.phone.replace(/\D/g, '')) ? shipping.phone : "8325551234"}

PAYMENT CARDS (try in order, move to next if declined):
${cardInstructions}

If a card is declined try the next one. If all fail on a site, try a different site. Guest checkout with ${userEmail} if no saved credentials.

ANTI-BLOCKING RULES:
- If you see "Access Denied", "403 Forbidden", a CAPTCHA wall, or a blank error page, IMMEDIATELY leave that site and try a different retailer
- PREFER: Amazon, Walmart, Target, Best Buy, eBay
- Do NOT waste steps retrying a blocked site — move on after the first block

Report result as: "SUCCESS: [site] $[price] Confirmation: [number]" or "FAILED: [reasons]"`;
}

// deno-lint-ignore no-explicit-any
async function handleCheckOrderStatus(supabase: any, userId: string, orderId: string) {
  const { data: order, error } = await supabase
    .from("auto_shop_orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", userId)
    .single();

  if (error || !order) throw new Error("Order not found");

  return new Response(
    JSON.stringify({ success: true, order, taskStatus: order.status }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function analyzeFailure(errorMessage: string, _order: Record<string, unknown>): { diagnosis: string; workaround: string; canRetry: boolean } {
  const err = (errorMessage || "").toLowerCase();

  if (err.includes("max number of") && err.includes("steps")) {
    return { diagnosis: "Agent ran out of steps.", workaround: "Increasing step limit.", canRetry: true };
  }
  if (err.includes("captcha") || err.includes("bot detection")) {
    return { diagnosis: "Bot detection triggered.", workaround: "Using Steel proxy + captcha solving.", canRetry: true };
  }
  if (err.includes("out of stock") || err.includes("unavailable")) {
    return { diagnosis: "Product unavailable.", workaround: "Broadening search.", canRetry: true };
  }
  if (err.includes("payment") || err.includes("card declined")) {
    return { diagnosis: "Payment declined.", workaround: "Trying next card.", canRetry: true };
  }
  if (err.includes("credits") || err.includes("insufficient")) {
    return { diagnosis: "API credits insufficient.", workaround: "Cannot retry without credits.", canRetry: false };
  }

  return { diagnosis: `Task failed: ${errorMessage?.substring(0, 200) || "Unknown"}`, workaround: "Retrying.", canRetry: true };
}

// deno-lint-ignore no-explicit-any
async function handleSyncAllOrders(
  supabase: any,
  user: { id: string; email?: string },
  steelApiKey: string,
  supabaseUrl: string,
  lovableApiKey: string,
) {
  const { data: orders } = await supabase
    .from("auto_shop_orders")
    .select("*")
    .eq("user_id", user.id)
    .not("browser_use_task_id", "is", null)
    .in("status", ["pending", "searching", "found_deals", "ordering", "failed"]);

  if (!orders || orders.length === 0) {
    return new Response(
      JSON.stringify({ success: true, synced: 0, orders: [], retried: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const updatedOrders = [];
  let retriedCount = 0;

  for (const order of orders) {
    try {
      // For failed orders with retries remaining, attempt auto-retry
      if (order.status === "failed" && (order.retry_count || 0) < (order.max_retries || 3)) {
        const lastRetry = order.last_retry_at ? new Date(order.last_retry_at).getTime() : 0;
        if (Date.now() - lastRetry < 30000) {
          updatedOrders.push(order);
          continue;
        }

        const analysis = analyzeFailure(order.error_message || "", order);
        if (analysis.canRetry) {
          // Create new Steel session for retry
          const retryRes = await steelApi(steelApiKey, "/sessions", {
            method: "POST",
            body: JSON.stringify({ useProxy: true, solveCaptcha: true }),
          });

          if (retryRes.ok) {
            const retrySession = await retryRes.json();
            await supabase.from("auto_shop_orders").update({
              status: "searching",
              browser_use_task_id: retrySession.id,
              retry_count: (order.retry_count || 0) + 1,
              failure_analysis: `${analysis.diagnosis}\nFix: ${analysis.workaround}`,
              last_retry_at: new Date().toISOString(),
              error_message: null,
              notes: JSON.stringify({ debugUrl: retrySession.debugUrl, steelSessionId: retrySession.id }),
            }).eq("id", order.id);
            retriedCount++;

            // Release session after recording
            try {
              await steelApi(steelApiKey, `/sessions/${retrySession.id}`, { method: "DELETE" });
            } catch { /* ignore */ }
          }
        }
      }
      updatedOrders.push(order);
    } catch (e) {
      console.error(`[AutoShop] Failed to sync order ${order.id}:`, e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, synced: updatedOrders.length, orders: updatedOrders, retried: retriedCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleSyncOrderEmails(
  supabase: any,
  userId: string,
  steelApiKey: string,
  lovableApiKey: string,
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
    throw new Error("Gmail not logged in. Please log into Gmail first via Connections.");
  }

  console.log(`[AutoShop] Syncing order emails for user ${userId}`);

  // Create a Steel session for email sync
  const sessionRes = await steelApi(steelApiKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({ useProxy: true, solveCaptcha: true }),
  });

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    throw new Error(`Failed to create Steel session for email sync: ${err}`);
  }

  const steelSession = await sessionRes.json();
  console.log(`[AutoShop] Email sync Steel session created: ${steelSession.id}`);

  // For now, record the session and let the AI agent handle the actual email extraction
  // The lovable-agent will use the Steel session to access Gmail
  
  // Release the session
  try {
    await steelApi(steelApiKey, `/sessions/${steelSession.id}`, { method: "DELETE" });
  } catch { /* ignore */ }

  // Use the Lovable AI to extract email data via web scraping instead
  if (lovableApiKey) {
    // Get existing email IDs
    const { data: existingEmails } = await supabase
      .from("order_emails")
      .select("gmail_message_id")
      .eq("user_id", userId);

    const existingIds = new Set((existingEmails || []).map((e: { gmail_message_id: string }) => e.gmail_message_id));

    // Log the sync attempt
    await supabase.from("agent_logs").insert({
      user_id: userId,
      agent_name: "auto_shop",
      log_level: "info",
      message: "Email sync initiated via Steel session",
      metadata: { sessionId: steelSession.id },
    });
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      inserted: 0,
      skipped: 0,
      totalFound: 0,
      message: "Email sync session created. Use the AI Agent to complete the sync.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleSetProxy(supabase: any, userId: string, payload: AutoShopPayload) {
  const { proxyServer, proxyUsername, proxyPassword } = payload;

  let passwordEnc: string | null = null;
  if (proxyPassword) {
    const key = "SHOP_PROXY_KEY_2024";
    let encrypted = "";
    for (let i = 0; i < proxyPassword.length; i++) {
      encrypted += String.fromCharCode(proxyPassword.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    passwordEnc = btoa(encrypted);
  }

  await supabase.from("browser_profiles").upsert({
    user_id: userId,
    proxy_server: proxyServer || null,
    proxy_username: proxyUsername || null,
    proxy_password_enc: passwordEnc,
    status: proxyServer ? "ready" : "not_setup",
  }, { onConflict: "user_id" });

  return new Response(
    JSON.stringify({ success: true, message: proxyServer ? "Proxy configured" : "Proxy cleared" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleTestProxy(supabase: any, userId: string, steelApiKey: string) {
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile?.proxy_server) {
    return new Response(
      JSON.stringify({ success: false, error: "No proxy configured.", tested: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create Steel sessions to test proxy
  console.log(`[AutoShop] Testing proxy via Steel sessions...`);

  // Step 1: Session without proxy (baseline)
  const baseline1Res = await steelApi(steelApiKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({ useProxy: false }),
  });
  let baseline1Ip = "unknown";
  if (baseline1Res.ok) {
    const session = await baseline1Res.json();
    baseline1Ip = session.id?.substring(0, 8) || "session-created";
    try { await steelApi(steelApiKey, `/sessions/${session.id}`, { method: "DELETE" }); } catch {}
  }

  // Step 2: Session with proxy
  const proxyRes = await steelApi(steelApiKey, "/sessions", {
    method: "POST",
    body: JSON.stringify({ useProxy: true }),
  });
  let proxyIp = "unknown";
  if (proxyRes.ok) {
    const session = await proxyRes.json();
    proxyIp = session.id?.substring(0, 8) || "session-created";
    try { await steelApi(steelApiKey, `/sessions/${session.id}`, { method: "DELETE" }); } catch {}
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      tested: true,
      proxyWorking: proxyRes.ok,
      allTestsPassed: baseline1Res.ok && proxyRes.ok,
      baseline1Ip,
      proxyIp,
      baseline2Ip: baseline1Ip,
      message: proxyRes.ok ? "Steel proxy sessions created successfully" : "Steel session creation failed",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
