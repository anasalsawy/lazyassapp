import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SKYVERN_API_BASE = "https://api.skyvern.com/v1";
const SKYVERN_WORKFLOW_ID = "wpid_498196715611431438";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY");

  if (!SKYVERN_API_KEY) {
    return new Response(JSON.stringify({ error: "SKYVERN_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    const { resumeId, action } = body;
    if (!resumeId) throw new Error("resumeId is required");

    // ========== POLL ==========
    if (action === "poll") {
      const { data: task } = await supabase
        .from("agent_tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("task_type", "optimize_resume")
        .contains("payload", { resumeId })
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!task) {
        return new Response(JSON.stringify({ status: "not_found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // If running, check Skyvern status
      if (task.status === "running") {
        const payload = task.payload as Record<string, unknown>;
        const skyvernRunId = payload?.skyvern_run_id as string;

        if (skyvernRunId) {
          try {
            const skyvernRes = await fetch(
              `${SKYVERN_API_BASE}/run/workflows/${skyvernRunId}`,
              { headers: { "x-api-key": SKYVERN_API_KEY } }
            );

            if (skyvernRes.ok) {
              const runData = await skyvernRes.json();
              const skyvernStatus = (runData.status || "").toLowerCase();

              // Extract live metadata
              const liveInfo: Record<string, unknown> = {
                stage: "optimizing",
                skyvern_status: skyvernStatus,
              };

              if (runData.steps_info) {
                liveInfo.total_steps = runData.steps_info.total;
                liveInfo.completed_steps = runData.steps_info.completed;
              }

              if (runData.recording_url) {
                liveInfo.recording_url = runData.recording_url;
              }

              // Check terminal states
              if (["completed", "finished", "success"].includes(skyvernStatus)) {
                // Extract output from Skyvern
                const output = runData.output || runData.result || "";
                const outputText = typeof output === "string" ? output : JSON.stringify(output);

                // Save optimized content to resume
                const { data: resume } = await supabase
                  .from("resumes")
                  .select("parsed_content")
                  .eq("id", resumeId)
                  .single();

                const existingContent = (resume?.parsed_content as Record<string, unknown>) || {};

                await supabase.from("resumes").update({
                  parsed_content: {
                    ...existingContent,
                    optimizedText: outputText,
                    optimizedAt: new Date().toISOString(),
                    optimizationMethod: "skyvern_chatgpt_deep_research",
                  },
                }).eq("id", resumeId);

                // Mark task completed
                await supabase.from("agent_tasks").update({
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  result: {
                    stage: "done",
                    optimizedText: outputText,
                    recording_url: runData.recording_url || null,
                  },
                }).eq("id", task.id);

                return new Response(JSON.stringify({
                  status: "completed",
                  result: {
                    stage: "done",
                    optimizedText: outputText,
                    recording_url: runData.recording_url || null,
                  },
                }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }

              if (["failed", "terminated", "timed_out", "canceled"].includes(skyvernStatus)) {
                const errMsg = runData.failure_reason || runData.error || `Skyvern workflow ${skyvernStatus}`;
                await supabase.from("agent_tasks").update({
                  status: "failed",
                  error_message: errMsg,
                  completed_at: new Date().toISOString(),
                }).eq("id", task.id);

                return new Response(JSON.stringify({
                  status: "failed",
                  error: errMsg,
                }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }

              // Still running — update live info
              await supabase.from("agent_tasks").update({
                result: liveInfo,
                updated_at: new Date().toISOString(),
              }).eq("id", task.id);

              return new Response(JSON.stringify({
                status: "running",
                result: liveInfo,
              }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
          } catch (e) {
            console.error("[OptimizeResume] Skyvern poll error:", e);
          }
        }
      }

      return new Response(JSON.stringify({
        status: task.status,
        result: task.result,
        error: task.error_message,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== START ==========
    // Cancel any prior running tasks
    await supabase.from("agent_tasks")
      .update({ status: "cancelled" })
      .eq("user_id", user.id)
      .eq("task_type", "optimize_resume")
      .in("status", ["pending", "running"])
      .contains("payload", { resumeId });

    // Load resume text
    const { data: resume, error: resumeErr } = await supabase
      .from("resumes").select("*").eq("id", resumeId).eq("user_id", user.id).single();
    if (resumeErr || !resume) throw new Error("Resume not found");

    const parsedContent = resume.parsed_content as Record<string, unknown> | null;
    const rawText: string =
      (parsedContent?.rawText as string) ||
      (parsedContent?.fullText as string) ||
      (parsedContent?.text as string) || "";

    if (!rawText || rawText.length < 50) {
      throw new Error("Resume text is empty — please re-upload and let the analyzer extract text first.");
    }

    // Load user profile for context
    const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
    const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "the candidate";

    // Load job preferences for context
    const { data: jobPrefs } = await supabase.from("job_preferences").select("job_titles, industries, locations").eq("user_id", user.id).single();
    const jobDescription = body.jobDescription || 
      [
        jobPrefs?.job_titles?.length ? `Target roles: ${jobPrefs.job_titles.join(", ")}` : "",
        jobPrefs?.industries?.length ? `Industries: ${jobPrefs.industries.join(", ")}` : "",
        jobPrefs?.locations?.length ? `Locations: ${jobPrefs.locations.join(", ")}` : "",
      ].filter(Boolean).join(". ") || "General professional optimization";

    // Submit to Skyvern workflow with required parameters
    const navigationPayload: Record<string, string> = {
      chatgpt_credentials: "credchatgpt",
      resume: rawText.substring(0, 8000),
      job_description: jobDescription,
      resume_owner_name: userName,
    };

    console.log(`[OptimizeResume] Submitting to Skyvern workflow ${SKYVERN_WORKFLOW_ID}`);

    const skyvernRes = await fetch(`${SKYVERN_API_BASE}/run/workflows`, {
      method: "POST",
      headers: {
        "x-api-key": SKYVERN_API_KEY,
        "Content-Type": "application/json",
        "x-max-steps-override": "150",
      },
      body: JSON.stringify({
        workflow_id: SKYVERN_WORKFLOW_ID,
        data: navigationPayload,
        proxy_location: "RESIDENTIAL",
      }),
    });

    if (!skyvernRes.ok) {
      const errText = await skyvernRes.text();
      throw new Error(`Skyvern workflow submission failed (${skyvernRes.status}): ${errText}`);
    }

    const skyvernData = await skyvernRes.json();
    const skyvernRunId = skyvernData.run_id || skyvernData.workflow_run_id || skyvernData.id;

    if (!skyvernRunId) {
      throw new Error("No run ID returned from Skyvern");
    }

    console.log(`[OptimizeResume] Skyvern workflow started: ${skyvernRunId}`);

    // Create agent task
    const { data: task, error: insertErr } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      task_type: "optimize_resume",
      status: "running",
      started_at: new Date().toISOString(),
      payload: { resumeId, skyvern_run_id: skyvernRunId },
      result: { stage: "optimizing", skyvern_status: "running" },
      priority: 1,
    }).select().single();

    if (insertErr) throw insertErr;

    // Also create an agent_run for tracking
    await supabase.from("agent_runs").insert({
      user_id: user.id,
      run_type: "resume_optimization",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: { skyvern_run_id: skyvernRunId, resume_id: resumeId },
    });

    return new Response(JSON.stringify({
      status: "started",
      taskId: task.id,
      skyvernRunId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[OptimizeResume] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
