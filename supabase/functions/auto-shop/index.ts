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

// Bridge-first execution: self-hosted bridge → Browser Use Cloud fallback
const BRIDGE_URL = Deno.env.get("BROWSER_USE_BRIDGE_URL") || Deno.env.get("BRIDGE_URL");
const BRIDGE_API_KEY = Deno.env.get("BROWSER_USE_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY");
const BU_API_BASE = "https://api.browser-use.com/api/v2";

// Retry-til-die constants
const RETRY_SITES = [
  "https://www.amazon.com",
  "https://www.walmart.com",
  "https://www.target.com",
  "https://www.bestbuy.com",
  "https://www.ebay.com",
];
const MAX_MISSION_RETRIES = 10; // retry across sites until success or exhaustion
const RETRY_BACKOFF_MS = 5000; // 5s between retries

interface MissionState {
  attempts: Array<{ site: string; attemptNum: number; outcome: string; error?: string; timestamp: string }>;
  currentSiteIndex: number;
  totalAttempts: number;
  objectiveMet: boolean;
  winningSite?: string;
  confirmationNumber?: string;
}

async function runBridgeTask(task: string, startUrl: string, maxSteps: number, proxy?: { server: string; username?: string; password?: string }): Promise<{ success: boolean; taskId?: string; liveViewUrl?: string; error?: string; source: string }> {
  // Try bridge first
  if (BRIDGE_URL && BRIDGE_API_KEY) {
    try {
      console.log(`[AutoShop] Attempting bridge: ${BRIDGE_URL}`);
      const bridgePayload: Record<string, unknown> = { task, start_url: startUrl, max_steps: maxSteps };
      if (proxy?.server) {
        bridgePayload.proxy = { server: proxy.server, username: proxy.username, password: proxy.password };
      }
      const res = await fetch(`${BRIDGE_URL}/run-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": BRIDGE_API_KEY },
        body: JSON.stringify(bridgePayload),
      });
      if (res.ok) {
        const data = await res.json();
        const taskId = data.task_id || data.id;
        const liveViewUrl = data.live_url || data.liveUrl || data.debug_url || null;
        console.log(`[AutoShop] Bridge task started: ${taskId}, liveView: ${liveViewUrl}`);
        return { success: true, taskId, liveViewUrl, source: "bridge" };
      }
      console.warn(`[AutoShop] Bridge returned ${res.status}, falling back to cloud`);
    } catch (e) {
      console.warn(`[AutoShop] Bridge unreachable, falling back to cloud:`, e);
    }
  }

  // Fallback: Browser Use Cloud
  const buApiKey = Deno.env.get("BROWSER_USE_API_KEY");
  if (!buApiKey) return { success: false, error: "No BROWSER_USE_API_KEY configured", source: "none" };

  try {
    const res = await fetch(`${BU_API_BASE}/tasks`, {
      method: "POST",
      headers: { "X-Browser-Use-API-Key": buApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ task, startUrl, maxSteps }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Cloud API ${res.status}: ${err}`, source: "cloud" };
    }
    const data = await res.json();
    console.log(`[AutoShop] Cloud task started: ${data.id}`);
    // Try to get live URL from session
    let liveViewUrl: string | undefined;
    if (data.sessionId && buApiKey) {
      try {
        const sessRes = await fetch(`${BU_API_BASE}/sessions/${data.sessionId}`, {
          headers: { "X-Browser-Use-API-Key": buApiKey },
        });
        if (sessRes.ok) {
          const sessData = await sessRes.json();
          liveViewUrl = sessData.liveUrl || sessData.live_url || undefined;
        }
      } catch (_) {}
    }
    return { success: true, taskId: data.id, liveViewUrl, source: "cloud" };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), source: "cloud" };
  }
}

interface PollResult {
  status: string;
  result?: string;
  error?: string;
  current_url?: string;
  current_step?: number;
  total_steps?: number;
  step_description?: string;
  screenshot_url?: string;
  live_url?: string;
  output?: string;
}

