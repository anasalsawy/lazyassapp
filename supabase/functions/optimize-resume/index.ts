import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const QUALITY_GATE = 90;
const MAX_ROUNDS = 6; // Reduced to stay within time budget
const AI_BASE = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(apiKey: string, model: string, messages: any[]): Promise<string> {
  const res = await fetch(AI_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJSON(raw: string): any {
  const match = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error("No JSON found in AI response");
  return JSON.parse(match[1]);
}

function buildHTML(r: any): string {
  const skills = [...(r.skills?.technical || []), ...(r.skills?.soft || [])];
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 820px; margin: 0 auto; padding: 40px; }
  .header { border-bottom: 3px solid #4f46e5; padding-bottom: 20px; margin-bottom: 28px; }
  .name { font-size: 30px; font-weight: 800; color: #1e1b4b; letter-spacing: -0.5px; }
  .title { font-size: 17px; color: #4f46e5; font-weight: 600; margin: 4px 0; }
  .contact { font-size: 13px; color: #6b7280; margin-top: 6px; }
  .summary { font-style: italic; color: #374151; margin: 0 0 24px; line-height: 1.7; }
  .section { margin-bottom: 26px; }
  .section-title { font-size: 13px; font-weight: 700; color: #4f46e5; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 14px; }
  .skill-wrap { display: flex; flex-wrap: wrap; gap: 7px; }
  .skill { background: #ede9fe; color: #4f46e5; padding: 3px 11px; border-radius: 99px; font-size: 12px; font-weight: 500; }
  .job { margin-bottom: 18px; }
  .job-header { display: flex; justify-content: space-between; align-items: baseline; }
  .job-title { font-weight: 700; color: #111827; }
  .job-company { color: #4f46e5; font-weight: 500; }
  .job-date { font-size: 13px; color: #9ca3af; }
  ul { margin: 6px 0 0 18px; padding: 0; }
  li { margin-bottom: 4px; font-size: 14px; }
</style>
</head>
<body>
<div class="header">
  <div class="name">${r.header?.name || ""}</div>
  <div class="title">${r.header?.title || ""}</div>
  <div class="contact">${[r.header?.email, r.header?.phone, r.header?.location, r.header?.linkedin].filter(Boolean).join(" · ")}</div>
</div>
${r.header?.summary ? `<p class="summary">${r.header.summary}</p>` : ""}
${skills.length ? `<div class="section"><div class="section-title">Skills</div><div class="skill-wrap">${skills.map((s: string) => `<span class="skill">${s}</span>`).join("")}</div></div>` : ""}
${r.experience?.length ? `<div class="section"><div class="section-title">Experience</div>${r.experience.map((j: any) => `
  <div class="job">
    <div class="job-header">
      <div><span class="job-title">${j.title}</span> · <span class="job-company">${j.company}</span>${j.location ? ` · ${j.location}` : ""}</div>
      <span class="job-date">${j.startDate} – ${j.endDate}</span>
    </div>
    <ul>${(j.bullets || []).map((b: string) => `<li>${b}</li>`).join("")}</ul>
  </div>`).join("")}</div>` : ""}
${r.education?.length ? `<div class="section"><div class="section-title">Education</div>${r.education.map((e: any) => `
  <div class="job">
    <div class="job-header">
      <div><span class="job-title">${e.degree} in ${e.field}</span> · <span class="job-company">${e.institution}</span></div>
      <span class="job-date">${e.graduationDate}</span>
    </div>
  </div>`).join("")}</div>` : ""}
${r.projects?.length ? `<div class="section"><div class="section-title">Projects</div>${r.projects.map((p: any) => `
  <div class="job">
    <div class="job-title">${p.name}</div>
    <p style="font-size:13px;margin:4px 0;">${p.description}</p>
    ${p.technologies?.length ? `<div class="skill-wrap">${p.technologies.map((t: string) => `<span class="skill">${t}</span>`).join("")}</div>` : ""}
  </div>`).join("")}</div>` : ""}
</body>
</html>`;
}

function buildATSText(r: any): string {
  const lines: string[] = [];
  if (r.header) {
    lines.push(r.header.name || "");
    if (r.header.title) lines.push(r.header.title);
    lines.push([r.header.email, r.header.phone, r.header.location].filter(Boolean).join(" | "));
    if (r.header.linkedin) lines.push(r.header.linkedin);
    if (r.header.summary) { lines.push(""); lines.push("SUMMARY"); lines.push(r.header.summary); }
  }
  const allSkills = [...(r.skills?.technical || []), ...(r.skills?.soft || [])];
  if (allSkills.length) { lines.push(""); lines.push("SKILLS"); lines.push(allSkills.join(", ")); }
  if (r.experience?.length) {
    lines.push(""); lines.push("EXPERIENCE");
    for (const j of r.experience) {
      lines.push(`${j.title} | ${j.company} | ${j.startDate} – ${j.endDate}`);
      for (const b of j.bullets || []) lines.push(`• ${b}`);
      lines.push("");
    }
  }
  if (r.education?.length) {
    lines.push("EDUCATION");
    for (const e of r.education) {
      lines.push(`${e.degree} in ${e.field} | ${e.institution} | ${e.graduationDate}`);
    }
  }
  return lines.join("\n");
}

// The heavy pipeline — runs in background via waitUntil
async function runPipeline(supabase: any, userId: string, resumeId: string, apiKey: string) {
  try {
    // Mark as running
    await supabase.from("agent_tasks").update({ status: "running", started_at: new Date().toISOString() })
      .eq("user_id", userId).eq("task_type", "optimize_resume").eq("payload->resumeId", resumeId).eq("status", "pending");

    // Load resume
    const { data: resume, error: resumeErr } = await supabase
      .from("resumes").select("*").eq("id", resumeId).eq("user_id", userId).single();
    if (resumeErr || !resume) throw new Error("Resume not found");

    const rawText: string =
      resume.parsed_content?.rawText ||
      resume.parsed_content?.fullText ||
      resume.parsed_content?.text || "";
    if (!rawText || rawText.length < 50) throw new Error("Resume text is empty — please re-upload the file.");

    const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", userId).single();

    // Update progress
    const updateProgress = async (stage: string, round = 0, score = 0) => {
      await supabase.from("agent_tasks").update({
        status: "running",
        result: { stage, round, score },
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("task_type", "optimize_resume").eq("payload->resumeId", resumeId).eq("status", "running");
    };

    // STEP 1: RESEARCHER
    await updateProgress("researcher");
    console.log("[OptimizeResume] STEP 1: Researcher");

    const researcherPrompt = `You are the Researcher agent for a resume optimization pipeline. Your job is to produce a machine-executable checklist that the Writer and Critic agents will strictly follow.

Analyze this resume and produce a JSON checklist:
{
  "targetRole": string,
  "topKeywords": string[],
  "quantificationOpportunities": string[],
  "missingExperience": string[],
  "toneGuide": string,
  "atsRules": string[],
  "requiredSections": string[],
  "prohibitedPhrases": string[]
}

RESUME:
${rawText.substring(0, 5000)}

CANDIDATE INFO:
Name: ${profile?.first_name || ""} ${profile?.last_name || ""}
Email: ${profile?.email || ""}`;

    const researchRaw = await callAI(apiKey, "openai/gpt-5-mini", [
      { role: "system", content: "You are an expert career strategist and ATS optimization specialist. Return only valid JSON." },
      { role: "user", content: researcherPrompt },
    ]);

    let researchChecklist: any;
    try {
      researchChecklist = parseJSON(researchRaw);
    } catch {
      throw new Error("Researcher failed to produce valid JSON checklist");
    }

    // STEP 2/3: WRITER ↔ CRITIC loop
    let round = 0;
    let writerDraft = "";
    let criticScore = 0;
    let criticFeedback: any = null;

    while (round < MAX_ROUNDS && criticScore < QUALITY_GATE) {
      await updateProgress("writer", round + 1, criticScore);
      console.log(`[OptimizeResume] Round ${round + 1}/${MAX_ROUNDS} — score: ${criticScore}`);

      const writerSystemPrompt = `You are the Writer agent in a resume optimization pipeline.

RESEARCHER CHECKLIST:
${JSON.stringify(researchChecklist, null, 2)}

${criticFeedback ? `CRITIC FEEDBACK (apply ALL required_edits):
${JSON.stringify(criticFeedback.required_edits || [], null, 2)}` : ""}

Rules: Never fabricate facts. Quantify achievements. Incorporate all topKeywords. Remove prohibitedPhrases. Ensure requiredSections exist. Start every bullet with an action verb.

Return ONLY a JSON object:
{
  "header": { "name": string, "title": string, "email": string, "phone": string, "location": string, "linkedin": string, "summary": string },
  "skills": { "technical": string[], "soft": string[], "certifications": string[] },
  "experience": [{ "company": string, "title": string, "location": string, "startDate": string, "endDate": string, "bullets": string[] }],
  "education": [{ "institution": string, "degree": string, "field": string, "graduationDate": string, "gpa": string | null, "honors": string[] }],
  "projects": [{ "name": string, "description": string, "technologies": string[], "highlights": string[] }]
}`;

      const writerRaw = await callAI(apiKey, "openai/gpt-5-mini", [
        { role: "system", content: writerSystemPrompt },
        { role: "user", content: `RAW RESUME:\n${rawText.substring(0, 5000)}\n\nWrite the optimized resume now.` },
      ]);

      try {
        const parsed = parseJSON(writerRaw);
        writerDraft = JSON.stringify(parsed);
      } catch {
        round++;
        continue;
      }

      // Critic
      await updateProgress("critic", round + 1, criticScore);

      const criticSystemPrompt = `You are the Critic agent auditing a resume draft. Be ADVERSARIAL.

RESEARCHER CHECKLIST:
${JSON.stringify(researchChecklist, null, 2)}

RAW ORIGINAL RESUME:
${rawText.substring(0, 3000)}

Return ONLY valid JSON:
{
  "overall_score": number (0-100, give 90+ only if ALL criteria met),
  "truthfulness_pass": boolean,
  "keyword_coverage": number,
  "quantification_score": number,
  "action_verb_score": number,
  "required_edits": string[],
  "strengths": string[],
  "critical_failures": string[]
}`;

      const criticRaw = await callAI(apiKey, "openai/gpt-5-mini", [
        { role: "system", content: criticSystemPrompt },
        { role: "user", content: `WRITER DRAFT:\n${writerDraft.substring(0, 5000)}\n\nAudit this now.` },
      ]);

      let criticResult: any;
      try {
        criticResult = parseJSON(criticRaw);
        if (typeof criticResult.overall_score !== "number") throw new Error("Missing score");
      } catch {
        round++;
        continue;
      }

      criticScore = criticResult.overall_score;
      criticFeedback = criticResult;
      round++;

      if (criticScore >= QUALITY_GATE) break;
    }

    // STEP 4: DESIGNER
    let finalResume: any;
    try {
      finalResume = JSON.parse(writerDraft);
    } catch {
      throw new Error("Failed to parse final writer draft");
    }

    const htmlPreview = buildHTML(finalResume);
    const atsText = buildATSText(finalResume);

    // Persist results
    await supabase.from("resumes").update({
      ats_score: criticScore,
      skills: [...(finalResume.skills?.technical || []), ...(finalResume.skills?.soft || [])],
      parsed_content: {
        ...resume.parsed_content,
        rawText,
        optimized: finalResume,
        optimizedHtml: htmlPreview,
        optimizedAtsText: atsText,
        optimizedAt: new Date().toISOString(),
        optimizationRounds: round,
        finalScore: criticScore,
        researchChecklist,
        lastCriticFeedback: criticFeedback,
      },
    }).eq("id", resumeId);

    // Mark task done
    await supabase.from("agent_tasks").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result: {
        stage: "done",
        round,
        score: criticScore,
        qualityGatePassed: criticScore >= QUALITY_GATE,
        finalScore: criticScore,
        rounds: round,
        htmlPreview,
        atsText,
        researchChecklist,
        lastCriticFeedback: criticFeedback,
      },
    }).eq("user_id", userId).eq("task_type", "optimize_resume").eq("payload->resumeId", resumeId).eq("status", "running");

    console.log(`[OptimizeResume] Done. ${round} rounds, score ${criticScore}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[OptimizeResume] Pipeline error:", message);
    await supabase.from("agent_tasks").update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("task_type", "optimize_resume").eq("payload->resumeId", resumeId);
  }
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

    // POLL action — frontend asks for current status
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

    // START action — cancel any prior running task, enqueue new one
    await supabase.from("agent_tasks")
      .update({ status: "cancelled" })
      .eq("user_id", user.id)
      .eq("task_type", "optimize_resume")
      .in("status", ["pending", "running"])
      .contains("payload", { resumeId });

    const { data: task, error: insertErr } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      task_type: "optimize_resume",
      status: "pending",
      payload: { resumeId },
      priority: 1,
    }).select().single();

    if (insertErr) throw insertErr;

    // Run pipeline in background — returns immediately to avoid timeout
    const pipeline = runPipeline(supabase, user.id, resumeId, LOVABLE_API_KEY);
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(pipeline);
    } else {
      // Fallback: fire and forget
      pipeline.catch(console.error);
    }

    return new Response(JSON.stringify({ status: "started", taskId: task.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
