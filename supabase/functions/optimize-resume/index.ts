import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const PDF_GARBAGE_MARKERS = /(endstream|endobj|xref|trailer|%pdf|reportlab pdf library)/i;

function scoreResumeTextQuality(text: string): number {
  const sample = text.slice(0, 6000);
  const words = (sample.match(/[A-Za-z]{2,}/g) || []).length;
  const readableChars = (sample.match(/[A-Za-z0-9\s.,;:()\-_'"/%]/g) || []).length;
  const readableRatio = readableChars / Math.max(sample.length, 1);

  let score = words + Math.round(readableRatio * 100);
  if (PDF_GARBAGE_MARKERS.test(sample)) score -= 500;
  if (readableRatio < 0.55) score -= 200;
  return score;
}

function getBestResumeText(parsedContent: Record<string, unknown> | null): string {
  const candidates = [
    parsedContent?.rawText,
    parsedContent?.fullText,
    parsedContent?.text,
  ]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!candidates.length) return "";

  return candidates
    .map((text) => ({ text, score: scoreResumeTextQuality(text) }))
    .sort((a, b) => b.score - a.score)[0].text;
}

function isCorruptedResumeText(text: string): boolean {
  const sample = text.slice(0, 6000);
  const words = (sample.match(/[A-Za-z]{2,}/g) || []).length;
  const readableChars = (sample.match(/[A-Za-z0-9\s.,;:()\-_'"/%]/g) || []).length;
  const readableRatio = readableChars / Math.max(sample.length, 1);
  const backslashRatio = (sample.match(/\\/g) || []).length / Math.max(sample.length, 1);
  const hasPdfGarbageMarkers = PDF_GARBAGE_MARKERS.test(sample);
  const tooFewWordsForLongText = sample.length > 300 && words < 40;

  return hasPdfGarbageMarkers || tooFewWordsForLongText || readableRatio < 0.55 || backslashRatio > 0.08;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
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
    const rawText = getBestResumeText(parsedContent);

    if (!rawText || rawText.length < 50) {
      throw new Error("Resume text is empty — please re-upload and let the analyzer extract text first.");
    }

    if (isCorruptedResumeText(rawText)) {
      throw new Error("Resume text extraction is corrupted (looks like raw PDF data). Please re-upload a clean, readable PDF or paste your resume text.");
    }

    // Load user profile for context
    const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
    const userName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "the candidate";

    // Load job preferences for context
    const { data: jobPrefs } = await supabase.from("job_preferences").select("job_titles, industries, locations").eq("user_id", user.id).single();
    const jobContext = body.jobDescription ||
      [
        jobPrefs?.job_titles?.length ? `Target roles: ${jobPrefs.job_titles.join(", ")}` : "",
        jobPrefs?.industries?.length ? `Industries: ${jobPrefs.industries.join(", ")}` : "",
        jobPrefs?.locations?.length ? `Locations: ${jobPrefs.locations.join(", ")}` : "",
      ].filter(Boolean).join(". ") || "General professional optimization";

    // Create agent task immediately
    const { data: task, error: insertErr } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      task_type: "optimize_resume",
      status: "running",
      started_at: new Date().toISOString(),
      payload: { resumeId },
      result: { stage: "analyzing" },
      priority: 1,
    }).select().single();
    if (insertErr) throw insertErr;

    // Also create an agent_run for tracking
    await supabase.from("agent_runs").insert({
      user_id: user.id,
      run_type: "resume_optimization",
      status: "running",
      started_at: new Date().toISOString(),
      summary_json: { resume_id: resumeId, method: "lovable_ai_direct" },
    });

    // Return immediately, run AI in background
    const taskId = task.id;

    // Use EdgeRuntime.waitUntil for background processing
    const bgPromise = (async () => {
      try {
        // Update stage
        await supabase.from("agent_tasks").update({
          result: { stage: "optimizing" },
        }).eq("id", taskId);

        const systemPrompt = `You are an expert resume optimization specialist. Your task is to take a resume and produce a significantly improved, ATS-optimized version.

RULES:
- ONLY use information already present in the resume. Do NOT fabricate experience, skills, companies, or dates.
- Improve wording, structure, bullet points, and keyword density for ATS systems.
- Use strong action verbs and quantify achievements where the data exists.
- Ensure clean formatting with clear section headers.
- Tailor the resume toward the target job context provided.
- Output the full optimized resume text, ready to use. No commentary, no explanations — just the resume.

TARGET JOB CONTEXT: ${jobContext}
CANDIDATE NAME: ${userName}`;

        const userPrompt = `Here is the resume to optimize:\n\n${rawText.substring(0, 12000)}`;

        console.log(`[OptimizeResume] Calling Lovable AI for resume optimization (${rawText.length} chars)`);

        const aiRes = await fetch(AI_GATEWAY, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-5",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: false,
          }),
        });

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          throw new Error(`AI Gateway error (${aiRes.status}): ${errText}`);
        }

        const aiData = await aiRes.json();
        const optimizedText = aiData.choices?.[0]?.message?.content;

        if (!optimizedText || optimizedText.length < 100) {
          throw new Error("AI returned insufficient output");
        }

        console.log(`[OptimizeResume] AI optimization complete (${optimizedText.length} chars)`);

        // Save optimized content to resume
        const { data: currentResume } = await supabase
          .from("resumes")
          .select("parsed_content")
          .eq("id", resumeId)
          .single();

        const existingContent = (currentResume?.parsed_content as Record<string, unknown>) || {};

        await supabase.from("resumes").update({
          parsed_content: {
            ...existingContent,
            optimizedText,
            optimizedAt: new Date().toISOString(),
            optimizationMethod: "lovable_ai_gpt5",
          },
        }).eq("id", resumeId);

        // Mark task completed
        await supabase.from("agent_tasks").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          result: {
            stage: "done",
            optimizedText,
            charCount: optimizedText.length,
          },
        }).eq("id", taskId);

        // Update agent_run
        await supabase.from("agent_runs")
          .update({
            status: "completed",
            ended_at: new Date().toISOString(),
            summary_json: {
              resume_id: resumeId,
              method: "lovable_ai_gpt5",
              output_chars: optimizedText.length,
            },
          })
          .eq("user_id", user.id)
          .eq("run_type", "resume_optimization")
          .eq("status", "running");

        console.log(`[OptimizeResume] Resume saved successfully`);

      } catch (bgErr: unknown) {
        const errMsg = bgErr instanceof Error ? bgErr.message : "Unknown background error";
        console.error("[OptimizeResume] Background error:", errMsg);

        await supabase.from("agent_tasks").update({
          status: "failed",
          error_message: errMsg,
          completed_at: new Date().toISOString(),
        }).eq("id", taskId);

        await supabase.from("agent_runs")
          .update({
            status: "failed",
            ended_at: new Date().toISOString(),
            error_message: errMsg,
          })
          .eq("user_id", user.id)
          .eq("run_type", "resume_optimization")
          .eq("status", "running");
      }
    })();

    if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(bgPromise);
    } else {
      // Fallback: await inline (won't time out for short AI calls)
      await bgPromise;
    }

    return new Response(JSON.stringify({
      status: "started",
      taskId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[OptimizeResume] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
