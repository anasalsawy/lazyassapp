import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Skyvern API configuration
const SKYVERN_API_BASE = "https://api.skyvern.com/v1";

async function skyvernApi(apiKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${SKYVERN_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  console.log(`[Skyvern] ${init.method || "GET"} ${path}`);
  return fetch(url, { ...init, headers });
}

/**
 * JOB AGENT - Job automation using Skyvern browser tasks
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY");

  if (!SKYVERN_API_KEY) {
    return new Response(
      JSON.stringify({ error: "SKYVERN_API_KEY not configured" }),
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
        user_id: user.id, agent_name: "job_agent", log_level: "info", message, metadata,
      });
    };

    switch (action) {
      case "create_profile": {
        await log("Creating browser profile...");
        const { data: existingProfile } = await supabase.from("browser_profiles").select("*").eq("user_id", user.id).single();

        if (existingProfile?.browser_use_profile_id) {
          return new Response(
            JSON.stringify({ success: true, profileId: existingProfile.browser_use_profile_id, message: "Profile already exists" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const profileId = `skyvern-${user.id.substring(0, 8)}-${Date.now()}`;
        await supabase.from("browser_profiles").upsert({
          user_id: user.id, browser_use_profile_id: profileId, status: "created", sites_logged_in: [],
        });

        await log("Profile created", { profileId });
        return new Response(JSON.stringify({ success: true, profileId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "start_login": {
        const { site } = body;
        await log("Starting login session...", { site });

        let { data: browserProfile } = await supabase.from("browser_profiles").select("*").eq("user_id", user.id).single();
        if (!browserProfile?.browser_use_profile_id) {
          const profileId = `skyvern-${user.id.substring(0, 8)}-${Date.now()}`;
          await supabase.from("browser_profiles").upsert({
            user_id: user.id, browser_use_profile_id: profileId, status: "pending_login", sites_logged_in: [],
          });
          browserProfile = { browser_use_profile_id: profileId };
        }

        const siteUrls: Record<string, string> = {
          gmail: "https://mail.google.com",
          linkedin: "https://www.linkedin.com/login",
          indeed: "https://secure.indeed.com/account/login",
          glassdoor: "https://www.glassdoor.com/member/login",
        };

        const startUrl = siteUrls[site] || `https://${site}.com`;

        // Create a Skyvern task for login
        const taskRes = await skyvernApi(SKYVERN_API_KEY, "/run/tasks", {
          method: "POST",
          body: JSON.stringify({
            prompt: `Navigate to ${startUrl} and display the login page. Wait for user interaction.`,
            url: startUrl,
            engine: "skyvern-2.0",
          }),
        });

        if (!taskRes.ok) {
          const error = await taskRes.text();
          throw new Error(`Failed to create Skyvern task (${taskRes.status}): ${error}`);
        }

        const taskData = await taskRes.json();
        const runId = taskData.run_id;
        const liveViewUrl = taskData.app_url || null;

        await supabase.from("browser_profiles").update({
          pending_login_site: site, pending_session_id: runId, status: "pending_login",
        }).eq("user_id", user.id);

        await log("Login session started", { site, runId, liveViewUrl });

        return new Response(
          JSON.stringify({ success: true, sessionId: runId, liveViewUrl, site, message: `Browser opened for ${site}. Log in to save your session.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "confirm_login": {
        const { site } = body;
        const { data: profile } = await supabase.from("browser_profiles").select("*").eq("user_id", user.id).single();
        if (!profile) throw new Error("No profile found");

        const sitesLoggedIn = [...new Set([...(profile.sites_logged_in || []), site])];
        await supabase.from("browser_profiles").update({
          sites_logged_in: sitesLoggedIn, pending_login_site: null, pending_session_id: null,
          pending_task_id: null, last_login_at: new Date().toISOString(), status: "active",
        }).eq("user_id", user.id);

        await log("Login confirmed", { site, allSites: sitesLoggedIn });
        return new Response(JSON.stringify({ success: true, sitesLoggedIn }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "run_agent": {
        await log("🚀 Starting job agent pipeline: Lever Research → Skyvern Apply");

        const { data: resume } = await supabase.from("resumes").select("*").eq("user_id", user.id).eq("is_primary", true).single();
        if (!resume) throw new Error("No primary resume found. Please upload and optimize your resume first.");

        const { data: agentRun } = await supabase.from("agent_runs").insert({
          user_id: user.id, run_type: "job_agent", status: "running", started_at: new Date().toISOString(),
        }).select().single();

        const runId = agentRun?.id;
        await log("Delegating to lever-job-research pipeline (background)", { resumeId: resume.id, runId });

        const backgroundWork = async () => {
          try {
            const leverResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lever-job-research`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
              body: JSON.stringify({ resumeId: resume.id, userId: user.id }),
            });
            const leverResult = leverResponse.ok ? await leverResponse.json() : null;
            const stats = leverResult?.stats || {};
            await supabase.from("agent_runs").update({
              status: "completed", ended_at: new Date().toISOString(),
              summary_json: { jobsFound: stats.found || 0, jobsQualified: stats.qualified || 0, submittedToSkyvern: stats.submittedToSkyvern || 0 },
            }).eq("id", runId);
          } catch (err) {
            console.error("[JobAgent] Background pipeline failed:", err);
            await supabase.from("agent_runs").update({
              status: "failed", ended_at: new Date().toISOString(), error_message: err instanceof Error ? err.message : String(err),
            }).eq("id", runId);
          }
        };

        if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
          (EdgeRuntime as any).waitUntil(backgroundWork());
        } else { backgroundWork().catch(console.error); }

        return new Response(
          JSON.stringify({ success: true, runId, status: "running", message: "Job agent started! Pipeline running in background." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_status": {
        const { data: profile } = await supabase.from("browser_profiles").select("*").eq("user_id", user.id).single();
        const { data: recentRuns } = await supabase.from("agent_runs").select("*").eq("user_id", user.id).eq("run_type", "job_agent").order("created_at", { ascending: false }).limit(5);
        const { data: recentJobs } = await supabase.from("jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
        const { data: recentApps } = await supabase.from("applications").select("*, jobs(*)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);

        return new Response(
          JSON.stringify({
            success: true,
            profile: { hasProfile: !!profile?.browser_use_profile_id, sitesLoggedIn: profile?.sites_logged_in || [], lastLoginAt: profile?.last_login_at, status: profile?.status || "not_setup" },
            recentRuns, recentJobs, recentApplications: recentApps,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "cleanup_sessions": {
        await log("Cleaning up...");
        await supabase.from("browser_profiles").update({ pending_session_id: null, pending_task_id: null }).eq("user_id", user.id);
        await log("Sessions cleaned up");
        return new Response(JSON.stringify({ success: true, closedCount: 0, message: "Session references cleared." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    console.error("[JobAgent] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
