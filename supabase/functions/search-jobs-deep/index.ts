import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SKYVERN_API_BASE = "https://api.skyvern.com/v1";
const SKYVERN_WORKFLOW_ID = "wpid_498725285882867288";

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
    const { action } = body;

    // ========== POLL ==========
    if (action === "poll") {
      const { data: task } = await supabase
        .from("agent_tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("task_type", "search_jobs_deep")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!task) {
        return new Response(JSON.stringify({ status: "not_found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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

              const liveInfo: Record<string, unknown> = {
                stage: "searching",
                skyvern_status: skyvernStatus,
              };

              if (runData.steps_info) {
                liveInfo.total_steps = runData.steps_info.total;
                liveInfo.completed_steps = runData.steps_info.completed;
              }
              if (runData.recording_url) {
                liveInfo.recording_url = runData.recording_url;
              }

              // Terminal: completed
              if (["completed", "finished", "success"].includes(skyvernStatus)) {
                const output = runData.output || runData.result || "";
                const outputText = typeof output === "string" ? output : JSON.stringify(output);

                // Try to parse jobs from the output
                const parsedJobs = parseJobsFromOutput(outputText);

                // Save jobs to the jobs table
                let savedCount = 0;
                for (const job of parsedJobs) {
                  const { error: jobErr } = await supabase.from("jobs").upsert({
                    user_id: user.id,
                    external_id: job.url || `deep-${job.company}-${job.title}`.toLowerCase().replace(/\s+/g, "-"),
                    source: "deep_research",
                    title: job.title,
                    company: job.company,
                    location: job.location || null,
                    salary_min: job.salaryMin || null,
                    salary_max: job.salaryMax || null,
                    description: job.description + (job.matchReason ? `\n\nMatch Reason: ${job.matchReason}` : ""),
                    requirements: job.requirements || [],
                    job_type: job.jobType || "full-time",
                    match_score: job.matchScore || 80,
                    url: job.url || null,
                    posted_at: new Date().toISOString(),
                  }, {
                    onConflict: "user_id,external_id",
                    ignoreDuplicates: true,
                  });
                  if (!jobErr) savedCount++;
                }

                await supabase.from("agent_tasks").update({
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  result: {
                    stage: "done",
                    jobsFound: parsedJobs.length,
                    jobsSaved: savedCount,
                    rawOutput: outputText.substring(0, 2000),
                    recording_url: runData.recording_url || null,
                  },
                }).eq("id", task.id);

                return new Response(JSON.stringify({
                  status: "completed",
                  result: {
                    stage: "done",
                    jobsFound: parsedJobs.length,
                    jobsSaved: savedCount,
                    recording_url: runData.recording_url || null,
                  },
                }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }

              // Terminal: failed
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

              // Still running
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
            console.error("[SearchJobsDeep] Skyvern poll error:", e);
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
      .eq("task_type", "search_jobs_deep")
      .in("status", ["pending", "running"]);

    // Load user's primary resume — use OPTIMIZED text if available
    const { data: resume, error: resumeErr } = await supabase
      .from("resumes").select("*").eq("user_id", user.id).eq("is_primary", true).single();
    if (resumeErr || !resume) throw new Error("No primary resume found. Please upload a resume first.");

    const parsedContent = resume.parsed_content as Record<string, unknown> | null;

    // Prefer optimized resume text over raw text
    const optimizedText = parsedContent?.optimizedText as string;
    const rawText: string =
      optimizedText ||
      (parsedContent?.rawText as string) ||
      (parsedContent?.fullText as string) ||
      (parsedContent?.text as string) || "";

    if (!rawText || rawText.length < 50) {
      throw new Error("Resume text is empty — please upload and analyze your resume first.");
    }

    const resumeSource = optimizedText ? "optimized" : "raw";
    console.log(`[SearchJobsDeep] Using ${resumeSource} resume text (${rawText.length} chars)`);

    // Load user profile for context
    const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
    const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "the candidate";

    // Load job preferences for search context
    const { data: jobPrefs } = await supabase
      .from("job_preferences")
      .select("job_titles, industries, locations, remote_preference, salary_min, salary_max")
      .eq("user_id", user.id)
      .single();

    const jobDescription = body.jobDescription ||
      [
        jobPrefs?.job_titles?.length ? `Target roles: ${jobPrefs.job_titles.join(", ")}` : "",
        jobPrefs?.industries?.length ? `Industries: ${jobPrefs.industries.join(", ")}` : "",
        jobPrefs?.locations?.length ? `Locations: ${jobPrefs.locations.join(", ")}` : "",
        jobPrefs?.remote_preference ? `Remote preference: ${jobPrefs.remote_preference}` : "",
        jobPrefs?.salary_min ? `Min salary: $${jobPrefs.salary_min}` : "",
        jobPrefs?.salary_max ? `Max salary: $${jobPrefs.salary_max}` : "",
      ].filter(Boolean).join(". ") || "General job search across all industries";

    // Submit to Skyvern workflow — same parameter pattern as optimize-resume
    const navigationPayload: Record<string, string> = {
      chatgpt_credentials: "cred_498232209221167088",
      resume: rawText.substring(0, 8000),
      job_description: jobDescription,
      resume_owner_name: userName,
    };

    console.log(`[SearchJobsDeep] Submitting to Skyvern workflow ${SKYVERN_WORKFLOW_ID}`);

    const skyvernRes = await fetch(`${SKYVERN_API_BASE}/run/workflows`, {
      method: "POST",
      headers: {
        "x-api-key": SKYVERN_API_KEY,
        "Content-Type": "application/json",
        "x-max-steps-override": "150",
      },
      body: JSON.stringify({
        workflow_id: SKYVERN_WORKFLOW_ID,
        parameters: navigationPayload,
        proxy_location: "RESIDENTIAL",
        run_with: "agent",
        ai_fallback: true,
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

    console.log(`[SearchJobsDeep] Skyvern workflow started: ${skyvernRunId}`);

    // Create agent task
    const { data: task, error: insertErr } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      task_type: "search_jobs_deep",
      status: "running",
      started_at: new Date().toISOString(),
      payload: { skyvern_run_id: skyvernRunId, resumeSource },
      result: { stage: "searching", skyvern_status: "running" },
      priority: 1,
    }).select().single();

    if (insertErr) throw insertErr;

    // Also create an agent_run for tracking
    await supabase.from("agent_runs").insert({
      user_id: user.id,
      run_type: "job_agent",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: { skyvern_run_id: skyvernRunId, method: "deep_research", resumeSource },
    });

    return new Response(JSON.stringify({
      status: "started",
      taskId: task.id,
      skyvernRunId,
      resumeSource,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[SearchJobsDeep] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Parse structured job data from the Deep Research output text.
 * The output may be JSON, markdown, or plain text — we try multiple strategies.
 */
function parseJobsFromOutput(text: string): Array<{
  title: string;
  company: string;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  description: string;
  matchReason?: string;
  requirements?: string[];
  jobType?: string;
  matchScore?: number;
  url?: string;
}> {
  // Strategy 1: Try parsing as JSON array
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        return parsed.map((j: any) => ({
          title: j.title || "Unknown Position",
          company: j.company || "Unknown Company",
          location: j.location,
          salaryMin: j.salaryMin || j.salary_min,
          salaryMax: j.salaryMax || j.salary_max,
          description: j.description || j.summary || "",
          matchReason: j.matchReason || j.match_reason || (j.matchReasons ? j.matchReasons.join("; ") : ""),
          requirements: j.requirements || [],
          jobType: j.jobType || j.job_type || "full-time",
          matchScore: j.matchScore || j.match_score || 80,
          url: j.url || j.link || j.apply_url,
        }));
      }
    }
  } catch { /* not JSON */ }

  // Strategy 2: Try parsing as JSON objects (one per line or separated)
  try {
    const objects: any[] = [];
    const objectMatches = text.matchAll(/\{[^{}]{20,}\}/g);
    for (const m of objectMatches) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj.title && obj.company) objects.push(obj);
      } catch { /* skip */ }
    }
    if (objects.length > 0) {
      return objects.map((j: any) => ({
        title: j.title,
        company: j.company,
        location: j.location,
        description: j.description || "",
        matchReason: j.matchReason || "",
        url: j.url || j.link,
        matchScore: j.matchScore || 75,
      }));
    }
  } catch { /* skip */ }

  // Strategy 3: Simple text extraction — look for patterns like "Title at Company"
  const jobs: any[] = [];
  const lines = text.split("\n");
  let currentJob: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // Match patterns like "Software Engineer at Google" or "**Software Engineer** - Google"
    const titleMatch = trimmed.match(/^(?:\*{0,2})(.+?)(?:\*{0,2})\s*(?:at|@|-|–|—|\|)\s*(.+?)$/i);
    if (titleMatch && titleMatch[1].length < 100) {
      if (currentJob) jobs.push(currentJob);
      currentJob = {
        title: titleMatch[1].replace(/[*#]/g, "").trim(),
        company: titleMatch[2].replace(/[*#]/g, "").trim(),
        description: "",
        matchScore: 70,
      };
    } else if (currentJob && trimmed.length > 0) {
      // Check for URL
      const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch && !currentJob.url) {
        currentJob.url = urlMatch[1];
      }
      // Accumulate description
      if (currentJob.description.length < 500) {
        currentJob.description += (currentJob.description ? " " : "") + trimmed;
      }
    }
  }
  if (currentJob) jobs.push(currentJob);

  return jobs;
}
