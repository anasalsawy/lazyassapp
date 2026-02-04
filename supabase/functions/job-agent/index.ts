import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Browser Use Cloud has multiple API hostnames depending on plan/product generation.
// We try them in order to avoid hard failures when one host returns 404.
const DEFAULT_BROWSER_USE_BASE_URLS = [
  "https://api.browser-use.com",
  "https://api.cloud.browser-use.com",
];

function getBrowserUseBaseUrls() {
  const raw = Deno.env.get("BROWSER_USE_BASE_URLS");
  if (!raw) return DEFAULT_BROWSER_USE_BASE_URLS;
  const urls = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return urls.length ? urls : DEFAULT_BROWSER_USE_BASE_URLS;
}

async function browserUseFetch(
  path: string,
  init: RequestInit,
  opts: { retryOn404?: boolean } = {},
) {
  const baseUrls = getBrowserUseBaseUrls();
  const retryOn404 = opts.retryOn404 ?? true;

  let lastResp: Response | null = null;
  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}${path}`;
    const resp = await fetch(url, init);

    // Success, or non-404 error (auth, rate limit, etc.) should be surfaced immediately.
    if (resp.ok) return resp;
    if (!retryOn404 || resp.status !== 404) return resp;

    lastResp = resp;
  }

  return lastResp ?? new Response(JSON.stringify({ detail: "No Browser Use base URLs configured" }), { status: 500 });
}

/**
 * JOB AGENT - Simplified job automation using Browser Use persistent profiles
 * 
 * Actions:
 * - create_profile: Creates a Browser Use profile for the user
 * - start_login: Opens live browser for user to log into accounts
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
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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

        // Create profile in Browser Use - Note: v1 API uses Bearer auth
        const profileResponse = await browserUseFetch("/api/v1/browser-profile", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${BROWSER_USE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: `user-${user.id.substring(0, 8)}`,
          }),
        });

        if (!profileResponse.ok) {
          const error = await profileResponse.text();
          throw new Error(`Failed to create profile: ${error}`);
        }

        const profileData = await profileResponse.json();
        const profileId = profileData.id || profileData.profile_id;

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

        // Ensure user has a profile record (create if needed)
        const { data: existingProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!existingProfile) {
          await supabase.from("browser_profiles").insert({
            user_id: user.id,
            status: "pending_login",
            sites_logged_in: [],
          });
        }

        const siteUrls: Record<string, string> = {
          gmail: "https://mail.google.com",
          linkedin: "https://www.linkedin.com/login",
          indeed: "https://secure.indeed.com/account/login",
          glassdoor: "https://www.glassdoor.com/member/login",
        };

        const startUrl = siteUrls[site] || `https://${site}.com`;

        // Create a task that navigates to the login page and waits for user
        console.log("Calling Browser Use API with key:", BROWSER_USE_API_KEY?.substring(0, 10) + "...");
        
        const taskResponse = await browserUseFetch("/api/v1/run-task", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${BROWSER_USE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task: `Navigate to ${startUrl}. This is a login session - wait for the user to manually log in. Do not take any automated actions. Simply observe and report when the user has successfully logged in (when the page shows a logged-in state like an inbox or dashboard).`,
            save_browser_data: true,
            highlight_elements: false,
          }),
        });

        console.log("Browser Use API response status:", taskResponse.status);

        if (!taskResponse.ok) {
          const error = await taskResponse.text();
          console.error("Task creation failed:", error);
          
          // Provide better error message
          if (taskResponse.status === 404) {
            throw new Error("Browser Use API returned 404. Please verify your BROWSER_USE_API_KEY is valid and has access to the API.");
          }
          if (taskResponse.status === 401 || taskResponse.status === 403) {
            throw new Error("Browser Use API authentication failed. Please check your API key.");
          }
          throw new Error(`Browser Use API error (${taskResponse.status}): ${error}`);
        }

        const taskData = await taskResponse.json();
        console.log("Task response:", JSON.stringify(taskData));
        
        const taskId = taskData.id || taskData.task_id;
        let liveViewUrl = taskData.live_url || taskData.liveUrl || taskData.stream_url;
        
        // If no live URL in initial response, fetch task details
        if (!liveViewUrl && taskId) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s for task to initialize
          
           const detailsResponse = await browserUseFetch(`/api/v1/task/${taskId}`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${BROWSER_USE_API_KEY}`,
            },
           });
          
          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            console.log("Task details:", JSON.stringify(detailsData));
            liveViewUrl = detailsData.live_url || detailsData.liveUrl || detailsData.stream_url;
          }
        }

        // Store pending login
        await supabase.from("browser_profiles").update({
          pending_login_site: site,
          pending_task_id: taskId,
          status: "pending_login",
        }).eq("user_id", user.id);

        await log("Login session started", { site, taskId, liveViewUrl, hasUrl: !!liveViewUrl });

        return new Response(
          JSON.stringify({
            success: true,
            taskId,
            liveViewUrl,
            site,
            message: liveViewUrl 
              ? `Browser opened for ${site}. Log in to save your session.`
              : `Login task started for ${site}. Check back in a moment.`,
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

        const sitesLoggedIn = [...new Set([...(profile.sites_logged_in || []), site])];

        await supabase.from("browser_profiles").update({
          sites_logged_in: sitesLoggedIn,
          pending_login_site: null,
          pending_session_id: null,
          pending_task_id: null,
          last_login_at: new Date().toISOString(),
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
        await log("🚀 Starting job agent run...");

        // Get user's profile and preferences
        const { data: browserProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!browserProfile?.browser_use_profile_id) {
          throw new Error("No browser profile. Please set up your accounts first.");
        }

        if (!browserProfile.sites_logged_in?.length) {
          throw new Error("No accounts connected. Please log in to at least one job site.");
        }

        const { data: userProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const { data: resume } = await supabase
          .from("resumes")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_primary", true)
          .single();

        const { data: jobPrefs } = await supabase
          .from("job_preferences")
          .select("*")
          .eq("user_id", user.id)
          .single();

        // Create an agent run
        const { data: run } = await supabase
          .from("agent_runs")
          .insert({
            user_id: user.id,
            run_type: "job_agent",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        // Build the mega-instruction for the agent
        const jobTitles = jobPrefs?.job_titles?.join(", ") || "Software Engineer";
        const locations = jobPrefs?.locations?.join(", ") || "Remote";
        const minSalary = jobPrefs?.salary_min || 50000;

        const agentInstruction = `
You are an autonomous job agent. Your mission is to find and apply to jobs for the user.

CONNECTED ACCOUNTS: ${browserProfile.sites_logged_in.join(", ")}

USER PROFILE:
- Name: ${userProfile?.first_name || "User"} ${userProfile?.last_name || ""}
- Email: ${userProfile?.email || user.email}
- Phone: ${userProfile?.phone || "Not provided"}

JOB PREFERENCES:
- Target Roles: ${jobTitles}
- Locations: ${locations}
- Minimum Salary: $${minSalary}

RESUME SUMMARY:
${resume?.parsed_content?.text?.substring(0, 2000) || "No resume uploaded"}
Skills: ${resume?.skills?.join(", ") || "Not specified"}
Experience: ${resume?.experience_years || 0} years

YOUR TASKS (in order):
1. SCRAPE JOBS: Go to each logged-in job site and search for matching jobs. Look for roles matching "${jobTitles}" in "${locations}".

2. EVALUATE EACH JOB: For each listing found:
   - Extract: title, company, salary, location, requirements
   - Score match from 0-100 based on user's profile
   - Only proceed with jobs scoring 70+

3. APPLY TO TOP JOBS: For the best matches (up to 5 per run):
   - Navigate to the apply button
   - Fill out all forms using user's profile data
   - Submit the application
   - Take a screenshot of confirmation

4. CHECK EMAILS: If Gmail is connected:
   - Check for new recruiter emails
   - Flag any interview requests or responses
   - Report any action items

REPORT FORMAT (return this JSON at the end):
{
  "jobs_found": [{"title": "", "company": "", "score": 0, "url": ""}],
  "applications_submitted": [{"title": "", "company": "", "status": "submitted|failed", "notes": ""}],
  "emails_found": [{"from": "", "subject": "", "type": "interview|rejection|other"}],
  "summary": "Brief summary of this run"
}

DO NOT STOP. Work through all sites methodically. Complete as many applications as possible.
`;

        // Start the agent task
        const taskResponse = await browserUseFetch("/api/v1/run-task", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${BROWSER_USE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task: agentInstruction,
            save_browser_data: true,
            max_agent_steps: 100,
          }),
        });

        const taskData = await taskResponse.json();
        const taskId = taskData.id || taskData.task_id;

        // Store task reference
        await supabase.from("agent_runs").update({
          summary_json: { browser_use_task_id: taskId },
        }).eq("id", run?.id);

        await log("Agent task started", { taskId, runId: run?.id });

        return new Response(
          JSON.stringify({
            success: true,
            runId: run?.id,
            taskId,
            message: "Job agent is running. Check back in a few minutes.",
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
