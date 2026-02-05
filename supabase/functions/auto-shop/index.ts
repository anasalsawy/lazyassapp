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

type BrowserUseJson = Record<string, unknown>;

// Fisher-Yates shuffle - randomizes array order to prevent predictable card usage patterns
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const BROWSER_USE_BASE_URLS = [
  "https://api.browser-use.com",
];

// Browser Use API v2 status values (per official API spec)
// Task status: started, paused, finished, stopped
// Session status: active, stopped
const BROWSER_USE_TASK_ACTIVE_STATUSES = ["started", "paused"];

// Unified profile naming - shared between job-agent and auto-shop
// This ensures authentication cookies (Gmail, etc.) are shared across features
const getProfileName = (userId: string) => `user-${userId.substring(0, 8)}`;

async function browserUseFetchJson(
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<{ baseUrl: string; status: number; data: BrowserUseJson }> {
  let lastExceptionText = "";
  let lastHttpError: { baseUrl: string; status: number; text: string } | null = null;

  for (const baseUrl of BROWSER_USE_BASE_URLS) {
    try {
      // Ensure path uses /api/v2 format as per Browser Use Cloud v2 API spec
      const normalizedPath = path.startsWith("/api/v2") ? path : (path.startsWith("/v2") ? `/api${path}` : `/api/v2${path}`);
      const res = await fetch(`${baseUrl}${normalizedPath}`, {
        ...init,
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });

      const text = await res.text();
      if (!res.ok) {
        // Keep the most recent *HTTP* error (prefer this over DNS/connection errors)
        lastHttpError = { baseUrl, status: res.status, text };
        continue;
      }

      let json: BrowserUseJson = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }

      return { baseUrl, status: res.status, data: json };
    } catch (e) {
      lastExceptionText = e instanceof Error ? e.message : String(e);
      continue;
    }
  }

  if (lastHttpError) {
    throw new Error(
      `Browser Use API ${lastHttpError.status} for ${path} via ${lastHttpError.baseUrl}: ${lastHttpError.text || "(empty response)"}`,
    );
  }

  throw new Error(`Browser Use API request failed for ${path}: ${lastExceptionText || "unknown error"}`);
}

