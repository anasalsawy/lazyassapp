import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BRIDGE_URL = Deno.env.get("BROWSER_USE_BRIDGE_URL") || Deno.env.get("BRIDGE_URL") || "https://browser-use-bridge.onrender.com";
const BRIDGE_API_KEY = Deno.env.get("BROWSER_USE_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY") || "";

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
        const buTaskId = payload?.browser_use_task_id as string;

        if (buTaskId) {
          try {
            const buRes = await fetch(
              `${BU_API_BASE}/tasks/${buTaskId}`,
              { headers: { "X-Browser-Use-API-Key": BU_API_KEY } }
            );

            if (buRes.ok) {
              const runData = await buRes.json();
              const buStatus = (runData.status || "").toLowerCase();

              const liveInfo: Record<string, unknown> = {
                stage: "searching",
                browser_use_status: buStatus,
              };

              if (runData.steps) {
                liveInfo.total_steps = runData.steps.length;
              }
              if (runData.liveUrl) {
                liveInfo.live_url = runData.liveUrl;
              }

              // Terminal: completed
              if (["completed", "finished", "success", "done"].includes(buStatus)) {
                const output = runData.output || runData.result || "";
                const outputText = typeof output === "string" ? output : JSON.stringify(output);

                const parsedJobs = parseJobsFromOutput(outputText);

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
                  },
                }).eq("id", task.id);

                return new Response(JSON.stringify({
                  status: "completed",
                  result: {
                    stage: "done",
                    jobsFound: parsedJobs.length,
                    jobsSaved: savedCount,
                  },
                }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }

              // Terminal: failed
              if (["failed", "terminated", "timed_out", "canceled", "error"].includes(buStatus)) {
                const errMsg = runData.error || runData.failure_reason || `Browser Use task ${buStatus}`;
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
            console.error("[SearchJobsDeep] Browser Use poll error:", e);
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

    // Submit to Browser Use task
    const searchTask = `Search for jobs matching this candidate profile. Resume:\n${rawText.substring(0, 4000)}\n\nJob criteria: ${jobDescription}\n\nFind at least 10 relevant job listings. For each job, extract: title, company, location, salary range, description, requirements, and application URL. Return results as a JSON array.`;

    console.log(`[SearchJobsDeep] Submitting to Browser Use`);

    const buRes = await fetch(`${BU_API_BASE}/tasks`, {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": BU_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: searchTask,
        startUrl: "https://www.google.com/search?q=" + encodeURIComponent(`${jobDescription} jobs`),
        maxSteps: 100,
      }),
    });

    if (!buRes.ok) {
      const errText = await buRes.text();
      throw new Error(`Browser Use task submission failed (${buRes.status}): ${errText}`);
    }

    const buData = await buRes.json();
    const buTaskId = buData.id;

    if (!buTaskId) {
      throw new Error("No task ID returned from Browser Use");
    }

    console.log(`[SearchJobsDeep] Browser Use task started: ${buTaskId}`);

    // Create agent task
    const { data: task, error: insertErr } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      task_type: "search_jobs_deep",
      status: "running",
      started_at: new Date().toISOString(),
      payload: { browser_use_task_id: buTaskId, resumeSource },
      result: { stage: "searching", browser_use_status: "running" },
      priority: 1,
    }).select().single();

    if (insertErr) throw insertErr;

    // Also create an agent_run for tracking
    await supabase.from("agent_runs").insert({
      user_id: user.id,
      run_type: "job_agent",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: { browser_use_task_id: buTaskId, method: "deep_research", resumeSource },
    });

    return new Response(JSON.stringify({
      status: "started",
      taskId: task.id,
      browserUseTaskId: buTaskId,
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
