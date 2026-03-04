import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
      summary_json: { resume_id: resumeId, method: "lovable_ai_deep_research" },
    });

    const taskId = task.id;

    // Background processing
    const bgPromise = (async () => {
      try {
        await supabase.from("agent_tasks").update({
          result: { stage: "researching" },
        }).eq("id", taskId);

        // STEP 1: Deep Research — analyze the resume like ChatGPT Deep Research would
        const researchPrompt = buildResearchPrompt(rawText, userName, jobContext);
        console.log(`[OptimizeResume] Step 1: Deep Research analysis (${rawText.length} chars)`);

        const researchResult = await callAI(LOVABLE_API_KEY, researchPrompt.system, researchPrompt.user);

        await supabase.from("agent_tasks").update({
          result: { stage: "optimizing" },
        }).eq("id", taskId);

        // STEP 2: Rewrite — use the research to produce a polished, ATS-optimized resume
        console.log(`[OptimizeResume] Step 2: Resume rewrite based on research`);
        const rewritePrompt = buildRewritePrompt(rawText, researchResult, userName, jobContext);
        const optimizedText = await callAI(LOVABLE_API_KEY, rewritePrompt.system, rewritePrompt.user);

        if (!optimizedText || optimizedText.length < 200) {
          throw new Error(`AI returned insufficient output (${optimizedText?.length || 0} chars)`);
        }

        console.log(`[OptimizeResume] Optimization complete (${optimizedText.length} chars)`);

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
            researchAnalysis: researchResult,
            optimizedAt: new Date().toISOString(),
            optimizationMethod: "lovable_ai_deep_research",
          },
        }).eq("id", resumeId);

        // Mark task completed
        await supabase.from("agent_tasks").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          result: {
            stage: "done",
            optimizedText,
            researchAnalysis: researchResult,
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
              method: "lovable_ai_deep_research",
              output_chars: optimizedText.length,
              steps: ["research", "rewrite"],
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

    // @ts-ignore - EdgeRuntime.waitUntil exists in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(bgPromise);
    } else {
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

// ─── AI Call Helper ───
async function callAI(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI Gateway error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Step 1: Deep Research Prompt ───
function buildResearchPrompt(rawText: string, userName: string, jobContext: string) {
  return {
    system: `You are a senior career strategist performing deep research on a resume. Your job is to produce a comprehensive analysis that will guide a resume rewriter.

Analyze the following dimensions IN DETAIL:

1. **STRENGTHS**: What are the candidate's strongest selling points? Identify quantifiable achievements, leadership signals, technical depth, and career progression.

2. **WEAKNESSES**: What's missing or poorly communicated? Identify vague bullet points, missing metrics, gaps in storytelling, weak action verbs, buried achievements.

3. **ATS OPTIMIZATION**: Which industry-standard keywords are missing for the target role? What formatting issues would cause ATS rejection? Identify keyword gaps.

4. **STRUCTURAL ISSUES**: Is the resume well-organized? Are sections in the right order for this career stage? Is the summary/objective effective?

5. **COMPETITIVE POSITIONING**: How does this candidate compare to typical applicants for "${jobContext}"? What would make them stand out?

6. **SPECIFIC REWRITES NEEDED**: For each bullet point or section that needs improvement, provide the exact improvement with reasoning.

Be extremely thorough. This analysis drives the final output quality.`,
    user: `CANDIDATE: ${userName}
TARGET: ${jobContext}

RESUME TEXT:
${rawText.substring(0, 15000)}`,
  };
}

// ─── Step 2: Rewrite Prompt ───
function buildRewritePrompt(rawText: string, research: string, userName: string, jobContext: string) {
  return {
    system: `You are an elite resume writer with 20 years of experience placing candidates at top companies. You have received a deep research analysis of a resume. Now produce the FINAL optimized resume.

CRITICAL RULES:
- Use ONLY information from the original resume. NEVER fabricate experiences, companies, dates, degrees, or skills.
- Every bullet point must start with a powerful action verb (Led, Engineered, Optimized, Spearheaded, Architected, Delivered, etc.)
- Quantify achievements wherever the data exists (%, $, #, time saved, team size)
- Include ATS-critical keywords naturally throughout
- Use clean, scannable formatting with clear section headers
- Professional Summary should be 3-4 lines, tailored to the target role
- Order sections strategically: Summary → Experience → Skills → Education → Certifications/Projects
- Each role should have 3-5 impactful bullet points
- Remove filler words, passive voice, and generic descriptions

OUTPUT FORMAT:
Return ONLY the complete, polished resume text. No commentary, no explanations, no markdown formatting instructions. Just the resume content ready to paste into a document.`,
    user: `CANDIDATE: ${userName}
TARGET ROLE: ${jobContext}

DEEP RESEARCH ANALYSIS:
${research.substring(0, 8000)}

ORIGINAL RESUME:
${rawText.substring(0, 15000)}

Now write the final optimized resume.`,
  };
}