async function browserUseFetchJsonMultiPath(
  apiKey: string,
  paths: string[],
  init: RequestInit,
): Promise<{ baseUrl: string; status: number; data: BrowserUseJson; path: string }> {
  let lastErr: unknown = null;
  for (const p of paths) {
    try {
      const res = await browserUseFetchJson(apiKey, p, init);
      return { ...res, path: p };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Browser Use API request failed (all path variants)");
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
        // Clean up stale sessions before starting new one
        await cleanupStaleSessions(supabase, user.id, BROWSER_USE_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", BROWSER_USE_API_KEY);
      }
      case "confirm_login": {
        return await handleConfirmLogin(supabase, user.id, payload.site || "gmail", BROWSER_USE_API_KEY);
      }
      case "cancel_login": {
        return await handleCancelLogin(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "restart_session": {
        // Force cleanup and restart a fresh session for a site
        await cleanupStaleSessions(supabase, user.id, BROWSER_USE_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", BROWSER_USE_API_KEY);
      }
      case "cleanup_sessions": {
        return await handleCleanupSessions(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "start_order": {
        // CONCURRENT ORDERS: Do NOT cleanup any sessions before starting new order
        // Each order gets its own independent session - multiple orders can run simultaneously
        return await handleStartOrder(supabase, user, payload, BROWSER_USE_API_KEY, supabaseUrl);
      }
      case "check_order_status": {
        return await handleCheckOrderStatus(supabase, user.id, payload.orderId!, BROWSER_USE_API_KEY);
      }
      case "sync_all_orders": {
        return await handleSyncAllOrders(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "sync_order_emails": {
        // CONCURRENT: Do NOT cleanup sessions before email sync
        return await handleSyncOrderEmails(supabase, user.id, BROWSER_USE_API_KEY);
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
  // NOTE: Browser Use has historically supported both `/v2/...` and `/api/v2/...`.
  // Some environments silently accept the request on one path but omit newer fields.
  // We try both and log which one succeeded.
  const profileName = getProfileName(userId);
  const profileCreate = await browserUseFetchJsonMultiPath(
    apiKey,
    ["/api/v2/profiles", "/v2/profiles"],
    {
      method: "POST",
      body: JSON.stringify({ name: profileName }),
    },
  );

  console.log(`[AutoShop] Profile create ok via ${profileCreate.baseUrl}${profileCreate.path}`);

  const profileData = profileCreate.data;
  const profileId = (profileData.id as string) || (profileData.profile_id as string);

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
  let { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  // Auto-create profile if missing
  if (!profile?.browser_use_profile_id) {
    console.log(`[AutoShop] No profile found, auto-creating for user ${userId}`);
    
    const profileName = getProfileName(userId);
    const profileRes = await fetch("https://api.browser-use.com/api/v2/profiles", {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: profileName }),
    });

    if (!profileRes.ok) {
      const err = await profileRes.text();
      throw new Error(`Failed to create profile: ${err}`);
    }

    const profileData = await profileRes.json();
    const profileId = profileData.id;

    if (!profileId) {
      throw new Error("Failed to create Browser Use profile");
    }

    // Upsert the profile record
    await supabase.from("browser_profiles").upsert({
      user_id: userId,
      browser_use_profile_id: profileId,
      status: "ready",
      shop_sites_logged_in: [],
    }, { onConflict: "user_id" });

    console.log(`[AutoShop] Auto-created profile: ${profileId}`);

    // Re-fetch the profile
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
  const expectedProfileId: string = profile.browser_use_profile_id;

  // Create session with profile - matching job-agent pattern exactly
  console.log(`[AutoShop] Creating session with profileId=${expectedProfileId}, startUrl=${loginUrl}`);
  
  const sessionRes = await fetch("https://api.browser-use.com/api/v2/sessions", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      profileId: expectedProfileId,
      startUrl: loginUrl,
      keepAlive: true,
      browserScreenWidth: 1280,
      browserScreenHeight: 800,
    }),
  });

  console.log(`[AutoShop] Session response status: ${sessionRes.status}`);

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    console.error(`[AutoShop] Session creation failed: ${err}`);
    throw new Error(`Failed to create session: ${err}`);
  }

  const sessionData = await sessionRes.json();
  console.log(`[AutoShop] Session response:`, JSON.stringify(sessionData));

  const sessionId = sessionData.id;
  if (!sessionId) {
    throw new Error("Browser Use session created but returned no session id");
  }

  const liveViewUrl = sessionData.liveUrl;

  // Update pending login
  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: site,
      shop_pending_task_id: null,
      shop_pending_session_id: sessionId,
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Login session started: id=${sessionId}, liveUrl=${liveViewUrl}`);

  return new Response(
    JSON.stringify({
      success: true,
      taskId: sessionId,
      sessionId,
      liveViewUrl,
      site,
      profileId: expectedProfileId,
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
  // Get profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) throw new Error("Profile not found");

  // Stop the session to save cookies - matching job-agent pattern (POST not PUT)
  const sessionId = profile.shop_pending_session_id;
  if (sessionId) {
    try {
      // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
      console.log(`[AutoShop] Stopping session ${sessionId} to save auth state to profile (PATCH)`);
      await fetch(`https://api.browser-use.com/api/v2/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      console.log(`[AutoShop] Session stopped, cookies saved to profile`);
    } catch (e) {
      console.error(`[AutoShop] Failed to stop session (cookies may not be saved):`, e);
    }
  }

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

// Cancel a pending login session and clean up
// deno-lint-ignore no-explicit-any
async function handleCancelLogin(
  supabase: any,
  userId: string,
  apiKey: string
) {
  // Get profile to find pending session
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

  // Stop the pending session if it exists
  const sessionId = profile.shop_pending_session_id;
  if (sessionId) {
    try {
      console.log(`[AutoShop] Stopping session: ${sessionId}`);
      // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
      await fetch(`https://api.browser-use.com/api/v2/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch (e) {
      console.error(`[AutoShop] Failed to stop session ${sessionId}:`, e);
    }
  }

  // Stop the pending task if it exists
  const taskId = profile.shop_pending_task_id;
  if (taskId) {
    try {
      console.log(`[AutoShop] Stopping task: ${taskId}`);
      // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
      await fetch(`https://api.browser-use.com/api/v2/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
    } catch (e) {
      console.error(`[AutoShop] Failed to stop task ${taskId}:`, e);
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

  console.log(`[AutoShop] Login cancelled for user ${userId}`);

  return new Response(
    JSON.stringify({ success: true, message: "Login session cancelled" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Clean up ALL stale sessions and tasks for a user
// deno-lint-ignore no-explicit-any
async function cleanupStaleSessions(
  supabase: any,
  userId: string,
  apiKey: string
): Promise<{ sessionsKilled: number; tasksKilled: number }> {
  console.log(`[AutoShop] Cleaning up stale sessions for user ${userId}`);

  let sessionsKilled = 0;
  let tasksKilled = 0;

  // Get the user's browser profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("browser_use_profile_id, shop_pending_session_id, shop_pending_task_id")
    .eq("user_id", userId)
    .single();

  if (!profile?.browser_use_profile_id) {
    return { sessionsKilled, tasksKilled };
  }

  // 1. Stop any pending session recorded in DB
  if (profile.shop_pending_session_id) {
    try {
      // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
      await fetch(`https://api.browser-use.com/api/v2/sessions/${profile.shop_pending_session_id}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      sessionsKilled++;
      console.log(`[AutoShop] Stopped pending session: ${profile.shop_pending_session_id}`);
    } catch (e) {
      console.error(`[AutoShop] Failed to stop session:`, e);
    }
  }

  // 2. Stop any pending task recorded in DB
  if (profile.shop_pending_task_id) {
    try {
      // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
      await fetch(`https://api.browser-use.com/api/v2/tasks/${profile.shop_pending_task_id}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      tasksKilled++;
      console.log(`[AutoShop] Stopped pending task: ${profile.shop_pending_task_id}`);
    } catch (e) {
      console.error(`[AutoShop] Failed to stop task:`, e);
    }
  }

  // 3. Try to list and stop any active sessions for this profile from the API
  try {
    // Browser Use v2 API: Session status is "active" or "stopped"
    const sessionsRes = await fetch("https://api.browser-use.com/api/v2/sessions?filterBy=active", {
      headers: { "X-Browser-Use-API-Key": apiKey },
    });
    
    if (!sessionsRes.ok) throw new Error(`Failed to list sessions: ${sessionsRes.status}`);
    const sessionsList = await sessionsRes.json();

    // Response has { items: [...], totalItems, pageNumber, pageSize }
    const sessions = sessionsList.items || [];
      
    for (const session of sessions as any[]) {
      // Session status in v2 API: "active" or "stopped"
      const sessionStatus = session.status;
      
      // Only kill sessions that are active
      if (sessionStatus === "active") {
        try {
          await fetch(`https://api.browser-use.com/api/v2/sessions/${session.id}`, {
            method: "PATCH",
            headers: {
              "X-Browser-Use-API-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "stop" }),
          });
          sessionsKilled++;
          console.log(`[AutoShop] Killed stale session: ${session.id}`);
        } catch {
          // Ignore individual session stop failures
        }
      }
    }
  } catch (e) {
    console.error(`[AutoShop] Failed to list sessions:`, e);
  }

  // 4. Also check for stale tasks (status = started or paused)
  try {
    // Browser Use v2 API: Task status is "started", "paused", "finished", "stopped"
    const tasksRes = await fetch("https://api.browser-use.com/api/v2/tasks?filterBy=started", {
      headers: { "X-Browser-Use-API-Key": apiKey },
    });
    
    if (!tasksRes.ok) throw new Error(`Failed to list tasks: ${tasksRes.status}`);
    const tasksList = await tasksRes.json();

    // Response has { items: [...], totalItems, pageNumber, pageSize }
    const tasks = tasksList.items || [];
      
    for (const task of tasks as any[]) {
      // Task status in v2 API: "started", "paused", "finished", "stopped"
      const taskStatus = task.status;
      
      // Stop tasks that are started or paused (active)
      if (BROWSER_USE_TASK_ACTIVE_STATUSES.includes(taskStatus)) {
        try {
          await fetch(`https://api.browser-use.com/api/v2/tasks/${task.id}`, {
            method: "PATCH",
            headers: {
              "X-Browser-Use-API-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "stop" }),
          });
          tasksKilled++;
          console.log(`[AutoShop] Killed stale task: ${task.id}`);
        } catch {
          // Ignore individual task stop failures
        }
      }
    }
  } catch (e) {
    console.error(`[AutoShop] Failed to list tasks:`, e);
  }

  // 5. Clear pending state in DB
  await supabase
    .from("browser_profiles")
    .update({
      shop_pending_login_site: null,
      shop_pending_task_id: null,
      shop_pending_session_id: null,
    })
    .eq("user_id", userId);

  console.log(`[AutoShop] Cleanup complete: ${sessionsKilled} sessions, ${tasksKilled} tasks stopped`);

  return { sessionsKilled, tasksKilled };
}

// Light cleanup - only stops the pending ORDER session tracked in DB
// Does NOT kill all active sessions (preserves login sessions)
// deno-lint-ignore no-explicit-any
async function cleanupPendingOrderSession(
  supabase: any,
  userId: string,
  apiKey: string
): Promise<void> {
  // Get the user's browser profile
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("shop_pending_session_id, shop_pending_task_id")
    .eq("user_id", userId)
    .single();

  if (!profile) return;

  // Only stop the specific pending session/task tracked in the DB
  // This preserves any login sessions that might be open
  if (profile.shop_pending_session_id) {
    try {
      await fetch(`https://api.browser-use.com/api/v2/sessions/${profile.shop_pending_session_id}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      console.log(`[AutoShop] Stopped pending order session: ${profile.shop_pending_session_id}`);
    } catch (e) {
      console.error(`[AutoShop] Failed to stop pending session:`, e);
    }
  }

  if (profile.shop_pending_task_id) {
    try {
      await fetch(`https://api.browser-use.com/api/v2/tasks/${profile.shop_pending_task_id}`, {
        method: "PATCH",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      console.log(`[AutoShop] Stopped pending order task: ${profile.shop_pending_task_id}`);
    } catch (e) {
      console.error(`[AutoShop] Failed to stop pending task:`, e);
    }
  }

  // Clear pending order state (but NOT pending login state)
  if (profile.shop_pending_session_id || profile.shop_pending_task_id) {
    await supabase
      .from("browser_profiles")
      .update({
        shop_pending_task_id: null,
        shop_pending_session_id: null,
      })
      .eq("user_id", userId);
  }
}

// Manual cleanup action handler
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
      message: `Cleaned up ${result.sessionsKilled} sessions and ${result.tasksKilled} tasks`,
      ...result,
    }),
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

  // Every user must run tasks with their own persistent profile attached
  if (!profileId) {
    throw new Error(
      "No browser profile attached for this user. Please go to Connections and create/attach a profile first."
    );
  }

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

  // ============================================
  // TWO-STEP PATTERN (same as job-agent):
  // 1. Create SESSION with profileId first
  // 2. Create TASK with sessionId
  // ============================================
  
  console.log(`[AutoShop] Creating session with profileId: ${profileId}`);
  
  // Build session payload
  const sessionPayload: Record<string, unknown> = {
    profileId: profileId,
    startUrl: "https://www.google.com/shopping",
    keepAlive: false, // Auto-close when task completes
    browserScreenWidth: 1280,
    browserScreenHeight: 800,
    proxyCountryCode: "us", // Always use US proxy
  };
  
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
    sessionPayload.proxy = proxyConfig;
    console.log(`[AutoShop] Custom proxy configured: ${profile.proxy_server}`);
  }
  
  // Step 1: Create session with profile attached
  const sessionResponse = await fetch("https://api.browser-use.com/api/v2/sessions", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sessionPayload),
  });
  
  if (!sessionResponse.ok) {
    const sessionError = await sessionResponse.text();
    console.error("[AutoShop] Session creation failed:", sessionResponse.status, sessionError);
    
    await supabase
      .from("auto_shop_orders")
      .update({ 
        status: "failed",
        error_message: `Session creation failed: ${sessionResponse.status}` 
      })
      .eq("id", orderId);
      
    throw new Error(`Failed to create session: ${sessionError}`);
  }
  
  const sessionData = await sessionResponse.json();
  const sessionId = sessionData.id;
  console.log(`[AutoShop] Session created: ${sessionId} with profileId: ${profileId}`);
  
  // Step 2: Create task within the session
  const taskPayload = {
    task: agentInstruction,
    sessionId: sessionId,
    maxSteps: 100,
  };
  
  console.log(`[AutoShop] Creating task in session: ${sessionId}`);
  
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
    
    // Check for insufficient credits error
    if (errorData.includes("credits") || errorData.includes("balance") || browserUseResponse.status === 402) {
      await supabase
        .from("auto_shop_orders")
        .update({ 
          status: "failed",
          error_message: "Browser Use API credits are insufficient" 
        })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Browser Use API credits are insufficient. Please add credits to your Browser Use account.",
          code: "INSUFFICIENT_CREDITS",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
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
  console.log("[AutoShop] Browser Use task submitted:", taskId);

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

  // IMPORTANT: Shuffle cards to randomize order - prevents predictable patterns
  const shuffledCards = shuffleArray(cards);
  console.log(`[AutoShop] Cards shuffled - order randomized for this order`);

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

=== STEP 0 - SET UP BROWSERSTACK LIVE PROXY (MANDATORY - DO THIS FIRST!) ===

🚨 CRITICAL REQUIREMENT: YOU CANNOT PROCEED WITHOUT BROWSERSTACK 🚨

Before doing ANYTHING else, you MUST set up a US-based browser session via BrowserStack Live.
If BrowserStack fails to open or connect for ANY reason, you MUST NOT continue shopping.

1. Navigate to https://live.browserstack.com/dashboard
2. Log in if prompted:
   - Enter the email address from your browser profile
   - Password: password!
   - Click Sign In
3. Once logged in, select a browser session - choose:
   - OS: Windows 11 or macOS (latest)
   - Browser: Chrome (latest version)
   - Location: USA - Texas (or nearest available US location like Dallas, Houston, Austin)
4. Wait for the remote browser session to fully load (up to 60 seconds max)
5. VERIFY you are connected by checking:
   - The BrowserStack session shows "Connected"
   - The browser window is responsive and shows a webpage
   - You can interact with the remote browser

=== BROWSERSTACK FAILURE PROTOCOL ===

IF BROWSERSTACK FAILS AT ANY POINT, FOLLOW THIS PROTOCOL:

🚨 ANTI-LOOP RULE: NEVER repeat the same failed action more than TWICE. If something fails twice, MOVE ON to a different approach. 🚨

FAILURE SCENARIOS AND RESPONSES:

1. **BrowserStack site won't load**:
   - First: Wait 15 seconds, refresh
   - If fails again: Try loading a different BrowserStack URL (live.browserstack.com/dashboard OR app.browserstack.com)
   - If both fail: Try a different browser instance (Chrome ↔ Firefox), or different OS (Windows ↔ macOS)
   - If ALL attempts fail: ABANDON the task and report failure - do NOT proceed without BrowserStack

2. **Login fails**:
   - First: Clear any pre-filled fields, re-enter credentials carefully
   - If fails again: Try the "Forgot Password" flow if email access available
   - If still fails: Try a different browser instance or restart the session
   - If ALL attempts fail: ABANDON and report the login issue

3. **No US sessions available**:
   - Try locations in this order: Texas → California → New York → Any US state
   - If NO US locations available: Try Canada or UK as fallback (some sites accept these)
   - If ALL unavailable: ABANDON the task - do NOT proceed without a valid session
   - Do NOT wait or loop - immediately move to next option or abandon

4. **Session starts but disconnects mid-use**:
   - First: Wait 10 seconds, try to reconnect
   - If fails: Try starting a FRESH session (new browser instance, different location)
   - If fresh session also fails: ABANDON the task and report failure
   - If you were mid-checkout when disconnect happened: DO NOT retry that site (cart may be corrupted) - try a different retailer with a fresh session

5. **Session is extremely slow/unresponsive** (>20 sec per action):
   - First: Try switching to a different US location (different server might be faster)
   - If still slow: End this session, start new session with different browser (Firefox instead of Chrome)
   - If new session also slow: Try a different retailer website
   - If ALL websites are slow: ABANDON and report BrowserStack performance issue

6. **Session crashes or freezes**:
   - Do NOT try to recover the crashed session
   - Immediately start a FRESH session (new browser instance)
   - If fresh session also crashes: Try different OS (Windows ↔ macOS), different location
   - If still failing: ABANDON and report infrastructure issue
   - If you were mid-purchase: Check email for confirmation before assuming failure

7. **BrowserStack shows CAPTCHA or unusual security check**:
   - First: Complete the CAPTCHA carefully
   - If CAPTCHA loops (keeps showing new ones): BrowserStack flagged you as bot - try different browser instance
   - If new instance also CAPTCHA'd: Try different OS, different location
   - If still CAPTCHA'd: ABANDON and report the issue

8. **Remote browser inside BrowserStack is unresponsive**:
   - The BrowserStack interface loads but the browser window inside doesn't work
   - First: Try clicking "Restart Session" or "New Session"
   - If still broken: End session, start completely new session with different OS (Windows ↔ macOS)
   - If still fails: ABANDON and report the issue

=== KEY PRINCIPLE: DON'T GET STUCK, BUT NEVER BYPASS BROWSERSTACK ===

- If ANY action fails twice → IMMEDIATELY try a different approach (different browser/location/website)
- If a website blocks you → Move to next website (there are many options)
- NEVER loop on the same failed action hoping it will work
- ALWAYS try alternatives: Browser instance fails → Different instance | Site A fails → Site B | Card 1 fails → Card 2
- If ALL alternatives exhausted → ABANDON and report failure
- **NEVER** shop directly without BrowserStack - if BrowserStack completely fails, abandon the task

IMPORTANT: All shopping activity MUST happen INSIDE the BrowserStack Live session. 
This gives you a US-based IP address that won't get blocked by retailers.
There is NO exception - if BrowserStack fails completely, the task must be abandoned.

If Texas is not available, try these US locations in order:
- Dallas, TX
- Houston, TX  
- Austin, TX
- Any other Texas location
- Los Angeles, CA
- New York, NY
- Chicago, IL

If NONE of the above work, STOP and report failure.

=== END BROWSERSTACK SETUP ===

STEP 1 - SEARCH FOR DEALS (Inside BrowserStack session):
1. Start at Google Shopping and search for "${productQuery}"
2. Look at multiple results - compare prices across different sites
3. Find the BEST DEAL (lowest price with good seller rating) from any reputable e-commerce site
4. PRIORITIZE sites you're already logged into${sitesLoggedIn.length > 0 ? `: ${sitesLoggedIn.join(", ")}` : ""}

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
⚠️ IMPORTANT: Cards have been RANDOMLY SHUFFLED for this order - use them in the order shown above.
1. Try CARD 1 first (this is a randomly selected card, not always the same)
2. If CARD 1 is declined, try CARD 2
3. Continue through all available cards before giving up on a site
4. If all cards fail on this site, ABANDON this site and try the NEXT BEST DEAL on a DIFFERENT site
5. Repeat until order is successful or all options exhausted

STEP 6 - COMPLETE ORDER:
1. Review the order
2. Place the order
3. Take screenshot of confirmation page
4. Report: "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]"

=== ADAPTIVE FAILURE RECOVERY ===

CRITICAL: Learn from EVERY failure and adapt your strategy. Keep a mental log of what failed and WHY.

FAILURE CAUSE ANALYSIS:
When something fails, DIAGNOSE the root cause before taking action:

1. CARD DECLINED:
   - If "insufficient funds" → Try next card immediately
   - If "card not supported" → This site may not accept this card type, try different site
   - If "security block" → The site flagged the transaction, abandon this site entirely
   - If "expired card" → Skip this card for all future attempts
   - If "billing address mismatch" → Double-check address entered correctly, retry once, then try next card

2. CHECKOUT BLOCKED:
   - If "bot detection" / CAPTCHA loop → Slow down, wait 5 seconds, try once more. If still blocked, this site is hostile - abandon and try completely different retailer
   - If "login required" and can't create account → Try guest checkout. If no guest option, abandon site
   - If "region restricted" → This site won't work, immediately try next site
   - If "session expired" → Refresh page, re-add to cart, continue

3. PRODUCT ISSUES:
   - If "out of stock" → Don't waste time, immediately search for next best deal
   - If "price increased significantly" → Abandon if over max price, otherwise note it and continue
   - If "item unavailable for shipping" → Try a different seller/listing on same site first, then try different site
   - If "minimum order required" → Check if quantity adjustment helps, otherwise abandon

4. SITE ISSUES:
   - If "site loading slowly" → Wait up to 30 seconds, then abandon if unresponsive
   - If "payment page broken" → Try refreshing once, then abandon site
   - If "endless redirects" → Site is broken, abandon immediately
   - If "requires phone verification via SMS" → This is a BLOCKER, abandon and try different site

5. ACCOUNT CREATION ISSUES:
   - If "email already registered" → Try password recovery? No - abandon and try guest checkout or different site
   - If "phone number required" → Try to skip, if mandatory abandon site
   - If "verification email not arriving" → Wait 2 minutes, check spam, if nothing then abandon

=== STRATEGIC MANEUVERING ===

SITE ROTATION STRATEGY:
- If a site fails for ANY reason, remember WHY it failed
- Don't retry the same site for the same reason
- Prioritize sites with simpler checkouts (fewer steps = fewer failure points)
- If 2+ sites fail with card issues, consider that cards might have fraud blocks - report this

RECOVERY PRIORITY:
1. First, try to fix the immediate issue (re-enter info, solve CAPTCHA)
2. If fix doesn't work after ONE retry, escalate to next option (next card, different listing)
3. If escalation fails, abandon current approach entirely (different site)
4. Track failed sites/approaches to avoid repeating mistakes

SMART RETRIES:
- Never retry the exact same action more than ONCE
- If same error twice, it's a pattern - change approach
- Wait 3-5 seconds between retries to avoid rate limiting
- Clear cart before abandoning a site (some sites track abandoned carts)

=== FINAL STATUS REPORTING ===

NEVER STOP. NEVER ASK FOR HELP. COMPLETE THE PURCHASE OR EXHAUST ALL OPTIONS.

Report final status with DETAILED context:
- "SUCCESS: Order placed at [site] for $[price]. Confirmation: [number]. Shipping estimate: [date if shown]"
- "FAILED: Could not complete purchase. Sites tried: [list]. Failure reasons: [specific causes]. Recommendation: [what user should check/fix]"
- "BLOCKED: [specific blocker]. Sites attempted: [list]. Suggestion: [e.g., 'cards may have fraud protection enabled' or 'product may be region-restricted']"`;
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

// Sync order-related emails from Gmail
// deno-lint-ignore no-explicit-any
async function handleSyncOrderEmails(
  supabase: any,
  userId: string,
  apiKey: string
) {
  // Get browser profile to check if gmail is logged in
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  const profileId = profile?.browser_use_profile_id;
  const sitesLoggedIn: string[] = Array.isArray(profile?.shop_sites_logged_in) 
    ? profile.shop_sites_logged_in 
    : [];

  if (!profileId) {
    throw new Error("No browser profile found. Create a profile first.");
  }

  if (!sitesLoggedIn.includes("gmail")) {
    throw new Error("Gmail not logged in. Please log into Gmail first via Connections.");
  }

  console.log(`[AutoShop] Syncing order emails for user ${userId}`);

  // Get existing email message IDs to avoid duplicates
  const { data: existingEmails } = await supabase
    .from("order_emails")
    .select("gmail_message_id")
    .eq("user_id", userId);

  const existingIds = new Set((existingEmails || []).map((e: { gmail_message_id: string }) => e.gmail_message_id));

  // Create a Browser Use task to search Gmail for order-related emails
  const searchInstruction = `GMAIL ORDER EMAIL EXTRACTION TASK

You are logged into Gmail. Your task is to find and extract all shopping/order related emails.

STEP 1 - NAVIGATE TO GMAIL:
Go to https://mail.google.com

STEP 2 - SEARCH FOR ORDER EMAILS:
Use the Gmail search bar to search for:
"order confirmation OR shipping OR tracking OR delivery OR purchase OR receipt OR invoice"

Also search for emails from common shopping sites:
"from:amazon OR from:ebay OR from:walmart OR from:target OR from:bestbuy OR from:newegg OR from:etsy OR from:aliexpress OR from:shopify"

STEP 3 - EXTRACT EMAIL DATA:
For EACH email you find (up to the 20 most recent), extract:
1. Subject line
2. From email address
3. From name
4. Snippet (first ~100 chars of body)
5. Date received
6. A unique message ID (can be from URL or generate one)
7. Email type: "confirmation" | "shipping" | "tracking" | "receipt" | "promotion" | "other"

If possible, also extract from the email body:
- Order number/confirmation number
- Tracking number
- Estimated delivery date
- Order total amount

STEP 4 - RETURN RESULTS:
Return ALL extracted emails as a JSON array in this exact format:
[
  {
    "messageId": "unique_id",
    "threadId": "thread_id_if_available",
    "subject": "Your order has shipped!",
    "fromEmail": "ship-confirm@amazon.com",
    "fromName": "Amazon",
    "snippet": "Your package is on the way...",
    "receivedAt": "2024-01-15T10:30:00Z",
    "emailType": "shipping",
    "extractedData": {
      "orderNumber": "123-4567890",
      "trackingNumber": "1Z999AA10123456784",
      "carrier": "UPS",
      "estimatedDelivery": "2024-01-18"
    }
  }
]

IMPORTANT:
- Return ONLY the JSON array, no other text
- Include ALL order-related emails you find (max 20)
- If you can't access Gmail or find no emails, return: []
- Do NOT click on or open individual emails - just read from the inbox list view
- Scroll down to load more emails if needed`;

  // ============================================
  // TWO-STEP PATTERN (same as job-agent):
  // 1. Create SESSION with profileId first
  // 2. Create TASK with sessionId
  // ============================================
  
  console.log(`[AutoShop] Creating email sync session with profileId: ${profileId}`);
  
  // Build session payload
  const sessionPayload: Record<string, unknown> = {
    profileId: profileId,
    startUrl: "https://mail.google.com",
    keepAlive: false, // Auto-close when task completes
    browserScreenWidth: 1280,
    browserScreenHeight: 800,
    proxyCountryCode: "us", // Always use US proxy
  };

  if (profile?.proxy_server) {
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
    sessionPayload.proxy = proxyConfig;
  }

  // Step 1: Create session with profile attached
  const sessionRes = await fetch("https://api.browser-use.com/api/v2/sessions", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sessionPayload),
  });

  if (!sessionRes.ok) {
    const sessionError = await sessionRes.text();
    console.error("[AutoShop] Email sync session creation failed:", sessionRes.status, sessionError);
    throw new Error(`Failed to create email sync session: ${sessionError}`);
  }

  const sessionData = await sessionRes.json();
  const syncSessionId = sessionData.id;
  console.log(`[AutoShop] Email sync session created: ${syncSessionId}`);

  // Step 2: Create task within the session
  const taskPayload = {
    task: searchInstruction,
    sessionId: syncSessionId,
    maxSteps: 50,
  };

  const taskRes = await fetch("https://api.browser-use.com/api/v2/tasks", {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskPayload),
  });

  if (!taskRes.ok) {
    const errorText = await taskRes.text();
    throw new Error(`Failed to start email sync task: ${errorText}`);
  }

  const taskData = await taskRes.json();
  const taskId = taskData.id || taskData.task_id;
  console.log(`[AutoShop] Email sync task started: ${taskId}`);

  // Poll for completion (max 3 minutes)
  let attempts = 0;
  const maxAttempts = 90; // 90 * 2 seconds = 3 minutes
  let taskStatus = "pending";
  let taskOutput = "";

  // Browser Use v2 API: task completes when status is "finished" or "stopped"
  while (attempts < maxAttempts && !["finished", "stopped"].includes(taskStatus)) {
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

  console.log(`[AutoShop] Email sync task ${taskId} finished with status: ${taskStatus}`);

  if (taskStatus !== "finished") {
    // Log partial status but don't fail
    await supabase.from("agent_logs").insert({
      user_id: userId,
      agent_name: "auto_shop",
      log_level: "warn",
      message: `Email sync task incomplete: ${taskStatus}`,
      metadata: { taskId, attempts },
    });

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Email sync did not complete: ${taskStatus}`,
        taskId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse the output JSON
  let emails: Array<{
    messageId: string;
    threadId?: string;
    subject: string;
    fromEmail: string;
    fromName?: string;
    toEmail?: string;
    snippet?: string;
    bodyText?: string;
    bodyHtml?: string;
    receivedAt: string;
    emailType?: string;
    extractedData?: Record<string, unknown>;
  }> = [];

  try {
    // Try to extract JSON array from output
    const jsonMatch = taskOutput.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      emails = JSON.parse(jsonMatch[0]);
    }
  } catch (parseError) {
    console.error("[AutoShop] Failed to parse email output:", parseError);
    console.log("[AutoShop] Raw output:", taskOutput.substring(0, 500));
  }

  // Get user's orders to try matching emails
  const { data: orders } = await supabase
    .from("auto_shop_orders")
    .select("id, product_query, selected_deal_site, order_confirmation")
    .eq("user_id", userId);

  // Insert new emails
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

    // Also try fuzzy matching by site name in subject/from
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

    // Insert the email
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
        body_text: email.bodyText || null,
        body_html: email.bodyHtml || null,
        received_at: email.receivedAt || new Date().toISOString(),
        email_type: email.emailType || "other",
        extracted_data: email.extractedData || {},
      });

    if (insertError) {
      console.error(`[AutoShop] Failed to insert email:`, insertError);
    } else {
      inserted++;
      existingIds.add(email.messageId);

      // If we extracted tracking info, also update order_tracking table
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

  // Log the sync
  await supabase.from("agent_logs").insert({
    user_id: userId,
    agent_name: "auto_shop",
    log_level: "info",
    message: `Email sync complete: ${inserted} new, ${skipped} skipped`,
    metadata: { taskId, inserted, skipped, totalFound: emails.length },
  });

  console.log(`[AutoShop] Email sync: ${inserted} inserted, ${skipped} skipped`);

  return new Response(
    JSON.stringify({ 
      success: true, 
      inserted,
      skipped,
      totalFound: emails.length,
      taskId,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Update order from Browser Use task data
// deno-lint-ignore no-explicit-any
async function updateOrderFromTask(supabase: any, order: any, taskData: any) {
  // Browser Use v2 API Task status: "started", "paused", "finished", "stopped"
  const taskStatus = taskData.status;
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
  } else if (taskStatus === "stopped") {
    // In v2 API, "stopped" means manually stopped - treat as failed
    newStatus = "failed";
    errorMessage = taskData.error || "Task failed or was stopped";
  } else if (taskStatus === "started" || taskStatus === "paused") {
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

// Helper to look up IP geolocation
async function getIpGeolocation(ip: string): Promise<{ country: string; city: string; region: string } | null> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      country: data.country || "Unknown",
      city: data.city || "Unknown",
      region: data.region || "Unknown",
    };
  } catch {
    return null;
  }
}

// Test proxy by making a simple request through Browser Use API
async function fetchIpWithBrowserUse(
  apiKey: string,
  proxyCountryCode?: string // e.g., 'gb' for UK, 'us' for US - for built-in proxy
): Promise<{ ip: string | null; status: string; error?: string; geo?: { country: string; city: string; region: string } | null }> {
  try {
    // Use Browser Use Cloud API with built-in proxy
    const taskPayload: Record<string, unknown> = {
      task: "Navigate to https://httpbin.org/ip and extract the IP address shown on the page. Return ONLY the IP address, nothing else.",
      startUrl: "https://httpbin.org/ip",
      llm: "browser-use-llm",
      maxSteps: 5,
    };

    // If proxy country is specified, use Browser Use's built-in proxy
    if (proxyCountryCode) {
      taskPayload.proxyCountryCode = proxyCountryCode;
      console.log(`[AutoShop] Using built-in proxy for country: ${proxyCountryCode}`);
    } else {
      console.log("[AutoShop] Creating task WITHOUT proxy");
    }

    console.log(`[AutoShop] Task payload:`, JSON.stringify(taskPayload, null, 2));
    
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
      console.log(`[AutoShop] Task creation failed: ${errorText}`);
      return { ip: null, status: "failed", error: errorText };
    }

    const result = await response.json();
    const taskId = result.id || result.task_id;
    console.log(`[AutoShop] Task created: ${taskId}`);

    // Poll for result (max 60 seconds)
    let attempts = 0;
    const maxAttempts = 30;
    let taskStatus = "pending";
    let taskOutput = "";

    // Browser Use v2 API: task completes when status is "finished" or "stopped"
    while (attempts < maxAttempts && taskStatus !== "finished" && taskStatus !== "stopped") {
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

    console.log(`[AutoShop] Task ${taskId} finished with status: ${taskStatus}, output: ${taskOutput}`);
    
    const ipMatch = taskOutput.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const ip = ipMatch ? ipMatch[1] : null;
    
    // Look up geolocation for the IP
    let geo = null;
    if (ip) {
      geo = await getIpGeolocation(ip);
      console.log(`[AutoShop] IP ${ip} geolocation: ${geo?.city}, ${geo?.region}, ${geo?.country}`);
    }
    
    return { 
      ip, 
      status: taskStatus,
      geo 
    };
  } catch (error) {
    console.log(`[AutoShop] Task error:`, error);
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

  console.log(`[AutoShop] Testing proxy config from profile...`);
  console.log(`[AutoShop] Proxy server: ${profile.proxy_server}`);
  console.log(`[AutoShop] Proxy username: ${profile.proxy_username}`);

  // Extract country code from proxy username if available
  let proxyCountryCode = "gb"; // Default to UK
  if (profile.proxy_username) {
    const usernameMatch = profile.proxy_username.match(/-([a-z]{2})$/i);
    if (usernameMatch) {
      proxyCountryCode = usernameMatch[1].toLowerCase();
      console.log(`[AutoShop] Extracted country code from username: ${proxyCountryCode}`);
    }
  }

  // 3-STEP VERIFICATION: baseline1 → proxy → baseline2
  console.log("[AutoShop] Running 3-step IP verification...");
  
  // Step 1: Baseline (no proxy)
  console.log("[AutoShop] Step 1: Fetching baseline IP (no proxy)...");
  const baseline1Result = await fetchIpWithBrowserUse(apiKey);
  console.log(`[AutoShop] Baseline 1 IP: ${baseline1Result.ip}`);

  // Step 2: With proxy (built-in)
  console.log(`[AutoShop] Step 2: Fetching IP with ${proxyCountryCode.toUpperCase()} built-in proxy...`);
  const proxyResult = await fetchIpWithBrowserUse(apiKey, proxyCountryCode);
  console.log(`[AutoShop] Proxy IP: ${proxyResult.ip}`);

  // Step 3: Baseline again (no proxy) - confirms we can switch back
  console.log("[AutoShop] Step 3: Fetching baseline IP again (no proxy)...");
  const baseline2Result = await fetchIpWithBrowserUse(apiKey);
  console.log(`[AutoShop] Baseline 2 IP: ${baseline2Result.ip}`);

  // Analyze results
  const proxyWorking = 
    proxyResult.status === "finished" && 
    proxyResult.ip !== null &&
    baseline1Result.ip !== null &&
    proxyResult.ip !== baseline1Result.ip;

  const baselineConsistent = 
    baseline1Result.ip !== null &&
    baseline2Result.ip !== null &&
    baseline1Result.ip === baseline2Result.ip;

  const allTestsPassed = proxyWorking && baselineConsistent;

  console.log(`[AutoShop] Test results: proxyWorking=${proxyWorking}, baselineConsistent=${baselineConsistent}`);

  return new Response(
    JSON.stringify({ 
      success: true, 
      tested: true,
      proxyWorking,
      baselineConsistent,
      allTestsPassed,
      baseline1Ip: baseline1Result.ip,
      baseline1Geo: baseline1Result.geo,
      proxyIp: proxyResult.ip,
      proxyGeo: proxyResult.geo,
      baseline2Ip: baseline2Result.ip,
      baseline2Geo: baseline2Result.geo,
      baseline1Status: baseline1Result.status,
      proxyStatus: proxyResult.status,
      baseline2Status: baseline2Result.status,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
