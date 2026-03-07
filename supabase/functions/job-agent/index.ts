import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRIDGE_URL = Deno.env.get("BROWSER_USE_BRIDGE_URL") || Deno.env.get("BRIDGE_URL") || "https://browser-use-bridge.onrender.com";
const BRIDGE_API_KEY = Deno.env.get("BROWSER_USE_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY") || "";

/**
 * JOB AGENT - Job automation using Playwright bridge
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

        const profileId = `pw-${user.id.substring(0, 8)}-${Date.now()}`;
        await supabase.from("browser_profiles").upsert({
          user_id: user.id, browser_use_profile_id: profileId, status: "created", sites_logged_in: [],
        });

        await log("Profile created", { profileId });
        return new Response(JSON.stringify({ success: true, profileId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "start_login": {
        const { site } = body;
        await log("Starting login session via bridge...", { site });

        let { data: browserProfile } = await supabase.from("browser_profiles").select("*").eq("user_id", user.id).single();
        if (!browserProfile?.browser_use_profile_id) {
          const profileId = `pw-${user.id.substring(0, 8)}-${Date.now()}`;
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

        // Navigate to login page via Playwright bridge
        let taskId = crypto.randomUUID();
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (BRIDGE_API_KEY) headers["Authorization"] = `Bearer ${BRIDGE_API_KEY}`;
          const res = await fetch(`${BRIDGE_URL.replace(/\/$/, "")}/run-task`, {
            method: "POST",
            headers,
            body: JSON.stringify({ url: startUrl, extract_text: true }),
          });
          if (res.ok) {
            const data = await res.json();
            taskId = data.task_id || data.id || taskId;
            console.log(`[JobAgent] Bridge login page loaded: ${taskId}`);
          } else {
            console.warn(`[JobAgent] Bridge login navigation failed (${res.status})`);
          }
        } catch (e) {
          console.warn(`[JobAgent] Bridge unreachable for login:`, e);
        }

        await supabase.from("browser_profiles").update({
          pending_login_site: site, pending_session_id: taskId, status: "pending_login",
        }).eq("user_id", user.id);

        await log("Login session started via bridge", { site, taskId });

        return new Response(
          JSON.stringify({ success: true, sessionId: taskId, liveViewUrl: null, site, message: `Login page accessed via Playwright bridge for ${site}. Please confirm login when ready.` }),
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
        await log("🚀 Starting job agent pipeline: Lever Research → Apply");

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

        if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
          (globalThis as any).EdgeRuntime.waitUntil(backgroundWork());
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