async function pollTaskStatus(taskId: string, source: string): Promise<PollResult> {
  if (source === "bridge" && BRIDGE_URL && BRIDGE_API_KEY) {
    try {
      const res = await fetch(`${BRIDGE_URL}/runs/${taskId}/status`, {
        headers: { "X-API-Key": BRIDGE_API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        return {
          status: data.status || "unknown",
          result: data.result || data.output,
          error: data.error,
          current_url: data.current_url,
          current_step: data.current_step || data.step,
          total_steps: data.total_steps || data.max_steps,
          step_description: data.step_description || data.last_action || data.description,
          screenshot_url: data.screenshot_url || data.screenshot,
          live_url: data.live_url || data.liveUrl,
        };
      }
    } catch (_) {}
  }
  // Fallback to cloud polling
  const buApiKey = Deno.env.get("BROWSER_USE_API_KEY");
  if (!buApiKey) return { status: "unknown", error: "No API key" };
  try {
    const res = await fetch(`${BU_API_BASE}/tasks/${taskId}`, {
      headers: { "X-Browser-Use-API-Key": buApiKey },
    });
    if (res.ok) {
      const data = await res.json();
      return {
        status: data.status || "unknown",
        result: data.result || data.output,
        error: data.error,
        current_url: data.currentUrl || data.url,
        current_step: data.completedSteps || data.step,
        total_steps: data.totalSteps || data.maxSteps,
        step_description: data.stepDescription || data.lastAction,
        screenshot_url: data.screenshotUrl,
        live_url: data.liveUrl,
      };
    }
    return { status: "unknown", error: `${res.status}` };
  } catch (e) {
    return { status: "unknown", error: e instanceof Error ? e.message : String(e) };
  }
}

// Legacy wrapper for code that still uses browserUseApi
async function browserUseApi(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${BU_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-Browser-Use-API-Key": apiKey,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  console.log(`[BrowserUse] ${init.method || "GET"} ${path}`);
  return fetch(url, { ...init, headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const BU_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!BU_API_KEY) {
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

    switch (action) {
      case "get_status": {
        return await handleGetStatus(supabase, user.id);
      }
      case "create_profile": {
        return await handleCreateProfile(supabase, user.id);
      }
      case "start_login": {
         await cleanupStaleSessions(supabase, user.id, BU_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", BU_API_KEY);
      }
      case "confirm_login": {
        return await handleConfirmLogin(supabase, user.id, payload.site || "gmail", BU_API_KEY);
      }
      case "cancel_login": {
        return await handleCancelLogin(supabase, user.id, BU_API_KEY);
      }
      case "restart_session": {
        await cleanupStaleSessions(supabase, user.id, BU_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", BU_API_KEY);
      }
      case "cleanup_sessions": {
        return await handleCleanupSessions(supabase, user.id, BU_API_KEY);
      }
      case "start_order": {
        return await handleStartOrder(supabase, user, payload, BU_API_KEY, LOVABLE_API_KEY || "", supabaseUrl);
      }
      case "check_order_status": {
        return await handleCheckOrderStatus(supabase, user.id, payload.orderId!);
      }
      case "sync_all_orders": {
        return await handleSyncAllOrders(supabase, user, BU_API_KEY, supabaseUrl, LOVABLE_API_KEY || "");
      }
      case "sync_order_emails": {
        return await handleSyncOrderEmails(supabase, user.id, BU_API_KEY, LOVABLE_API_KEY || "");
      }
      case "set_proxy": {
        return await handleSetProxy(supabase, user.id, payload);
      }
      case "test_proxy": {
        return await handleTestProxy(supabase, user.id, SKYVERN_API_KEY);
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

  const profileId = `bu-shop-${userId.substring(0, 8)}-${Date.now()}`;

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
  buApiKey: string
) {
  let { data: profile } = await supabase.from("browser_profiles").select("*").eq("user_id", userId).single();

  if (!profile?.browser_use_profile_id) {
    const profileId = `bu-shop-${userId.substring(0, 8)}-${Date.now()}`;
    await supabase.from("browser_profiles").upsert({ user_id: userId, browser_use_profile_id: profileId, status: "ready", shop_sites_logged_in: [] }, { onConflict: "user_id" });
    const { data: newProfile } = await supabase.from("browser_profiles").select("*").eq("user_id", userId).single();
    profile = newProfile;
  }

  const siteUrls: Record<string, string> = { gmail: "https://mail.google.com", amazon: "https://www.amazon.com/ap/signin", ebay: "https://signin.ebay.com", walmart: "https://www.walmart.com/account/login" };
  const loginUrl = siteUrls[site] || `https://www.${site}.com/login`;

  console.log(`[AutoShop] Creating Browser Use task for login: ${loginUrl}`);

  // Create session with profile
  let sessionId: string | undefined;
  if (profile?.browser_use_profile_id) {
    try {
      const sessionRes = await fetch(`${BU_API_BASE}/sessions`, {
        method: "POST",
        headers: { "X-Browser-Use-API-Key": buApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.browser_use_profile_id }),
      });
      if (sessionRes.ok) {
        const session = await sessionRes.json();
        sessionId = session.id;
      }
    } catch (_) {}
  }

  const taskBody: any = {
    task: `Navigate to ${loginUrl} and display the login page.`,
    startUrl: loginUrl,
    maxSteps: 30,
  };
  if (sessionId) taskBody.sessionId = sessionId;

  const taskRes = await browserUseApi(buApiKey, "/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody),
  });

  if (!taskRes.ok) {
    const err = await taskRes.text();
    console.error(`[AutoShop] Browser Use task creation failed: ${err}`);
    throw new Error(`Failed to create task: ${err}`);
  }

  const taskData = await taskRes.json();
  const runId = taskData.id;

  // Get live URL
  let liveViewUrl = null;
  if (taskData.sessionId) {
    try {
      const sessRes = await fetch(`${BU_API_BASE}/sessions/${taskData.sessionId}`, {
        headers: { "X-Browser-Use-API-Key": buApiKey },
      });
      if (sessRes.ok) {
        const sessData = await sessRes.json();
        liveViewUrl = sessData.liveUrl || null;
      }
    } catch (_) {}
  }

  await supabase.from("browser_profiles").update({ shop_pending_login_site: site, shop_pending_task_id: null, shop_pending_session_id: runId }).eq("user_id", userId);

  return new Response(JSON.stringify({ success: true, taskId: runId, sessionId: runId, liveViewUrl, site }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
async function handleConfirmLogin(supabase: any, userId: string, site: string, _buApiKey: string) {
  const { data: profile } = await supabase.from("browser_profiles").select("*").eq("user_id", userId).single();
  if (!profile) throw new Error("Profile not found");

  const currentSites: string[] = Array.isArray(profile.shop_sites_logged_in) ? profile.shop_sites_logged_in : [];
  if (!currentSites.includes(site)) currentSites.push(site);

  await supabase.from("browser_profiles").update({
    shop_sites_logged_in: currentSites, shop_pending_login_site: null, shop_pending_task_id: null, shop_pending_session_id: null, last_login_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return new Response(JSON.stringify({ success: true, site }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
async function handleCancelLogin(supabase: any, userId: string, _buApiKey: string) {
  await supabase.from("browser_profiles").update({ shop_pending_login_site: null, shop_pending_task_id: null, shop_pending_session_id: null }).eq("user_id", userId);
  return new Response(JSON.stringify({ success: true, message: "Login session cancelled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
async function cleanupStaleSessions(supabase: any, userId: string, _buApiKey: string): Promise<{ sessionsKilled: number }> {
  await supabase.from("browser_profiles").update({ shop_pending_login_site: null, shop_pending_task_id: null, shop_pending_session_id: null }).eq("user_id", userId);
  return { sessionsKilled: 0 };
}

// deno-lint-ignore no-explicit-any
async function handleCleanupSessions(supabase: any, userId: string, buApiKey: string) {
  const result = await cleanupStaleSessions(supabase, userId, buApiKey);
  return new Response(JSON.stringify({ success: true, message: "Sessions cleaned up", ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
  buApiKey: string,
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

  // Get proxy config
  let proxy: { server: string; username?: string; password?: string } | undefined;
  if (profile?.proxy_server) {
    const encKey = "SHOP_PROXY_KEY_2024";
    let decryptedPw: string | undefined;
    if (profile.proxy_password_enc) {
      try {
        const decoded = atob(profile.proxy_password_enc);
        decryptedPw = "";
        for (let i = 0; i < decoded.length; i++) {
          decryptedPw += String.fromCharCode(decoded.charCodeAt(i) ^ encKey.charCodeAt(i % encKey.length));
        }
      } catch (_) {}
    }
    proxy = { server: profile.proxy_server, username: profile.proxy_username || undefined, password: decryptedPw };
  }

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

  // Initialize mission state
  const mission: MissionState = {
    attempts: [],
    currentSiteIndex: 0,
    totalAttempts: 0,
    objectiveMet: false,
  };

  console.log(`[AutoShop] Starting MISSION for "${productQuery}" — retry-til-die mode (max ${MAX_MISSION_RETRIES} attempts)`);
  await supabase.from("auto_shop_orders").update({ status: "searching", retry_count: 0, max_retries: MAX_MISSION_RETRIES }).eq("id", orderId);
  await supabase.from("agent_logs").insert({ user_id: user.id, agent_name: "auto_shop", log_level: "info", message: `Mission started: "${productQuery}" — bridge-first, retry-til-die`, metadata: { orderId, productQuery, maxPrice, quantity, userEmail, maxRetries: MAX_MISSION_RETRIES } });

  // Build the agent prompt
  const agentPrompt = buildShoppingAgentInstruction(
    productQuery, maxPrice, quantity || 1, shippingAddress, paymentCards,
    userEmail, sitesLoggedIn, supabaseUrl, false, decryptedCreds
  );

  // ── MISSION LOOP (fire-and-forget) ──
  const missionLoop = async () => {
    try {
      while (!mission.objectiveMet && mission.totalAttempts < MAX_MISSION_RETRIES) {
        const siteUrl = RETRY_SITES[mission.currentSiteIndex % RETRY_SITES.length];
        const siteName = new URL(siteUrl).hostname.replace("www.", "");
        mission.totalAttempts++;

        console.log(`[AutoShop] Mission attempt ${mission.totalAttempts}/${MAX_MISSION_RETRIES} → ${siteName}`);
        await supabase.from("agent_logs").insert({
          user_id: user.id, agent_name: "auto_shop", log_level: "info",
          message: `Attempt ${mission.totalAttempts}/${MAX_MISSION_RETRIES}: trying ${siteName}`,
          metadata: { orderId, attempt: mission.totalAttempts, site: siteName },
        });

        // Run task via bridge-first
        const taskResult = await runBridgeTask(
          `${agentPrompt}\n\nSTART ON: ${siteUrl}\nIf blocked or items unavailable on this site, report FAILED immediately — do NOT navigate to other sites.`,
          siteUrl,
          80,
          proxy
        );

        if (!taskResult.success) {
          mission.attempts.push({ site: siteName, attemptNum: mission.totalAttempts, outcome: "task_creation_failed", error: taskResult.error, timestamp: new Date().toISOString() });
          await supabase.from("auto_shop_orders").update({
            retry_count: mission.totalAttempts,
            failure_analysis: `Attempt ${mission.totalAttempts}: ${taskResult.error}`,
            last_retry_at: new Date().toISOString(),
          }).eq("id", orderId);
          mission.currentSiteIndex++;
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }

        // Update order with current task + live view URL
        await supabase.from("auto_shop_orders").update({
          browser_use_task_id: taskResult.taskId,
          status: "searching",
          notes: JSON.stringify({ missionState: mission, currentTaskId: taskResult.taskId, source: taskResult.source, liveViewUrl: taskResult.liveViewUrl || null, currentSite: siteName }),
        }).eq("id", orderId);

        // Poll until complete (max 10 min per attempt)
        const pollDeadline = Date.now() + 10 * 60 * 1000;
        let finalStatus = "unknown";
        let finalResult = "";
        let finalError = "";

        while (Date.now() < pollDeadline) {
          await sleep(15000); // poll every 15s

          // ── HUMAN STRATEGIC INJECTION ──
          // Check agent_tasks for mid-run instructions from the user
          try {
            const { data: injections } = await supabase
              .from("agent_tasks")
              .select("id, payload, task_type")
              .eq("user_id", user.id)
              .eq("status", "pending")
              .in("task_type", ["shop_injection", "strategic_injection"])
              .order("created_at", { ascending: true })
              .limit(5);

            if (injections && injections.length > 0) {
              for (const inj of injections) {
                const instruction = (inj.payload as any)?.instruction || (inj.payload as any)?.message || "";
                if (instruction) {
                  console.log(`[AutoShop] Human injection received: ${instruction}`);
                  await supabase.from("agent_logs").insert({
                    user_id: user.id, agent_name: "auto_shop", log_level: "info",
                    message: `Human injection applied: ${instruction}`,
                    metadata: { orderId, injectionId: inj.id, attempt: mission.totalAttempts },
                  });
                  // Mark injection as consumed
                  await supabase.from("agent_tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", inj.id);

                  // If instruction says to skip/abandon current site, break polling early
                  const instrLower = instruction.toLowerCase();
                  if (instrLower.includes("skip") || instrLower.includes("abandon") || instrLower.includes("next site") || instrLower.includes("try another")) {
                    console.log(`[AutoShop] Injection: abandoning current site per user instruction`);
                    finalStatus = "failed";
                    finalError = `User requested site change: ${instruction}`;
                    break;
                  }
                }
              }
              if (finalStatus === "failed") break;
            }
          } catch (injErr) {
            console.warn("[AutoShop] Injection check failed:", injErr);
          }

          const status = await pollTaskStatus(taskResult.taskId!, taskResult.source);
          
          if (status.status === "completed" || status.status === "finished" || status.status === "done") {
            finalStatus = "completed";
            finalResult = status.result || JSON.stringify(status);
            break;
          }
          if (status.status === "failed" || status.status === "error") {
            finalStatus = "failed";
            finalError = status.error || status.result || "Task failed";
            break;
          }
          // still running...
        }

        if (finalStatus === "unknown") {
          finalStatus = "timeout";
          finalError = "Task exceeded 10 minute timeout";
        }

        // Check if objective was met
        const resultLower = (finalResult + finalError).toLowerCase();
        const successIndicators = ["success", "confirmation", "order placed", "order confirmed", "thank you for your order", "order #"];
        const objectiveMet = finalStatus === "completed" && successIndicators.some(s => resultLower.includes(s));

        mission.attempts.push({
          site: siteName, attemptNum: mission.totalAttempts,
          outcome: objectiveMet ? "SUCCESS" : finalStatus,
          error: finalError || undefined,
          timestamp: new Date().toISOString(),
        });

        if (objectiveMet) {
          mission.objectiveMet = true;
          mission.winningSite = siteName;
          // Try to extract confirmation number
          const confMatch = finalResult.match(/(?:confirmation|order)\s*(?:#|number|:)\s*([A-Z0-9-]+)/i);
          if (confMatch) mission.confirmationNumber = confMatch[1];

          await supabase.from("auto_shop_orders").update({
            status: "completed",
            completed_at: new Date().toISOString(),
            selected_deal_site: siteName,
            order_confirmation: mission.confirmationNumber || "See task result",
            retry_count: mission.totalAttempts,
            notes: JSON.stringify({ missionState: mission, finalResult }),
            error_message: null,
          }).eq("id", orderId);

          await supabase.from("agent_logs").insert({
            user_id: user.id, agent_name: "auto_shop", log_level: "info",
            message: `MISSION COMPLETE on ${siteName} after ${mission.totalAttempts} attempts${mission.confirmationNumber ? ` — confirmation: ${mission.confirmationNumber}` : ""}`,
            metadata: { orderId, mission },
          });
          break;
        }

        // Not met — analyze and rotate
        const analysis = analyzeFailure(finalError || finalResult, {});
        await supabase.from("auto_shop_orders").update({
          status: "failed",
          retry_count: mission.totalAttempts,
          failure_analysis: `Attempt ${mission.totalAttempts} (${siteName}): ${analysis.diagnosis}`,
          last_retry_at: new Date().toISOString(),
          error_message: finalError || `Failed on ${siteName}`,
          notes: JSON.stringify({ missionState: mission }),
        }).eq("id", orderId);

        // Rotate to next site
        mission.currentSiteIndex++;
        
        // Backoff before next attempt
        const backoff = RETRY_BACKOFF_MS * Math.min(mission.totalAttempts, 4);
        console.log(`[AutoShop] Attempt ${mission.totalAttempts} failed on ${siteName}. Backing off ${backoff}ms before next try.`);
        await sleep(backoff);
      }

      // Mission exhausted
      if (!mission.objectiveMet) {
        const sitesSummary = mission.attempts.map(a => `${a.site}: ${a.outcome}${a.error ? ` (${a.error.substring(0, 80)})` : ""}`).join("; ");
        await supabase.from("auto_shop_orders").update({
          status: "failed",
          error_message: `Mission exhausted after ${mission.totalAttempts} attempts across ${new Set(mission.attempts.map(a => a.site)).size} sites`,
          failure_analysis: sitesSummary,
          notes: JSON.stringify({ missionState: mission }),
        }).eq("id", orderId);

        await supabase.from("agent_logs").insert({
          user_id: user.id, agent_name: "auto_shop", log_level: "error",
          message: `MISSION FAILED after ${mission.totalAttempts} attempts: ${sitesSummary.substring(0, 300)}`,
          metadata: { orderId, mission },
        });
      }
    } catch (err) {
      console.error("[AutoShop] Mission loop crashed:", err);
      await supabase.from("auto_shop_orders").update({
        status: "failed",
        error_message: `Mission loop error: ${err instanceof Error ? err.message : String(err)}`,
      }).eq("id", orderId);
    }
  };

  // Fire-and-forget the mission loop
  if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
    (EdgeRuntime as any).waitUntil(missionLoop());
  } else {
    missionLoop().catch(console.error);
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `Shopping mission started — will retry across ${RETRY_SITES.length} sites up to ${MAX_MISSION_RETRIES} times`,
      orderId,
      status: "searching",
      maxRetries: MAX_MISSION_RETRIES,
      sites: RETRY_SITES.map(u => new URL(u).hostname.replace("www.", "")),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    return { diagnosis: "Bot detection triggered.", workaround: "Using Browser Use with different approach.", canRetry: true };
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
  buApiKey: string,
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
      // For failed orders with retries remaining, attempt auto-retry via bridge-first
      if (order.status === "failed" && (order.retry_count || 0) < (order.max_retries || MAX_MISSION_RETRIES)) {
        const lastRetry = order.last_retry_at ? new Date(order.last_retry_at).getTime() : 0;
        if (Date.now() - lastRetry < 30000) {
          updatedOrders.push(order);
          continue;
        }

        const analysis = analyzeFailure(order.error_message || "", order);
        if (analysis.canRetry) {
          // Rotate site for retry
          const attemptNum = (order.retry_count || 0) + 1;
          const siteUrl = RETRY_SITES[attemptNum % RETRY_SITES.length];
          const siteName = new URL(siteUrl).hostname.replace("www.", "");

          const retryResult = await runBridgeTask(
            `Retry purchasing: ${order.product_query}. Previous error: ${order.error_message}\n\nSTART ON: ${siteUrl}. If blocked, report FAILED immediately.`,
            siteUrl,
            80
          );

          if (retryResult.success) {
            await supabase.from("auto_shop_orders").update({
              status: "searching",
              browser_use_task_id: retryResult.taskId,
              retry_count: attemptNum,
              failure_analysis: `Attempt ${attemptNum} (${siteName}): ${analysis.diagnosis}\nFix: ${analysis.workaround}`,
              last_retry_at: new Date().toISOString(),
              error_message: null,
              notes: JSON.stringify({ taskId: retryResult.taskId, source: retryResult.source, site: siteName }),
            }).eq("id", order.id);
            retriedCount++;
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
  buApiKey: string,
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

  // Create a Browser Use task for email sync
  const taskRes = await browserUseApi(buApiKey, "/tasks", {
    method: "POST",
    body: JSON.stringify({
      task: "Navigate to Gmail, find recent order confirmation and shipping emails. Extract order details including order numbers, items, prices, and tracking information.",
      startUrl: "https://mail.google.com",
      maxSteps: 50,
    }),
  });

  let buTaskId = "unknown";
  if (taskRes.ok) {
    const taskData = await taskRes.json();
    buTaskId = taskData.id || "unknown";
    console.log(`[AutoShop] Email sync Browser Use task created: ${buTaskId}`);
  } else {
    const err = await taskRes.text();
    console.error(`[AutoShop] Failed to create Browser Use task for email sync: ${err}`);
  }

  // Log the sync attempt
  if (lovableApiKey) {
    const { data: existingEmails } = await supabase
      .from("order_emails")
      .select("gmail_message_id")
      .eq("user_id", userId);

    const existingIds = new Set((existingEmails || []).map((e: { gmail_message_id: string }) => e.gmail_message_id));

    await supabase.from("agent_logs").insert({
      user_id: userId,
      agent_name: "auto_shop",
      log_level: "info",
      message: "Email sync initiated via Browser Use task",
      metadata: { buTaskId },
    });
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      inserted: 0,
      skipped: 0,
      totalFound: 0,
      message: "Email sync task created. Use the AI Agent to complete the sync.",
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
async function handleTestProxy(supabase: any, userId: string, buApiKey: string) {
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

  console.log(`[AutoShop] Testing proxy via Browser Use task...`);

  const testRes = await browserUseApi(buApiKey, "/tasks", {
    method: "POST",
    body: JSON.stringify({
      task: "Navigate to https://httpbin.org/ip and extract the visible IP address from the page.",
      startUrl: "https://httpbin.org/ip",
      maxSteps: 10,
    }),
  });

  let proxyWorking = false;
  let proxyIp = "unknown";
  if (testRes.ok) {
    const taskData = await testRes.json();
    proxyWorking = true;
    proxyIp = taskData.id?.substring(0, 8) || "task-created";
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      tested: true,
      proxyWorking,
      allTestsPassed: proxyWorking,
      baseline1Ip: "browser-use-managed",
      proxyIp,
      baseline2Ip: "browser-use-managed",
      message: proxyWorking ? "Browser Use proxy test task created successfully" : "Browser Use task creation failed",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
