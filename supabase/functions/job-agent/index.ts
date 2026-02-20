import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Browser Use Cloud v2 API base URL (used for profile/login management only)
const BROWSER_USE_BASE_URL = "https://api.browser-use.com";

// Lever job research is handled by the lever-job-research edge function
// Unified profile naming - shared between job-agent and auto-shop
// This ensures authentication cookies (Gmail, etc.) are shared across features
const getProfileName = (userId: string) => `user-${userId.substring(0, 8)}`;

// Browser Use API v2 status values (per official API spec)
// Task status: started, paused, finished, stopped
// Session status: active, stopped

/**
 * Helper to call Browser Use Cloud v2 API
 * Uses X-Browser-Use-API-Key header for authentication
 */
async function browserUseApi(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${BROWSER_USE_BASE_URL}${path}`;
  const headers = {
    "X-Browser-Use-API-Key": apiKey,
    "Content-Type": "application/json",
    ...init.headers,
  };
  
  console.log(`[BrowserUse] ${init.method || "GET"} ${path}`);
  
  return fetch(url, { ...init, headers });
}

/**
 * JOB AGENT - Simplified job automation using Browser Use persistent profiles
 * 
 * Actions:
 * - create_profile: Creates a Browser Use profile for the user
 * - start_login: Opens live browser for user to log into accounts
 * - confirm_login: Mark site as logged in
 * - run_agent: Background task to scrape jobs, apply, monitor emails
 * - get_status: Check agent status and profile health
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BROWSER_USE_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");

  if (!BROWSER_USE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "BROWSER_USE_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const action = body.action;

    const log = async (message: string, metadata: any = {}) => {
      console.log(`[JobAgent] ${message}`, metadata);
      await supabase.from("agent_logs").insert({
        user_id: user.id,
        agent_name: "job_agent",
        log_level: "info",
        message,
        metadata,
      });
    };

    switch (action) {
      // ============================================
      // CREATE PROFILE - One-time setup
      // ============================================
      case "create_profile": {
        await log("Creating Browser Use profile...");

        // Check if user already has a profile
        const { data: existingProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (existingProfile?.browser_use_profile_id) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              profileId: existingProfile.browser_use_profile_id,
              message: "Profile already exists" 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Create profile in Browser Use Cloud v2 API
        const profileResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/profiles", {
          method: "POST",
          body: JSON.stringify({
            name: getProfileName(user.id),
          }),
        });

        if (!profileResponse.ok) {
          const error = await profileResponse.text();
          console.error("Profile creation failed:", profileResponse.status, error);
          throw new Error(`Failed to create profile (${profileResponse.status}): ${error}`);
        }

        const profileData = await profileResponse.json();
        const profileId = profileData.id;

        // Store profile reference
        await supabase.from("browser_profiles").upsert({
          user_id: user.id,
          browser_use_profile_id: profileId,
          status: "created",
          sites_logged_in: [],
        });

        await log("Profile created", { profileId });

        return new Response(
          JSON.stringify({ success: true, profileId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // START LOGIN SESSION - User logs in to accounts
      // ============================================
      case "start_login": {
        const { site } = body; // 'gmail', 'linkedin', 'indeed', etc.
        
        await log("Starting login session...", { site });

        // Get or create browser profile
        let { data: browserProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        // Auto-create profile if it doesn't exist
        if (!browserProfile?.browser_use_profile_id) {
          await log("No profile found, creating one...");
          
          const profileResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/profiles", {
            method: "POST",
            body: JSON.stringify({
              name: getProfileName(user.id),
            }),
          });

          if (!profileResponse.ok) {
            const error = await profileResponse.text();
            throw new Error(`Failed to create profile: ${error}`);
          }

          const profileData = await profileResponse.json();
          
          await supabase.from("browser_profiles").upsert({
            user_id: user.id,
            browser_use_profile_id: profileData.id,
            status: "pending_login",
            sites_logged_in: [],
          });

          browserProfile = { browser_use_profile_id: profileData.id };
        }

        const siteUrls: Record<string, string> = {
          gmail: "https://mail.google.com",
          linkedin: "https://www.linkedin.com/login",
          indeed: "https://secure.indeed.com/account/login",
          glassdoor: "https://www.glassdoor.com/member/login",
        };

        const startUrl = siteUrls[site] || `https://${site}.com`;

        // Create a session with the profile for persistent login state
        // Using keepAlive=true so the session stays open for manual login
        console.log("Creating Browser Use session with profile:", browserProfile.browser_use_profile_id);
        
        const sessionResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            profileId: browserProfile.browser_use_profile_id,
            startUrl: startUrl,
            keepAlive: true,
            browserScreenWidth: 1280,
            browserScreenHeight: 800,
          }),
        });

        console.log("Session response status:", sessionResponse.status);

        if (!sessionResponse.ok) {
          const error = await sessionResponse.text();
          console.error("Session creation failed:", error);
          throw new Error(`Failed to create session (${sessionResponse.status}): ${error}`);
        }

        const sessionData = await sessionResponse.json();
        console.log("Session created:", JSON.stringify(sessionData));
        
        const sessionId = sessionData.id;
        const liveViewUrl = sessionData.liveUrl;

        // Store pending login
        await supabase.from("browser_profiles").update({
          pending_login_site: site,
          pending_session_id: sessionId,
          status: "pending_login",
        }).eq("user_id", user.id);

        await log("Login session started", { site, sessionId, liveViewUrl });

        return new Response(
          JSON.stringify({
            success: true,
            sessionId,
            liveViewUrl,
            site,
            message: `Browser opened for ${site}. Log in to save your session.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // CONFIRM LOGIN - Mark site as logged in
      // ============================================
      case "confirm_login": {
        const { site } = body;

        const { data: profile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!profile) throw new Error("No profile found");

        // Stop the session to save the profile state
        // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
        if (profile.pending_session_id) {
          try {
            await browserUseApi(BROWSER_USE_API_KEY, `/api/v2/sessions/${profile.pending_session_id}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "stop" }),
            });
            await log("Session stopped, profile state saved", { sessionId: profile.pending_session_id });
          } catch (e) {
            console.error("Failed to stop session:", e);
          }
        }

        const sitesLoggedIn = [...new Set([...(profile.sites_logged_in || []), site])];

        await supabase.from("browser_profiles").update({
          sites_logged_in: sitesLoggedIn,
          pending_login_site: null,
          pending_session_id: null,
          pending_task_id: null,
          last_login_at: new Date().toISOString(),
          status: "active",
        }).eq("user_id", user.id);

        await log("Login confirmed", { site, allSites: sitesLoggedIn });

        return new Response(
          JSON.stringify({ success: true, sitesLoggedIn }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // RUN AGENT - Background job scraping & applying
      // ============================================
      case "run_agent": {
        await log("🚀 Starting job agent pipeline: Lever Research → Skyvern Apply");

        // Get user's primary resume
        const { data: resume } = await supabase
          .from("resumes")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_primary", true)
          .single();

        if (!resume) {
          throw new Error("No primary resume found. Please upload and optimize your resume first.");
        }

        await log("Delegating to lever-job-research pipeline", { resumeId: resume.id });

        // Call lever-job-research edge function directly (internal service call)
        // This handles the full pipeline:
        // 1. AI infers search queries from CV
        // 2. Scrapes Lever job boards via Firecrawl
        // 3. Scores each job for compatibility (80+ threshold)
        // 4. Saves qualified jobs to DB
        // 5. Submits each qualified URL to Skyvern with simple "apply" prompt
        const leverResponse = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/lever-job-research`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resumeId: resume.id,
              userId: user.id,
            }),
          }
        );

        if (!leverResponse.ok) {
          const errorText = await leverResponse.text();
          console.error("[JobAgent] Lever research failed:", leverResponse.status, errorText);
          throw new Error(`Job research pipeline failed: ${errorText}`);
        }

        const leverResult = await leverResponse.json();
        
        await log("Pipeline complete", {
          jobsFound: leverResult.stats?.found || 0,
          jobsQualified: leverResult.stats?.qualified || 0,
          submittedToSkyvern: leverResult.stats?.submittedToSkyvern || 0,
        });

        return new Response(
          JSON.stringify({
            success: true,
            stats: leverResult.stats,
            jobs: leverResult.jobs,
            message: `Found ${leverResult.stats?.found || 0} jobs, ${leverResult.stats?.qualified || 0} qualified (80+ match), ${leverResult.stats?.submittedToSkyvern || 0} submitted to Skyvern for auto-apply.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // GET STATUS - Check profile and recent runs
      // ============================================
      case "get_status": {
        const { data: profile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const { data: recentRuns } = await supabase
          .from("agent_runs")
          .select("*")
          .eq("user_id", user.id)
          .eq("run_type", "job_agent")
          .order("created_at", { ascending: false })
          .limit(5);

        const { data: recentJobs } = await supabase
          .from("jobs")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        const { data: recentApps } = await supabase
          .from("applications")
          .select("*, jobs(*)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        return new Response(
          JSON.stringify({
            success: true,
            profile: {
              hasProfile: !!profile?.browser_use_profile_id,
              sitesLoggedIn: profile?.sites_logged_in || [],
              lastLoginAt: profile?.last_login_at,
              status: profile?.status || "not_setup",
            },
            recentRuns,
            recentJobs,
            recentApplications: recentApps,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // CLEANUP SESSIONS - Close active sessions to free up quota
      // ============================================
      case "cleanup_sessions": {
        await log("Cleaning up active Browser Use sessions...");

        // List all active sessions - Browser Use v2 API uses filterBy=active
        const listResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/sessions?filterBy=active", {
          method: "GET",
        });

        if (!listResponse.ok) {
          const error = await listResponse.text();
          throw new Error(`Failed to list sessions: ${error}`);
        }

        const sessionsData = await listResponse.json();
        console.log("Sessions response:", JSON.stringify(sessionsData));
        
        // Response format per v2 API: { items: [...], totalItems, pageNumber, pageSize }
        const sessionsList = sessionsData.items || [];
        
        // Sessions returned by filterBy=active are already active
        const activeSessions = sessionsList;

        let closedCount = 0;
        for (const session of activeSessions) {
          try {
            // Use PATCH with action: "stop" per Browser Use Cloud v2 API spec
            await browserUseApi(BROWSER_USE_API_KEY, `/api/v2/sessions/${session.id}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "stop" }),
            });
            closedCount++;
            console.log(`Closed session: ${session.id}`);
          } catch (e) {
            console.error(`Failed to close session ${session.id}:`, e);
          }
        }

        // Clear pending session from profile
        await supabase.from("browser_profiles").update({
          pending_session_id: null,
          pending_task_id: null,
        }).eq("user_id", user.id);

        await log("Sessions cleaned up", { closedCount, totalActive: activeSessions.length });

        return new Response(
          JSON.stringify({
            success: true,
            closedCount,
            message: `Closed ${closedCount} active session(s). You can now start a new login session.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    console.error("[JobAgent] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
