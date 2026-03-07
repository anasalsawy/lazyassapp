import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BRIDGE_URL = Deno.env.get("BROWSER_USE_BRIDGE_URL") || Deno.env.get("BRIDGE_URL") || "https://browser-use-bridge.onrender.com";
const BRIDGE_API_KEY = Deno.env.get("BROWSER_USE_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

      // For bridge-based tasks, results are stored directly on completion
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

    // Use Playwright bridge to search for jobs
    const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(`${jobDescription} jobs`);
    console.log(`[SearchJobsDeep] Submitting to Playwright bridge: ${BRIDGE_URL}`);

    // Create agent task first
    const { data: task, error: insertErr } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      task_type: "search_jobs_deep",
      status: "running",
      started_at: new Date().toISOString(),
      payload: { bridge_url: BRIDGE_URL, resumeSource },
      result: { stage: "searching", bridge_status: "running" },
      priority: 1,
    }).select().single();

    if (insertErr) throw insertErr;

    // Also create an agent_run for tracking
    await supabase.from("agent_runs").insert({
      user_id: user.id,
      run_type: "job_agent",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: { method: "deep_research_bridge", resumeSource },
    });

    // Fire bridge task in background
    const backgroundWork = async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (BRIDGE_API_KEY) headers["Authorization"] = `Bearer ${BRIDGE_API_KEY}`;

        const bridgeRes = await fetch(`${BRIDGE_URL.replace(/\/$/, "")}/run-task`, {
          method: "POST",
          headers,
          body: JSON.stringify({ url: searchUrl, extract_text: true }),
        });

        if (!bridgeRes.ok) {
          const errText = await bridgeRes.text();
          throw new Error(`Local/hosted Playwright bridge is not reachable: ${BRIDGE_URL} (${bridgeRes.status}): ${errText.slice(0, 200)}`);
        }

        const bridgeData = await bridgeRes.json();
        const outputText = bridgeData.content || bridgeData.extracted || "";
        const parsedJobs = parseJobsFromOutput(typeof outputText === "string" ? outputText : JSON.stringify(outputText));

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
            rawOutput: (typeof outputText === "string" ? outputText : "").substring(0, 2000),
          },
        }).eq("id", task.id);
      } catch (err) {
        console.error("[SearchJobsDeep] Bridge error:", err);
        await supabase.from("agent_tasks").update({
          status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
        }).eq("id", task.id);
      }
    };

    if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundWork());
    } else {
      backgroundWork().catch(console.error);
    }

    return new Response(JSON.stringify({
      status: "started",
      taskId: task.id,
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
 */
function parseJobsFromOutput(text: string): Array<{
  title: string; company: string; location?: string; salaryMin?: number;
  salaryMax?: number; description: string; matchReason?: string;
  requirements?: string[]; jobType?: string; matchScore?: number; url?: string;
}> {
  // Strategy 1: Try parsing as JSON array
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        return parsed.map((j: any) => ({
          title: j.title || "Unknown Position", company: j.company || "Unknown Company",
          location: j.location, salaryMin: j.salaryMin || j.salary_min,
          salaryMax: j.salaryMax || j.salary_max, description: j.description || j.summary || "",
          matchReason: j.matchReason || j.match_reason || (j.matchReasons ? j.matchReasons.join("; ") : ""),
          requirements: j.requirements || [], jobType: j.jobType || j.job_type || "full-time",
          matchScore: j.matchScore || j.match_score || 80, url: j.url || j.link || j.apply_url,
        }));
      }
    }
  } catch { /* not JSON */ }

  // Strategy 2: Try parsing as JSON objects
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
        title: j.title, company: j.company, location: j.location,
        description: j.description || "", matchReason: j.matchReason || "",
        url: j.url || j.link, matchScore: j.matchScore || 75,
      }));
    }
  } catch { /* skip */ }

  // Strategy 3: Simple text extraction
  const jobs: any[] = [];
  const lines = text.split("\n");
  let currentJob: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const titleMatch = trimmed.match(/^(?:\*{0,2})(.+?)(?:\*{0,2})\s*(?:at|@|-|–|—|\|)\s*(.+?)$/i);
    if (titleMatch && titleMatch[1].length < 100) {
      if (currentJob) jobs.push(currentJob);
      currentJob = {
        title: titleMatch[1].replace(/[*#]/g, "").trim(),
        company: titleMatch[2].replace(/[*#]/g, "").trim(),
        description: "", matchScore: 70,
      };
    } else if (currentJob && trimmed.length > 0) {
      const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch && !currentJob.url) currentJob.url = urlMatch[1];
      if (currentJob.description.length < 500) {
        currentJob.description += (currentJob.description ? " " : "") + trimmed;
      }
    }
  }
  if (currentJob) jobs.push(currentJob);

  return jobs;
}
