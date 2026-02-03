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
    const action = payload.action || "start_order";

    console.log(`[AutoShop] Action: ${action} for user: ${user.id}`);

    // Handle different actions
    switch (action) {
      case "get_status": {
        return await handleGetStatus(supabase, user.id);
      }
      case "create_profile": {
        return await handleCreateProfile(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "start_login": {
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", BROWSER_USE_API_KEY);
      }
      case "confirm_login": {
        return await handleConfirmLogin(supabase, user.id, payload.site || "gmail");
      }
      case "start_order": {
        return await handleStartOrder(supabase, user, payload, BROWSER_USE_API_KEY, supabaseUrl);
      }
      case "check_order_status": {
        return await handleCheckOrderStatus(supabase, user.id, payload.orderId!, BROWSER_USE_API_KEY);
      }
      case "sync_all_orders": {
        return await handleSyncAllOrders(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "set_proxy": {
        return await handleSetProxy(supabase, user.id, payload);
      }
      case "test_proxy": {
        return await handleTestProxy(supabase, user.id, BROWSER_USE_API_KEY);
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
  // Get browser profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  // Get order tracking
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
      } : null,
      tracking: tracking || [],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// deno-lint-ignore no-explicit-any
async function handleCreateProfile(
  supabase: any,
  userId: string,
  apiKey: string
) {
  // Check if profile exists
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

  // Create Browser Use profile
  const profileRes = await fetch("https://api.browser-use.com/api/v2/profiles", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `shop-${userId.substring(0, 8)}`,
    }),
  });

  if (!profileRes.ok) {
    const error = await profileRes.text();
    throw new Error(`Failed to create profile: ${error}`);
  }

  const profileData = await profileRes.json();
  const profileId = profileData.id || profileData.profile_id;

  // Upsert the profile record
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
  apiKey: string
) {
  // Get profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile?.browser_use_profile_id) {
    throw new Error("Create a browser profile first");
  }

  const siteUrls: Record<string, string> = {
    gmail: "https://mail.google.com",
    amazon: "https://www.amazon.com/ap/signin",
    ebay: "https://signin.ebay.com",
    walmart: "https://www.walmart.com/account/login",
  };

  const loginUrl = siteUrls[site] || `https://www.${site}.com/login`;

  // Start browser session with human control
  const taskRes = await fetch("https://api.browser-use.com/api/v2/tasks", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task: `Navigate to ${loginUrl} and wait for the user to log in manually. Do not interact with the page - just wait.`,
      startUrl: loginUrl,
      profileId: profile.browser_use_profile_id,
      allowHumanControl: true,
      maxSteps: 5,
    }),
  });

  if (!taskRes.ok) {
    const error = await taskRes.text();
    throw new Error(`Failed to start login: ${error}`);
  }

  const taskData = await taskRes.json();
  const taskId = taskData.id || taskData.task_id;
  const sessionId = taskData.session_id || taskId;
  const liveViewUrl = taskData.live_view_url || `https://browser-use.com/live/${sessionId}`;

  // Update pending login
  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: site,
      shop_pending_task_id: taskId,
      shop_pending_session_id: sessionId,
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Login started for ${site}: ${taskId}`);

  return new Response(
    JSON.stringify({
      success: true,
      taskId,
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
  site: string
) {
  // Get profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) throw new Error("Profile not found");

  // Add site to logged in list
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
async function handleStartOrder(
  supabase: any,
  user: { id: string; email?: string },
  payload: AutoShopPayload,
  apiKey: string,
  supabaseUrl: string
) {
  const { orderId, productQuery, maxPrice, quantity, shippingAddress, paymentCards } = payload;

  if (!orderId || !productQuery || !shippingAddress || !paymentCards?.length) {
    throw new Error("Missing required order data");
  }

  // Get browser profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const profileId = profile?.browser_use_profile_id;
  const sitesLoggedIn: string[] = Array.isArray(profile?.shop_sites_logged_in) 
    ? profile.shop_sites_logged_in 
    : [];
  const userEmail = user.email || "";

  console.log(`[AutoShop] Starting order: "${productQuery}"`);
  console.log(`[AutoShop] Using profile: ${profileId || "none"}, Email: ${userEmail}`);
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
    metadata: { orderId, productQuery, maxPrice, quantity, profileId, userEmail },
  });

  // Build the agent instruction
  const agentInstruction = buildShoppingAgentInstruction(
    productQuery,
    maxPrice,
    quantity || 1,
    shippingAddress,
    paymentCards,
    userEmail,
    sitesLoggedIn,
    supabaseUrl
  );

  // Call Browser Use Cloud API
  const taskPayload: Record<string, unknown> = {
    task: agentInstruction,
    startUrl: "https://www.google.com/shopping",
    llm: "browser-use-llm",
    maxSteps: 100,
    highlightElements: true,
  };

  // Use profile if available
  if (profileId) {
    taskPayload.profileId = profileId;
  }

  // Add custom proxy if configured
  if (profile?.proxy_server) {
    const proxyConfig: Record<string, string> = {
      server: profile.proxy_server,
    };
    if (profile.proxy_username) {
      proxyConfig.username = profile.proxy_username;
    }
    if (profile.proxy_password_enc) {
      // Decrypt password (simple XOR for now, same as cards)
      const key = "SHOP_PROXY_KEY_2024";
      const decoded = atob(profile.proxy_password_enc);
      let decrypted = "";
      for (let i = 0; i < decoded.length; i++) {
        decrypted += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      proxyConfig.password = decrypted;
    }
    taskPayload.proxy = proxyConfig;
    console.log(`[AutoShop] Using custom proxy: ${profile.proxy_server}`);
  }

  const browserUseResponse = await fetch("https://api.browser-use.com/api/v2/tasks", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskPayload),
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
    metadata: { orderId, taskId, profileId },
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
}

function buildShoppingAgentInstruction(
  productQuery: string,
  maxPrice: number | undefined,
  quantity: number,
  shipping: ShippingAddress,
  cards: PaymentCard[],
  userEmail: string,
  sitesLoggedIn: string[],
  supabaseUrl: string
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
4. Monitor order confirmations - The system will track emails automatically

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

STEP 1 - SEARCH FOR DEALS:
1. Start at Google Shopping and search for "${productQuery}"
2. Look at multiple results - compare prices across different sites
3. Check these sites for deals:
   - Amazon ${sitesLoggedIn.includes("amazon") ? "(LOGGED IN)" : ""}
   - eBay ${sitesLoggedIn.includes("ebay") ? "(LOGGED IN)" : ""}
   - Walmart ${sitesLoggedIn.includes("walmart") ? "(LOGGED IN)" : ""}
   - Target
   - Best Buy
   - Any other reputable e-commerce site
4. Find the BEST DEAL (lowest price with good seller rating)
5. PRIORITIZE sites you're already logged into

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
4. If already logged in, use existing account
5. If account required and not logged in:
   - Try guest checkout first
   - If must create account, use email: ${userEmail}
   - Check Gmail for verification codes if needed

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
- If email verification needed: Go to Gmail, get the code/link, complete verification

NEVER STOP. NEVER ASK FOR HELP. COMPLETE THE PURCHASE.

Report final status as one of:
- "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]"
- "FAILED: Could not complete purchase. Reason: [details]"
- "BLOCKED: [specific blocker like MFA, unsolvable CAPTCHA, etc.]"`;
}

