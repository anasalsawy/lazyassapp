import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const QUALITY_GATE = 90; // Must hit 90+ to pass
const MAX_ROUNDS = 20;   // Hard cap on Writer↔Critic loops
const TIME_BUDGET_MS = 50_000; // Save state if < 50s remain (function timeout ~60s)

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

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
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { resumeId, continuationId } = body;

    if (!resumeId) throw new Error("resumeId is required");

    // ── Load resume ──────────────────────────────────────────────────────────
    const { data: resume, error: resumeErr } = await supabase
      .from("resumes")
      .select("*")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .single();
    if (resumeErr || !resume) throw new Error("Resume not found");

    const rawText: string =
      resume.parsed_content?.rawText ||
      resume.parsed_content?.fullText ||
      resume.parsed_content?.text ||
      "";
    if (!rawText || rawText.length < 50) throw new Error("Resume text is empty — please re-upload the file.");

    // ── Load profile ─────────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // ── Resume continuation state ────────────────────────────────────────────
    let round = 0;
    let writerDraft = "";
    let criticScore = 0;
    let criticFeedback: any = null;
    let researchChecklist: any = null;
    let resumedFromContinuation = false;

    if (continuationId) {
      const { data: cont } = await supabase
        .from("pipeline_continuations")
        .select("*")
        .eq("id", continuationId)
        .eq("user_id", user.id)
        .single();

      if (cont && cont.status === "pending") {
        const s = cont.pipeline_state as any;
        round = s.round || 0;
        writerDraft = s.writerDraft || "";
        criticScore = s.criticScore || 0;
        criticFeedback = s.criticFeedback || null;
        researchChecklist = s.researchChecklist || null;
        resumedFromContinuation = true;

        await supabase.from("pipeline_continuations").update({ status: "running" }).eq("id", continuationId);
        console.log(`[OptimizeResume] Resumed from round ${round}, score ${criticScore}`);
      }
    }

    // ── Helper: save state if running out of time ─────────────────────────────
    const maybeCheckpoint = async (): Promise<boolean> => {
      const elapsed = Date.now() - startTime;
      if (elapsed < TIME_BUDGET_MS) return false;

      console.log(`[OptimizeResume] Time budget reached at round ${round}. Checkpointing.`);
      const { data: cont } = await supabase
        .from("pipeline_continuations")
        .insert({
          user_id: user.id,
          resume_id: resumeId,
          step_name: "writer_critic_loop",
          next_step: "writer_critic_loop",
          status: "pending",
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          pipeline_state: { round, writerDraft, criticScore, criticFeedback, researchChecklist },
        })
        .select()
        .single();

      return true; // caller should return checkpoint response
    };

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: RESEARCHER — build a machine-executable checklist
    // ═══════════════════════════════════════════════════════════════════
    if (!researchChecklist) {
      console.log("[OptimizeResume] STEP 1: Researcher");

      const researcherPrompt = `You are the Researcher agent for a resume optimization pipeline. Your job is to produce a machine-executable checklist that the Writer and Critic agents will strictly follow.

Analyze this resume and produce a JSON checklist:
{
  "targetRole": string,
  "topKeywords": string[],         // 10-15 ATS keywords the role demands
  "quantificationOpportunities": string[], // areas where numbers/metrics should be added
  "missingExperience": string[],   // skills/sections that are missing or thin
  "toneGuide": string,             // e.g. "assertive, results-driven, data-forward"
  "atsRules": string[],            // formatting/content rules for ATS compliance
  "requiredSections": string[],    // sections the final resume must have
  "prohibitedPhrases": string[]    // clichés / weak phrases to eliminate
}

RESUME:
${rawText.substring(0, 5000)}

CANDIDATE INFO:
Name: ${profile?.first_name || ""} ${profile?.last_name || ""}
Email: ${profile?.email || user.email}`;

      const researchRaw = await callAI(LOVABLE_API_KEY, "openai/gpt-5-mini", [
        { role: "system", content: "You are an expert career strategist and ATS optimization specialist. Return only valid JSON." },
        { role: "user", content: researcherPrompt },
      ]);

      try {
        researchChecklist = parseJSON(researchRaw);
      } catch {
        throw new Error("Researcher failed to produce valid JSON checklist");
      }

      // Log researcher output
      await supabase.from("agent_execution_logs").insert({
        user_id: user.id,
        resume_id: resumeId,
        agent: "researcher",
        step: "checklist",
        model: "openai/gpt-5-mini",
        input: rawText.substring(0, 500),
        output: JSON.stringify(researchChecklist),
      });

      console.log(`[OptimizeResume] Researcher done. Target role: ${researchChecklist.targetRole}`);
    }

    if (await maybeCheckpoint()) {
      return new Response(JSON.stringify({ status: "checkpoint", message: "Researcher done, pipeline paused and will auto-resume." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2/3: WRITER → CRITIC adversarial loop until score ≥ QUALITY_GATE
    // ═══════════════════════════════════════════════════════════════════
    while (round < MAX_ROUNDS && criticScore < QUALITY_GATE) {
      console.log(`[OptimizeResume] Round ${round + 1}/${MAX_ROUNDS} — current score: ${criticScore}`);

      // ── WRITER ────────────────────────────────────────────────────────
      const writerSystemPrompt = `You are the Writer agent in a resume optimization pipeline. You write (or rewrite) resume content to strictly satisfy the Researcher's checklist.

RESEARCHER CHECKLIST:
${JSON.stringify(researchChecklist, null, 2)}

${criticFeedback ? `CRITIC FEEDBACK FROM LAST ROUND (you MUST apply every required_edit):
${JSON.stringify(criticFeedback, null, 2)}` : ""}

Rules:
1. Never fabricate facts, companies, dates, or achievements. Only use what is in the RAW RESUME.
2. Quantify achievements wherever the checklist identifies opportunities. Use placeholder "[X]" if the number isn't in the resume.
3. Incorporate all topKeywords naturally.
4. Remove all prohibitedPhrases.
5. Ensure all requiredSections exist.
6. Start every bullet with a strong action verb.

Return a JSON object with the full rewritten resume:
{
  "header": { "name": string, "title": string, "email": string, "phone": string, "location": string, "linkedin": string, "summary": string },
  "skills": { "technical": string[], "soft": string[], "certifications": string[] },
  "experience": [{ "company": string, "title": string, "location": string, "startDate": string, "endDate": string, "bullets": string[] }],
  "education": [{ "institution": string, "degree": string, "field": string, "graduationDate": string, "gpa": string | null, "honors": string[] }],
  "projects": [{ "name": string, "description": string, "technologies": string[], "highlights": string[] }]
}`;

      const writerRaw = await callAI(LOVABLE_API_KEY, "openai/gpt-5-mini", [
        { role: "system", content: writerSystemPrompt },
        { role: "user", content: `RAW RESUME:\n${rawText.substring(0, 5000)}\n\nWrite the optimized resume now.` },
      ]);

      try {
        const parsed = parseJSON(writerRaw);
        writerDraft = JSON.stringify(parsed);
      } catch {
        console.warn(`[OptimizeResume] Writer parse failed round ${round + 1}, retrying critic with previous draft`);
        round++;
        continue;
      }

      await supabase.from("agent_execution_logs").insert({
        user_id: user.id,
        resume_id: resumeId,
        agent: "writer",
        step: `round_${round + 1}`,
        model: "openai/gpt-5-mini",
        input: JSON.stringify(researchChecklist).substring(0, 300),
        output: writerDraft.substring(0, 1000),
      });

      if (await maybeCheckpoint()) {
        return new Response(JSON.stringify({ status: "checkpoint", message: `Writer done at round ${round + 1}, pipeline paused and will auto-resume.` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── CRITIC ────────────────────────────────────────────────────────
      const criticSystemPrompt = `You are the Critic agent in a resume optimization pipeline. You are ADVERSARIAL — assume the draft is flawed until proven otherwise.

RESEARCHER CHECKLIST (the standard the writer must meet):
${JSON.stringify(researchChecklist, null, 2)}

RAW ORIGINAL RESUME (source of truth — no fabrication allowed):
${rawText.substring(0, 3000)}

Audit the WRITER DRAFT against:
1. Truthfulness — every fact must be traceable to the RAW RESUME
2. ATS keyword coverage — all topKeywords must appear naturally
3. Quantification — did the writer address all quantificationOpportunities?
4. Prohibited phrases — none should appear
5. Section completeness — all requiredSections must exist
6. Action verbs — every bullet must start with one
7. Summary quality — concise, keyword-rich, impactful

Return ONLY valid JSON:
{
  "overall_score": number (0-100, be HARSH — only give 90+ if ALL criteria are fully met),
  "truthfulness_pass": boolean,
  "keyword_coverage": number (0-100),
  "quantification_score": number (0-100),
  "action_verb_score": number (0-100),
  "required_edits": string[] (specific, actionable instructions the writer must apply next round; empty array if score >= 90),
  "strengths": string[],
  "critical_failures": string[] (things that would cause ATS rejection or HR dismissal)
}`;

      const criticRaw = await callAI(LOVABLE_API_KEY, "openai/gpt-5-mini", [
        { role: "system", content: criticSystemPrompt },
        { role: "user", content: `WRITER DRAFT:\n${writerDraft.substring(0, 5000)}\n\nAudit this now.` },
      ]);

      let criticResult: any;
      try {
        criticResult = parseJSON(criticRaw);
        if (typeof criticResult.overall_score !== "number") throw new Error("Missing score");
      } catch {
        console.warn(`[OptimizeResume] Critic parse failed round ${round + 1}`);
        round++;
        continue;
      }

      criticScore = criticResult.overall_score;
      criticFeedback = criticResult;

      await supabase.from("agent_execution_logs").insert({
        user_id: user.id,
        resume_id: resumeId,
        agent: "critic",
        step: `round_${round + 1}`,
        model: "openai/gpt-5-mini",
        input: writerDraft.substring(0, 300),
        output: JSON.stringify(criticResult).substring(0, 1000),
        gatekeeper_json: criticResult,
      });

      console.log(`[OptimizeResume] Critic score round ${round + 1}: ${criticScore}`);

      round++;

      // If score is high enough — break out
      if (criticScore >= QUALITY_GATE) {
        console.log(`[OptimizeResume] Quality gate passed at round ${round} with score ${criticScore}!`);
        break;
      }

      if (await maybeCheckpoint()) {
        return new Response(JSON.stringify({ status: "checkpoint", round, criticScore, message: "Pipeline paused mid-loop, will auto-resume." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: DESIGNER — produce HTML and ATS text output
    // ═══════════════════════════════════════════════════════════════════
    console.log(`[OptimizeResume] STEP 4: Designer. Final score: ${criticScore}`);

    let finalResume: any;
    try {
      finalResume = JSON.parse(writerDraft);
    } catch {
      throw new Error("Failed to parse final writer draft as JSON");
    }

    // Generate clean HTML
    const htmlPreview = buildHTML(finalResume);

    // Build ATS plain text
    const atsText = buildATSText(finalResume);

    // ── Persist final optimized resume ────────────────────────────────
    await supabase
      .from("resumes")
      .update({
        ats_score: criticScore,
        skills: [
          ...(finalResume.skills?.technical || []),
          ...(finalResume.skills?.soft || []),
        ],
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
        },
      })
      .eq("id", resumeId);

    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "optimize_resume",
      log_level: "info",
      message: `Resume optimized in ${round} round(s) — final score ${criticScore}`,
      metadata: { resume_id: resumeId, rounds: round, score: criticScore, qualityGatePassed: criticScore >= QUALITY_GATE },
    });

    console.log(`[OptimizeResume] Done. ${round} rounds, score ${criticScore}`);

    return new Response(
      JSON.stringify({
        success: true,
        finalScore: criticScore,
        qualityGatePassed: criticScore >= QUALITY_GATE,
        rounds: round,
        optimizedResume: finalResume,
        htmlPreview,
        atsText,
        researchChecklist,
        lastCriticFeedback: criticFeedback,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[OptimizeResume] Fatal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HTML DESIGNER
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// ATS PLAIN TEXT
// ─────────────────────────────────────────────────────────────────────────────
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
