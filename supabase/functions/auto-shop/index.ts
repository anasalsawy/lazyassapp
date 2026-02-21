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

// Skyvern API configuration
const SKYVERN_API_BASE = "https://api.skyvern.com/v1";
// Skyvern run statuses: created, queued, running, completed, failed, terminated, timed_out, canceled
const SKYVERN_ACTIVE_STATUSES = ["created", "queued", "running"];
const SKYVERN_TERMINAL_STATUSES = ["completed", "failed", "terminated", "timed_out", "canceled"];

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
    const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!BROWSER_USE_API_KEY) {
      throw new Error("BROWSER_USE_API_KEY is not configured");
    }
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

    // Handle different actions
    switch (action) {
      case "get_status": {
        return await handleGetStatus(supabase, user.id);
      }
      case "create_profile": {
        return await handleCreateProfile(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "start_login": {
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
        await cleanupStaleSessions(supabase, user.id, BROWSER_USE_API_KEY);
        return await handleStartLogin(supabase, user.id, payload.site || "gmail", BROWSER_USE_API_KEY);
      }
      case "cleanup_sessions": {
        return await handleCleanupSessions(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "start_order": {
        return await handleStartOrder(supabase, user, payload, BROWSER_USE_API_KEY, SKYVERN_API_KEY, supabaseUrl);
      }
      case "check_order_status": {
        return await handleCheckOrderStatus(supabase, user.id, payload.orderId!, SKYVERN_API_KEY);
      }
      case "sync_all_orders": {
        return await handleSyncAllOrders(supabase, user, SKYVERN_API_KEY, supabaseUrl, BROWSER_USE_API_KEY);
      }
      case "sync_order_emails": {
        return await handleSyncOrderEmails(supabase, user.id, BROWSER_USE_API_KEY);
      }
      case "set_proxy": {
        return await handleSetProxy(supabase, user.id, payload);
      }
      case "test_proxy": {
        return await handleTestProxy(supabase, user.id, BROWSER_USE_API_KEY);
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
        useBrowserstack: profile.use_browserstack ?? false,
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

// Toggle BrowserStack setting
// deno-lint-ignore no-explicit-any
async function handleToggleBrowserstack(
  supabase: any,
  userId: string,
  useBrowserstack: boolean
) {
  const { error } = await supabase
    .from("browser_profiles")
    .update({ use_browserstack: useBrowserstack })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update BrowserStack setting: ${error.message}`);
  }

  console.log(`[AutoShop] BrowserStack ${useBrowserstack ? "enabled" : "disabled"} for user ${userId}`);

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
  browserUseApiKey: string,
  skyvernApiKey: string,
  supabaseUrl: string
) {
  const { orderId, productQuery, maxPrice, quantity, shippingAddress, paymentCards } = payload;

  if (!orderId || !productQuery || !shippingAddress || !paymentCards?.length) {
    throw new Error("Missing required order data");
  }

  // ============================================
  // CONCURRENT ORDER LIMIT: Max 6 orders at a time
  // ============================================
  const MAX_CONCURRENT_ORDERS = 6;
  
  const { data: runningOrders, error: countError } = await supabase
    .from("auto_shop_orders")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["pending", "searching", "found_deal", "checkout"]);
  
  if (countError) {
    console.error(`[AutoShop] Failed to count running orders:`, countError);
  } else if (runningOrders && runningOrders.length >= MAX_CONCURRENT_ORDERS) {
    throw new Error(`Maximum ${MAX_CONCURRENT_ORDERS} orders can run simultaneously. Please wait for some orders to complete.`);
  }
  
  console.log(`[AutoShop] Running orders: ${runningOrders?.length || 0}/${MAX_CONCURRENT_ORDERS}`);

  // Get browser profile for sites logged in info
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const sitesLoggedIn: string[] = Array.isArray(profile?.shop_sites_logged_in) 
    ? profile.shop_sites_logged_in 
    : [];
  const userEmail = user.email || "";

  // Fetch site credentials for authenticated shopping
  const { data: siteCredentials } = await supabase
    .from("site_credentials")
    .select("site_domain, email_used, password_enc")
    .eq("user_id", user.id);

  // Decrypt site credentials
  const decryptedCreds: { site: string; email: string; password: string }[] = [];
  const encKey = "SHOP_PROXY_KEY_2024";
  if (siteCredentials && siteCredentials.length > 0) {
    for (const cred of siteCredentials) {
      try {
        const decoded = atob(cred.password_enc);
        let decrypted = "";
        for (let i = 0; i < decoded.length; i++) {
          decrypted += String.fromCharCode(
            decoded.charCodeAt(i) ^ encKey.charCodeAt(i % encKey.length)
          );
        }
        decryptedCreds.push({
          site: cred.site_domain,
          email: cred.email_used,
          password: decrypted,
        });
      } catch (e) {
        console.error(`[AutoShop] Failed to decrypt credentials for ${cred.site_domain}:`, e);
      }
    }
  }

  console.log(`[AutoShop] Starting order via Skyvern: "${productQuery}"`);
  console.log(`[AutoShop] Email: ${userEmail}, Sites logged in: ${sitesLoggedIn.join(", ") || "none"}, Credentials available: ${decryptedCreds.map(c => c.site).join(", ") || "none"}`);

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
    message: `Starting product search via Skyvern: "${productQuery}"`,
    metadata: { orderId, productQuery, maxPrice, quantity, userEmail },
  });

  // Build the Skyvern prompt
  const agentPrompt = buildShoppingAgentInstruction(
    productQuery,
    maxPrice,
    quantity || 1,
    shippingAddress,
    paymentCards,
    userEmail,
    sitesLoggedIn,
    supabaseUrl,
    profile?.use_browserstack ?? false,
    decryptedCreds
  );

  // ============================================
  // SKYVERN API: Single POST to /v1/run/tasks
  // No need to create session first - Skyvern manages browser lifecycle
  // ============================================
  
  const skyvernPayload: Record<string, unknown> = {
    prompt: agentPrompt,
    url: "https://www.google.com/shopping",
    proxy_location: "RESIDENTIAL",
    max_steps_override: 100,
  };

  // Add max price as navigation payload for Skyvern's context
  if (maxPrice) {
    skyvernPayload.navigation_payload = {
      max_price: maxPrice,
      product_query: productQuery,
      quantity: quantity || 1,
    };
  }

  console.log(`[AutoShop] Submitting task to Skyvern API`);
  
  const skyvernResponse = await fetch(`${SKYVERN_API_BASE}/run/tasks`, {
    method: "POST",
    headers: {
      "x-api-key": skyvernApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(skyvernPayload),
  });

  if (!skyvernResponse.ok) {
    const errorData = await skyvernResponse.text();
    console.error("[AutoShop] Skyvern API error:", skyvernResponse.status, errorData);
    
    await supabase
      .from("auto_shop_orders")
      .update({ 
        status: "failed",
        error_message: `Skyvern API error: ${skyvernResponse.status}` 
      })
      .eq("id", orderId);

    throw new Error(`Skyvern task creation failed: ${skyvernResponse.status} - ${errorData}`);
  }

  const skyvernResult = await skyvernResponse.json();
  // Skyvern returns run_id
  const runId = skyvernResult.run_id || skyvernResult.id;
  console.log("[AutoShop] Skyvern task submitted:", runId);

  // Update order with Skyvern run ID (stored in browser_use_task_id field for compatibility)
  await supabase
    .from("auto_shop_orders")
    .update({ 
      browser_use_task_id: runId,
      status: "searching",
    })
    .eq("id", orderId);

  // Log success
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
      message: "Shopping agent is searching for deals via Skyvern",
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
  sitesLoggedIn: string[],
  supabaseUrl: string,
  useBrowserstack: boolean = false,
  siteCredentials: { site: string; email: string; password: string }[] = []
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

  // Build site credentials section for Skyvern to log in during checkout
  const credentialInstructions = siteCredentials.length > 0
    ? `
=== SITE LOGIN CREDENTIALS ===
You have saved login credentials for the following sites. USE THESE TO LOG IN when shopping on these sites — do NOT use guest checkout if you have credentials for the site.

${siteCredentials.map((cred, i) => `SITE ${i + 1}: ${cred.site}
- Email: ${cred.email}
- Password: ${cred.password}
`).join("\n")}

LOGIN STRATEGY:
1. When you reach a shopping site, check if you have credentials above for that domain
2. If yes, LOG IN with those credentials before adding to cart
3. If login fails (wrong password, account locked), fall back to guest checkout
4. If no credentials for this site, use guest checkout with email: ${userEmail}

=== END SITE CREDENTIALS ===
`
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

  // BrowserStack instructions - only include if enabled
  const browserstackInstructions = useBrowserstack ? `
=== STEP 0 - SET UP BROWSERSTACK LIVE PROXY (MANDATORY - DO THIS FIRST!) ===

🚨 CRITICAL REQUIREMENT: START WITH BROWSERSTACK, FALLBACK TO DIRECT BROWSER IF NEEDED 🚨

Before doing ANYTHING else, ATTEMPT to set up a US-based browser session via BrowserStack Live.
If BrowserStack fails after exhausting all options, you MAY proceed with DIRECT BROWSER shopping.

1. Navigate to https://live.browserstack.com/dashboard
2. Log in if prompted:
   - Enter the email address from your browser profile
   - Password: password!
   - Click Sign In
3. Once logged in, select a browser session following the BROWSER SELECTION RULE below
4. Wait for the remote browser session to fully load (up to 60 seconds max)
5. VERIFY you are connected by checking:
   - The BrowserStack session shows "Connected"
   - The browser window is responsive and shows a webpage
   - You can interact with the remote browser

=== BROWSER SELECTION RULE (MANDATORY) ===

When choosing a BrowserStack Live session:

🚫 DO NOT use Google Chrome on any OS - this is FORBIDDEN!
🚫 AVOID all Chromium-based browsers if possible

ALLOWED / PREFERRED OPTIONS (IN ORDER):
1) ✅ Firefox (latest) on Windows 11  ← STRONGLY PREFERRED
2) ✅ Firefox (latest) on macOS
3) ⚠️ Microsoft Edge (latest) ONLY if Firefox is unavailable

FORBIDDEN OPTIONS (DO NOT SELECT THESE):
❌ Google Chrome (any version, any OS)
❌ Chrome Beta / Dev
❌ Any browser that triggers Google Lens, Visual Search, or screen overlays

LOCATION SELECTION:
- Location: USA - Texas (or nearest available US location like Dallas, Houston, Austin)
- If Texas unavailable: California, then New York

RATIONALE:
Chrome triggers persistent Google Lens/Search overlays and browser-level permission popups
that cannot be reliably dismissed in a remote streamed browser environment.
Firefox provides a clean, overlay-free experience for automated shopping.

POPUP HANDLING IN FIREFOX/EDGE:
- Cookie / site consent modals → click "Accept" or "Close" or the X button
- Browser permission prompts (notifications, location) → press TAB until "Block" or "Don't Allow" is focused, then press ENTER
- Newsletter popups → click X or "No thanks"
- Do NOT abandon sessions for normal site popups - handle them and continue

=== BROWSERSTACK FAILURE PROTOCOL ===

IF BROWSERSTACK FAILS AT ANY POINT, FOLLOW THIS PROTOCOL TO RECOVER OR FALLBACK:

🚨 ANTI-LOOP RULE: NEVER repeat the same failed action more than TWICE. If something fails twice, MOVE ON to a different approach. 🚨

If BrowserStack fails completely after trying 2+ configurations, PROCEED TO DIRECT BROWSER mode.

=== END BROWSERSTACK SETUP ===

` : `
=== DIRECT BROWSER MODE (BROWSERSTACK DISABLED) ===

BrowserStack is DISABLED for this order. You will shop DIRECTLY using the current browser.
The browser is configured with a US proxy for regional compatibility.

PROCEED DIRECTLY to shopping sites - do NOT attempt to use BrowserStack.

=== END BROWSER MODE ===

`;

  return `Find a good deal on "${productQuery}" (quantity: ${quantity}) and purchase it.${priceConstraint}
${loggedInSites}
${credentialInstructions}
${emailInstructions}
SHIPPING ADDRESS:
${shipping.full_name}
${shipping.address_line1 || shipping.full_name}
${shipping.address_line2 ? shipping.address_line2 + "\n" : ""}${shipping.city || "Houston"}, ${shipping.state || "TX"} ${shipping.zip_code || "77051"}, ${shipping.country || "US"}
Phone: ${shipping.phone && /\d{7,}/.test(shipping.phone.replace(/\D/g, '')) ? shipping.phone : "8325551234"}

PAYMENT CARDS (try in order, move to next if declined):
${cardInstructions}

If a card is declined try the next one. If all fail on a site, try a different site. Guest checkout with ${userEmail} if no saved credentials. Report result as: "SUCCESS: [site] $[price] Confirmation: [number]" or "FAILED: [reasons]"`;
}

// Check order status from Skyvern API
// deno-lint-ignore no-explicit-any
async function handleCheckOrderStatus(
  supabase: any,
  userId: string,
  orderId: string,
  skyvernApiKey: string
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

  // Check Skyvern run status
  const runId = order.browser_use_task_id;
  const taskRes = await fetch(`${SKYVERN_API_BASE}/runs/${runId}`, {
    headers: { "x-api-key": skyvernApiKey },
  });

  if (!taskRes.ok) {
    console.error("[AutoShop] Failed to fetch Skyvern run status:", await taskRes.text());
    return new Response(
      JSON.stringify({ success: true, order, taskStatus: "unknown" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const taskData = await taskRes.json();
  console.log(`[AutoShop] Skyvern run ${runId} status:`, taskData.status);

  // Parse result and update order status
  const updatedOrder = await updateOrderFromSkyvernRun(supabase, order, taskData);

  return new Response(
    JSON.stringify({ 
      success: true, 
      order: updatedOrder,
      taskStatus: taskData.status,
      taskOutput: taskData.output,
      recordingUrl: taskData.recording_url || null,
      stepsInfo: taskData.steps_info || null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Analyze failure and produce a diagnosis + workaround for retry
function analyzeFailure(errorMessage: string, order: Record<string, unknown>): { diagnosis: string; workaround: string; canRetry: boolean } {
  const err = (errorMessage || "").toLowerCase();

  if (err.includes("max number of") && err.includes("steps")) {
    return {
      diagnosis: "Agent ran out of steps before completing the purchase. It may have been stuck in a loop (e.g., phone field blocker, CAPTCHA, or repeated site abandonment).",
      workaround: "Increasing max_steps to 100 and adding explicit instructions to skip problematic sites and use guest checkout more aggressively.",
      canRetry: true,
    };
  }
  if (err.includes("phone number") || err.includes("mandatory phone")) {
    return {
      diagnosis: "Agent abandoned checkout because a phone number was required and treated as a blocker.",
      workaround: "Providing a default phone number and instructing agent that phone fields are normal checkout fields.",
      canRetry: true,
    };
  }
  if (err.includes("captcha") || err.includes("recaptcha") || err.includes("bot detection")) {
    return {
      diagnosis: "Site detected the agent as a bot and presented a CAPTCHA challenge.",
      workaround: "Skipping this site and trying alternative retailers. Using residential proxy.",
      canRetry: true,
    };
  }
  if (err.includes("out of stock") || err.includes("unavailable") || err.includes("not found")) {
    return {
      diagnosis: "Product appears to be out of stock or unavailable at tried sites.",
      workaround: "Broadening search terms and trying additional retailers.",
      canRetry: true,
    };
  }
  if (err.includes("payment") || err.includes("card declined") || err.includes("card error")) {
    return {
      diagnosis: "Payment was declined or card processing failed.",
      workaround: "Trying next available payment card.",
      canRetry: true,
    };
  }
  if (err.includes("session creation failed") || err.includes("402") || err.includes("insufficient") || err.includes("credits")) {
    return {
      diagnosis: "API credits are insufficient to run the agent.",
      workaround: "Cannot retry without credits. User needs to top up their account.",
      canRetry: false,
    };
  }
  if (err.includes("timed_out") || err.includes("timeout")) {
    return {
      diagnosis: "The agent task timed out before completing.",
      workaround: "Retrying with more focused instructions and fewer sites to try.",
      canRetry: true,
    };
  }
  if (err.includes("blocked")) {
    return {
      diagnosis: "The agent was blocked by a site's security measures.",
      workaround: "Using residential proxy and trying different retailers.",
      canRetry: true,
    };
  }

  // Generic retryable failure
  return {
    diagnosis: `Task failed: ${errorMessage?.substring(0, 200) || "Unknown error"}`,
    workaround: "Retrying with adjusted instructions and increased step limit.",
    canRetry: true,
  };
}

// Auto-retry a failed order with adjusted parameters
// deno-lint-ignore no-explicit-any
async function autoRetryOrder(
  supabase: any,
  user: { id: string; email?: string },
  order: Record<string, unknown>,
  analysis: { diagnosis: string; workaround: string },
  skyvernApiKey: string,
  supabaseUrl: string,
  browserUseApiKey: string,
) {
  const retryCount = ((order.retry_count as number) || 0) + 1;
  const maxRetries = (order.max_retries as number) || 3;

  console.log(`[AutoShop] Auto-retrying order ${order.id} (attempt ${retryCount}/${maxRetries})`);

  // Log the retry
  await supabase.from("agent_logs").insert({
    user_id: user.id,
    agent_name: "auto_shop",
    log_level: "warn",
    message: `Auto-retrying order "${order.product_query}" (attempt ${retryCount}/${maxRetries})`,
    metadata: {
      orderId: order.id,
      diagnosis: analysis.diagnosis,
      workaround: analysis.workaround,
      previousError: (order.error_message as string)?.substring(0, 300),
    },
  });

  // Update order status to retrying
  await supabase
    .from("auto_shop_orders")
    .update({
      status: "searching",
      retry_count: retryCount,
      failure_analysis: `Attempt ${retryCount}: ${analysis.diagnosis}\nFix: ${analysis.workaround}`,
      last_retry_at: new Date().toISOString(),
      error_message: null,
      completed_at: null,
      browser_use_task_id: null,
    })
    .eq("id", order.id);

  // Fetch required data for re-submission
  const { data: profile } = await supabase
    .from("browser_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const sitesLoggedIn: string[] = Array.isArray(profile?.shop_sites_logged_in)
    ? profile.shop_sites_logged_in
    : [];

  // Fetch shipping address
  const { data: shipping } = await supabase
    .from("shipping_addresses")
    .select("*")
    .eq("id", order.shipping_address_id)
    .single();

  if (!shipping) {
    console.error(`[AutoShop] No shipping address found for retry of order ${order.id}`);
    await supabase.from("auto_shop_orders").update({
      status: "failed",
      error_message: "Auto-retry failed: shipping address not found",
    }).eq("id", order.id);
    return null;
  }

  // Fetch payment cards
  const { data: cards } = await supabase
    .from("payment_cards")
    .select("*")
    .eq("user_id", user.id);

  if (!cards || cards.length === 0) {
    await supabase.from("auto_shop_orders").update({
      status: "failed",
      error_message: "Auto-retry failed: no payment cards found",
    }).eq("id", order.id);
    return null;
  }

  // Decrypt cards
  const encKey = "SHOP_PROXY_KEY_2024";
  const decryptedCards: PaymentCard[] = cards.map((c: Record<string, string>) => {
    const decrypt = (enc: string) => {
      try {
        const decoded = atob(enc);
        let result = "";
        for (let i = 0; i < decoded.length; i++) {
          result += String.fromCharCode(decoded.charCodeAt(i) ^ encKey.charCodeAt(i % encKey.length));
        }
        return result;
      } catch { return enc; }
    };
    return {
      id: c.id,
      cardNumber: decrypt(c.card_number_enc),
      expiry: decrypt(c.expiry_enc),
      cvv: decrypt(c.cvv_enc),
      cardholderName: c.cardholder_name,
      billingAddress: c.billing_address,
      billingCity: c.billing_city,
      billingState: c.billing_state,
      billingZip: c.billing_zip,
      billingCountry: c.billing_country,
    };
  });

  // Fetch site credentials
  const { data: siteCreds } = await supabase
    .from("site_credentials")
    .select("site_domain, email_used, password_enc")
    .eq("user_id", user.id);

  const decryptedCreds: { site: string; email: string; password: string }[] = [];
  if (siteCreds) {
    for (const cred of siteCreds) {
      try {
        const decoded = atob(cred.password_enc);
        let decrypted = "";
        for (let i = 0; i < decoded.length; i++) {
          decrypted += String.fromCharCode(decoded.charCodeAt(i) ^ encKey.charCodeAt(i % encKey.length));
        }
        decryptedCreds.push({ site: cred.site_domain, email: cred.email_used, password: decrypted });
      } catch { /* skip */ }
    }
  }

  // Build prompt with retry-specific adjustments
  const retryPromptPrefix = `
=== AUTO-RETRY ATTEMPT ${retryCount} ===
PREVIOUS FAILURE: ${analysis.diagnosis}
APPLIED FIX: ${analysis.workaround}

CRITICAL RULES FOR THIS RETRY:
- Do NOT repeat the same mistakes from the previous attempt
- If a site blocks you, IMMEDIATELY move to a different retailer
- Phone number fields are NORMAL - always enter the provided phone number
- Prefer GUEST CHECKOUT to avoid account creation issues
- If stuck on any page for more than 3 steps, ABANDON that site and try another
- Try at least 3 DIFFERENT retailers before giving up
=== END RETRY CONTEXT ===

`;

  const agentPrompt = retryPromptPrefix + buildShoppingAgentInstruction(
    order.product_query as string,
    order.max_price as number | undefined,
    (order.quantity as number) || 1,
    shipping as ShippingAddress,
    decryptedCards,
    user.email || "",
    sitesLoggedIn,
    supabaseUrl,
    profile?.use_browserstack ?? false,
    decryptedCreds,
  );

  // Submit to Skyvern with increased steps for retry
  const skyvernPayload: Record<string, unknown> = {
    prompt: agentPrompt,
    url: "https://www.google.com/shopping",
    proxy_location: "RESIDENTIAL",
    max_steps_override: 100 + (retryCount * 20), // More steps for each retry
  };

  if (order.max_price) {
    skyvernPayload.navigation_payload = {
      max_price: order.max_price,
      product_query: order.product_query,
      quantity: (order.quantity as number) || 1,
    };
  }

  const skyvernResponse = await fetch(`${SKYVERN_API_BASE}/run/tasks`, {
    method: "POST",
    headers: {
      "x-api-key": skyvernApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(skyvernPayload),
  });

  if (!skyvernResponse.ok) {
    const errorText = await skyvernResponse.text();
    console.error(`[AutoShop] Retry Skyvern API error:`, skyvernResponse.status, errorText);
    const nextRetryCount = (order.retry_count || 0) + 1;
    await supabase.from("auto_shop_orders").update({
      status: "failed",
      error_message: `Auto-retry Skyvern error: ${skyvernResponse.status}`,
      retry_count: nextRetryCount,
      last_retry_at: new Date().toISOString(),
    }).eq("id", order.id);
    return null;
  }

  const result = await skyvernResponse.json();
  const runId = result.run_id || result.id;
  console.log(`[AutoShop] Retry task submitted: ${runId}`);

  await supabase.from("auto_shop_orders").update({
    browser_use_task_id: runId,
    status: "searching",
  }).eq("id", order.id);

  return runId;
}

// Sync all pending orders for a user via Skyvern (with auto-retry on failure)
// deno-lint-ignore no-explicit-any
async function handleSyncAllOrders(
  supabase: any,
  user: { id: string; email?: string },
  skyvernApiKey: string,
  supabaseUrl: string,
  browserUseApiKey: string,
) {
  const userId = user.id;
  // Get all orders with browser_use_task_id that aren't completed/failed
  // Include "failed" orders that still have retries remaining
  const { data: orders } = await supabase
    .from("auto_shop_orders")
    .select("*")
    .eq("user_id", userId)
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
      // Handle already-failed orders that still have retries remaining
      if (order.status === "failed" && (order.retry_count || 0) < (order.max_retries || 3)) {
        // Cooldown: don't retry if last retry was less than 30 seconds ago
        const lastRetry = order.last_retry_at ? new Date(order.last_retry_at).getTime() : 0;
        if (Date.now() - lastRetry < 30000) {
          updatedOrders.push(order);
          continue;
        }

        const analysis = analyzeFailure(order.error_message || "", order);
        if (analysis.canRetry) {
          console.log(`[AutoShop] Retrying previously failed order ${order.id} (attempt ${(order.retry_count || 0) + 1})`);
          await supabase.from("auto_shop_orders").update({
            failure_analysis: `${analysis.diagnosis}\nFix: ${analysis.workaround}`,
          }).eq("id", order.id);

          const retryRunId = await autoRetryOrder(
            supabase, user, { ...order }, analysis, skyvernApiKey, supabaseUrl, browserUseApiKey
          );
          if (retryRunId) {
            retriedCount++;
            console.log(`[AutoShop] Order ${order.id} auto-retried with run ${retryRunId}`);
          }
        }
        updatedOrders.push(order);
        continue;
      }

      const runId = order.browser_use_task_id;
      const taskRes = await fetch(`${SKYVERN_API_BASE}/runs/${runId}`, {
        headers: { "x-api-key": skyvernApiKey },
      });

      if (taskRes.ok) {
        const taskData = await taskRes.json();
        const updated = await updateOrderFromSkyvernRun(supabase, order, taskData);
        updatedOrders.push(updated);

        // Check if order just failed and is eligible for auto-retry
        if (
          updated.status === "failed" &&
          order.status !== "failed" &&
          (updated.retry_count || 0) < (updated.max_retries || 3)
        ) {
          const analysis = analyzeFailure(updated.error_message || "", updated);
          if (analysis.canRetry) {
            console.log(`[AutoShop] Auto-retrying order ${order.id}: ${analysis.diagnosis}`);

            await supabase.from("auto_shop_orders").update({
              failure_analysis: `${analysis.diagnosis}\nFix: ${analysis.workaround}`,
            }).eq("id", order.id);

            const retryRunId = await autoRetryOrder(
              supabase, user, { ...updated }, analysis, skyvernApiKey, supabaseUrl, browserUseApiKey
            );

            if (retryRunId) {
              retriedCount++;
              console.log(`[AutoShop] Order ${order.id} auto-retried with run ${retryRunId}`);
            }
          } else {
            await supabase.from("auto_shop_orders").update({
              failure_analysis: `${analysis.diagnosis} (NOT RETRYABLE: ${analysis.workaround})`,
            }).eq("id", order.id);
          }
        }
      }
    } catch (e) {
      console.error(`[AutoShop] Failed to sync order ${order.id}:`, e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, synced: updatedOrders.length, orders: updatedOrders, retried: retriedCount }),
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

// Update order from Skyvern run data
// Skyvern statuses: created, queued, running, completed, failed, terminated, timed_out, canceled
// deno-lint-ignore no-explicit-any
async function updateOrderFromSkyvernRun(supabase: any, order: any, runData: any) {
  const runStatus = runData.status;
  const output = runData.output || "";

  let newStatus = order.status;
  let errorMessage = order.error_message;
  let orderConfirmation = order.order_confirmation;
  let selectedDealSite = order.selected_deal_site;
  let selectedDealPrice = order.selected_deal_price;

  // Extract rich metadata from Skyvern response
  const liveMetadata: Record<string, unknown> = {};
  if (runData.recording_url) liveMetadata.recording_url = runData.recording_url;
  if (runData.steps_info) {
    liveMetadata.total_steps = runData.steps_info.total;
    liveMetadata.completed_steps = runData.steps_info.completed;
    liveMetadata.current_step_description = runData.steps_info.current?.description;
  }
  // Fallback: check for steps array or steps_count
  if (runData.steps && Array.isArray(runData.steps)) {
    liveMetadata.total_steps = runData.steps.length;
    const lastStep = runData.steps[runData.steps.length - 1];
    if (lastStep) {
      liveMetadata.current_step_description = lastStep.output?.action_results?.[0]?.data || lastStep.step_id || `Step ${runData.steps.length}`;
    }
  }
  if (runData.screenshot_urls && Array.isArray(runData.screenshot_urls) && runData.screenshot_urls.length > 0) {
    liveMetadata.latest_screenshot = runData.screenshot_urls[runData.screenshot_urls.length - 1];
  }

  if (runStatus === "completed") {
    // Parse the output to determine success/failure
    const outputStr = typeof output === "object" ? JSON.stringify(output) : String(output);
    const outputLower = outputStr.toLowerCase();
    
    if (outputLower.includes("success") && outputLower.includes("order placed")) {
      newStatus = "completed";
      // Try to extract confirmation number
      const confMatch = outputStr.match(/confirmation[:\s]*([A-Z0-9-]+)/i);
      if (confMatch) orderConfirmation = confMatch[1];
      // Try to extract site
      const siteMatch = outputStr.match(/at\s+(\w+)/i);
      if (siteMatch) selectedDealSite = siteMatch[1];
      // Try to extract price
      const priceMatch = outputStr.match(/\$([0-9,.]+)/);
      if (priceMatch) selectedDealPrice = parseFloat(priceMatch[1].replace(",", ""));
    } else if (outputLower.includes("failed") || outputLower.includes("could not")) {
      newStatus = "failed";
      errorMessage = outputStr.substring(0, 500);
    } else if (outputLower.includes("blocked")) {
      newStatus = "failed";
      errorMessage = outputStr.substring(0, 500);
    } else {
      // Task completed but unclear result
      newStatus = "completed";
    }
  } else if (runStatus === "failed" || runStatus === "terminated" || runStatus === "timed_out" || runStatus === "canceled") {
    newStatus = "failed";
    errorMessage = runData.failure_reason || runData.error || `Skyvern task ${runStatus}`;
  } else if (SKYVERN_ACTIVE_STATUSES.includes(runStatus)) {
    // Still running
    if (order.status === "pending") newStatus = "searching";
  }

  // Update if status changed OR we have live metadata to save
  const hasLiveMetadata = Object.keys(liveMetadata).length > 0;
  const statusChanged = newStatus !== order.status || orderConfirmation || selectedDealSite;

  if (statusChanged || hasLiveMetadata) {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (statusChanged) updateData.status = newStatus;
    if (errorMessage) updateData.error_message = errorMessage;
    if (orderConfirmation) updateData.order_confirmation = orderConfirmation;
    if (selectedDealSite) updateData.selected_deal_site = selectedDealSite;
    if (selectedDealPrice) updateData.selected_deal_price = selectedDealPrice;
    if (newStatus === "completed" || newStatus === "failed") {
      updateData.completed_at = new Date().toISOString();
    }
    // Store live agent metadata in notes as JSON
    if (hasLiveMetadata) {
      updateData.notes = JSON.stringify(liveMetadata);
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