// Check order status from Browser Use API
// deno-lint-ignore no-explicit-any
async function handleCheckOrderStatus(
  supabase: any,
  userId: string,
  orderId: string,
  apiKey: string
) {
  // Get the order
  const { data: order, error } = await supabase
    .from("auto_shop_orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", userId)
    .single();

  if (error || !order) {
    throw new Error("Order not found");
  }

  if (!order.browser_use_task_id) {
    return new Response(
      JSON.stringify({ success: true, order, taskStatus: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check Browser Use task status
  const taskRes = await fetch(`https://api.browser-use.com/api/v2/tasks/${order.browser_use_task_id}`, {
    headers: { "X-Browser-Use-API-Key": apiKey },
  });

  if (!taskRes.ok) {
    console.error("[AutoShop] Failed to fetch task status:", await taskRes.text());
    return new Response(
      JSON.stringify({ success: true, order, taskStatus: "unknown" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const taskData = await taskRes.json();
  console.log(`[AutoShop] Task ${order.browser_use_task_id} status:`, taskData.status);

  // Parse result and update order status
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
}

// Sync all pending orders for a user
// deno-lint-ignore no-explicit-any
async function handleSyncAllOrders(
  supabase: any,
  userId: string,
  apiKey: string
) {
  // Get all orders with browser_use_task_id that aren't completed/failed
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
      const taskRes = await fetch(`https://api.browser-use.com/api/v2/tasks/${order.browser_use_task_id}`, {
        headers: { "X-Browser-Use-API-Key": apiKey },
      });

      if (taskRes.ok) {
        const taskData = await taskRes.json();
        const updated = await updateOrderFromTask(supabase, order, taskData);
        updatedOrders.push(updated);
      }
    } catch (e) {
      console.error(`[AutoShop] Failed to sync order ${order.id}:`, e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, synced: updatedOrders.length, orders: updatedOrders }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Update order from Browser Use task data
// deno-lint-ignore no-explicit-any
async function updateOrderFromTask(supabase: any, order: any, taskData: any) {
  const taskStatus = taskData.status; // "pending", "running", "finished", "failed", "stopped"
  const output = taskData.output || "";

  let newStatus = order.status;
  let errorMessage = order.error_message;
  let orderConfirmation = order.order_confirmation;
  let selectedDealSite = order.selected_deal_site;
  let selectedDealPrice = order.selected_deal_price;

  if (taskStatus === "finished") {
    // Parse the output to determine success/failure
    const outputLower = output.toLowerCase();
    
    if (outputLower.includes("success") && outputLower.includes("order placed")) {
      newStatus = "completed";
      // Try to extract confirmation number
      const confMatch = output.match(/confirmation[:\s]*([A-Z0-9-]+)/i);
      if (confMatch) orderConfirmation = confMatch[1];
      // Try to extract site
      const siteMatch = output.match(/at\s+(\w+)/i);
      if (siteMatch) selectedDealSite = siteMatch[1];
      // Try to extract price
      const priceMatch = output.match(/\$([0-9,.]+)/);
      if (priceMatch) selectedDealPrice = parseFloat(priceMatch[1].replace(",", ""));
    } else if (outputLower.includes("failed") || outputLower.includes("could not")) {
      newStatus = "failed";
      errorMessage = output.substring(0, 500);
    } else if (outputLower.includes("blocked")) {
      newStatus = "failed";
      errorMessage = output.substring(0, 500);
    } else {
      // Task finished but unclear result - check if it found something
      newStatus = "completed";
    }
  } else if (taskStatus === "failed" || taskStatus === "stopped") {
    newStatus = "failed";
    errorMessage = taskData.error || "Task failed or was stopped";
  } else if (taskStatus === "running") {
    // Keep as searching/ordering
    if (order.status === "pending") newStatus = "searching";
  }

  // Only update if status changed
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

// deno-lint-ignore no-explicit-any
async function handleSetProxy(
  supabase: any,
  userId: string,
  payload: AutoShopPayload
) {
  const { proxyServer, proxyUsername, proxyPassword } = payload;

  // Encrypt password if provided
  let passwordEnc: string | null = null;
  if (proxyPassword) {
    const key = "SHOP_PROXY_KEY_2024";
    let encrypted = "";
    for (let i = 0; i < proxyPassword.length; i++) {
      encrypted += String.fromCharCode(proxyPassword.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    passwordEnc = btoa(encrypted);
  }

  // Upsert the profile with proxy settings
  const { error } = await supabase
    .from("browser_profiles")
    .upsert({
      user_id: userId,
      proxy_server: proxyServer || null,
      proxy_username: proxyUsername || null,
      proxy_password_enc: passwordEnc,
      status: proxyServer ? "ready" : "not_setup",
    }, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to save proxy: ${error.message}`);
  }

  console.log(`[AutoShop] Proxy configured: ${proxyServer || "cleared"}`);

  return new Response(
    JSON.stringify({ 
      success: true, 
      message: proxyServer ? "Proxy configured" : "Proxy cleared" 
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Test proxy by making a simple request through Browser Use API
// Helper to fetch IP from Browser Use
async function fetchIpWithBrowserUse(
  apiKey: string,
  proxyConfig?: Record<string, string>
): Promise<{ ip: string | null; status: string; error?: string }> {
  const taskPayload: Record<string, unknown> = {
    task: "Navigate to https://httpbin.org/ip and extract the IP address shown on the page. Return ONLY the IP address, nothing else.",
    startUrl: "https://httpbin.org/ip",
    llm: "browser-use-llm",
    maxSteps: 5,
  };

  if (proxyConfig) {
    taskPayload.proxy = proxyConfig;
  }

  try {
    const response = await fetch("https://api.browser-use.com/api/v2/tasks", {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(taskPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ip: null, status: "failed", error: errorText };
    }

    const result = await response.json();
    const taskId = result.id || result.task_id;

    // Poll for result (max 60 seconds)
    let attempts = 0;
    const maxAttempts = 30;
    let taskStatus = "pending";
    let taskOutput = "";

    while (attempts < maxAttempts && taskStatus !== "finished" && taskStatus !== "failed" && taskStatus !== "stopped") {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const statusRes = await fetch(`https://api.browser-use.com/api/v2/tasks/${taskId}`, {
        headers: { "X-Browser-Use-API-Key": apiKey },
      });
      
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        taskStatus = statusData.status;
        taskOutput = statusData.output || "";
      }
      
      attempts++;
    }

    const ipMatch = taskOutput.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    return { 
      ip: ipMatch ? ipMatch[1] : null, 
      status: taskStatus 
    };
  } catch (error) {
    return { 
      ip: null, 
      status: "error", 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

// deno-lint-ignore no-explicit-any
async function handleTestProxy(
  supabase: any,
  userId: string,
  apiKey: string
) {
  // Get profile with proxy settings
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile?.proxy_server) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "No proxy configured. Add a proxy server first.",
        tested: false
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[AutoShop] Testing proxy: ${profile.proxy_server}`);

  // Build proxy config
  const proxyConfig: Record<string, string> = {
    server: profile.proxy_server,
  };
  if (profile.proxy_username) {
    proxyConfig.username = profile.proxy_username;
  }
  if (profile.proxy_password_enc) {
    const key = "SHOP_PROXY_KEY_2024";
    const decoded = atob(profile.proxy_password_enc);
    let decrypted = "";
    for (let i = 0; i < decoded.length; i++) {
      decrypted += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    proxyConfig.password = decrypted;
  }

  // Run BOTH tests in parallel - one without proxy (baseline) and one with proxy
  console.log("[AutoShop] Running parallel IP tests (baseline + proxy)...");
  
  const [baselineResult, proxyResult] = await Promise.all([
    fetchIpWithBrowserUse(apiKey), // No proxy - Browser Use's default IP
    fetchIpWithBrowserUse(apiKey, proxyConfig), // With proxy
  ]);

  console.log(`[AutoShop] Baseline IP: ${baselineResult.ip}, Proxy IP: ${proxyResult.ip}`);

  const proxyWorking = 
    proxyResult.status === "finished" && 
    proxyResult.ip !== null &&
    proxyResult.ip !== baselineResult.ip;

  return new Response(
    JSON.stringify({ 
      success: true, 
      tested: true,
      proxyWorking,
      baselineIp: baselineResult.ip,
      proxyIp: proxyResult.ip,
      baselineStatus: baselineResult.status,
      proxyStatus: proxyResult.status,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
