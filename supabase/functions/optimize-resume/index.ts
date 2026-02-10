import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════════
// AGENT SYSTEM PROMPTS (production-grade, from resume_s3_agents)
// ═══════════════════════════════════════════════════════════════════════

const RESEARCHER_PROMPT = `You are the RESEARCHER agent in a strictly controlled, multi-agent resume optimization system.
This system is executed by a Supervisor/Runner that calls three independent agent instances via API (Researcher, Writer, Critic).
Agents do NOT share a chat thread. Agents do NOT share hidden memory.
The only allowed communication between agents is via explicit artifacts (RAW_RESUME, JOB_DESCRIPTION, CHECKLIST_JSON, WRITER_DRAFT, CRITIC_SCORECARD).
You are the RESEARCHER.
You ONLY generate CHECKLIST_JSON (research checklist for resume drafting + evaluation).
You do NOT write the resume.
You do NOT critique drafts.
You do NOT design layout.
You do NOT decide pass/fail.
You produce a machine-executable checklist that downstream agents must follow.

INPUTS YOU MAY RECEIVE:
- RAW_RESUME (plain text) — The only authoritative source of candidate facts.
- JOB_DESCRIPTION (optional) — Vocabulary + requirements guidance ONLY. NOT a source of candidate facts.
- SYSTEM_CONFIG (optional) — May include target role title, location, seniority, constraints.

CORE MISSION:
Q1) "Perfect resume in general" requirements (2025–2026 reality): ATS parsing survival, recruiter scan behavior, section ordering, keyword strategy, clarity/density/signal rules, modern rejection risks, formatting constraints, credibility/risk signals.
Q2) Target-role alignment requirements from JOB_DESCRIPTION and current role-market norms: required section set, required keyword clusters + priority, skills/tools/concepts expected, high-risk terms needing RAW_RESUME support, role-specific rejection reasons, minimal data requests.

TRUTH BOUNDARY (NON-NEGOTIABLE):
- Candidate facts come only from RAW_RESUME.
- JOB_DESCRIPTION is used only to select keywords, choose section emphasis, determine clusters, identify rejection risks.
- You MUST NOT invent candidate details.
- If something is missing and matters, add it to data_requests.

ANTI-HALLUCINATION SAFEGUARDS:
- Do NOT claim "ATS systems now do X" unless broadly recognized and stable.
- Do NOT assert specific vendor requirements unless from JOB_DESCRIPTION.
- Use job_desc_evidence to cite phrases when JOB_DESCRIPTION exists.
- If JOB_DESCRIPTION absent: "job_desc_evidence": "JOB_DESCRIPTION_NOT_PROVIDED"

OUTPUT: JSON-ONLY MODE. Output ONLY valid JSON matching this schema:
{
  "schema_version": "1.0",
  "target_role": { "title": "string", "seniority": "entry|mid|senior|lead|manager|director|exec|unknown", "industry": "string", "location_context": "us|non_us|remote|unknown" },
  "resume_strategy": { "positioning_summary": "string", "top_strengths_to_emphasize": ["string"], "risk_areas_to_downplay": ["string"] },
  "required_sections": ["string"],
  "recommended_section_order": ["string"],
  "ats_rules": [{ "rule": "string", "severity": "blocking|strong|optional", "rationale": "string" }],
  "keyword_clusters": [{ "name": "string", "priority": "high|medium|low", "terms": ["string"], "where_to_use": ["summary|skills|experience_bullets|projects|education"], "safe_terms": ["string"], "high_risk_terms_require_raw_support": ["string"], "job_desc_evidence": "string" }],
  "bullet_quality_standard": { "preferred_style": "action-context-result", "tense_guidance": { "current_role": "present", "past_roles": "past" }, "avoid_phrases": ["string"] },
  "common_rejection_risks": [{ "risk": "string", "why_it_matters": "string", "mitigation": "string" }],
  "data_requests": [{ "question": "string", "why_needed": "string", "impact_if_provided": "high|medium|low" }],
  "success_criteria": { "must_have": ["string"], "nice_to_have": ["string"] },
  "notes": ["string"]
}

QUALITY REQUIREMENTS:
- required_sections: at least Header, Summary, Skills, Experience, Education.
- ats_rules: at least 8 rules, at least 3 "blocking".
- keyword_clusters: at least 6 clusters for professional roles.
- common_rejection_risks: both universal and role-specific.
- data_requests: minimal, high-yield only.

ERROR CONDITIONS:
If RAW_RESUME is missing/empty/unusable, output ONLY:
{ "error": { "code": "RAW_RESUME_MISSING", "message": "RAW_RESUME is required to generate a checklist grounded in candidate facts." } }

Produce the CHECKLIST_JSON and stop immediately.`;

const WRITER_PROMPT = `You are the WRITER agent in a multi-agent resume optimization system.
You will receive a single JSON payload as the user message containing:
- RAW_RESUME (string) — the ONLY source of truth for candidate facts
- JOB_DESCRIPTION (string|null) — vocabulary guidance only; NOT a source of truth
- CHECKLIST_JSON (object) — required sections, ATS rules, keyword clusters, risks, strategy
- PRIOR_CRITIC_SCORECARD (object|null) — Critic output from the previous round, including required_edits
- SYSTEM_CONFIG (object) — may include {"round": n}

PRIMARY LAW: TRUTH + TRACEABILITY
1) RAW_RESUME is the ONLY authoritative truth source. Every factual claim must be supported by RAW_RESUME. You may rephrase, reorganize, clarify, and compress. You may NOT invent, assume, or "fill in" facts.
2) You MUST NOT invent: Employers, facilities, departments, locations, dates, timelines, supervisors; Certifications, licenses, exam results; Tools/systems/software not in RAW_RESUME; Metrics, volumes, percentages, outcomes, awards not in RAW_RESUME; Scope-of-practice claims not supported.
3) If information is missing: Use ATS-safe placeholders in square brackets only ([PHONE] [EMAIL] [CITY, STATE] [MM/YYYY–MM/YYYY] etc.). Record missing info in CHANGELOG.
4) If RAW_RESUME is missing/empty: Output ONLY {"error":{"code":"RAW_RESUME_MISSING","message":"RAW_RESUME is required."}}

YOU MUST FOLLOW THE CHECKLIST_JSON:
- Include every section listed in CHECKLIST_JSON.required_sections
- Follow CHECKLIST_JSON.ats_rules strictly
- Integrate keyword_clusters naturally where truth-safe
If CHECKLIST_JSON is missing: Output ONLY {"error":{"code":"CHECKLIST_MISSING","message":"CHECKLIST_JSON is required."}}

CRITIC PATCHES ARE EXECUTABLE INSTRUCTIONS:
If PRIOR_CRITIC_SCORECARD exists and contains required_edits[]:
- type="remove": delete the "before" snippet
- type="replace": replace "before" with "after"
- type="add": insert "after" at specified location
- type="rewrite": rewrite preserving facts; do NOT add new facts
If a required_edit would force fabrication: do NOT fabricate; prefer placeholder or remove unsupported part; log in CHANGELOG.
Apply ONLY the most recent PRIOR_CRITIC_SCORECARD.

OUTPUT CONTENT STANDARD:
- single-column, no tables, no icons, no columns, no text boxes
- standard headings (Summary, Skills, Experience, Education, etc.)
- concise bullets, action verbs, high signal, no fluff
- do not claim measurable results unless RAW_RESUME contains them
- current role: present tense; past role: past tense

MANDATORY OUTPUT FORMAT: STRICT JSON ONLY
{
  "ATS_TEXT": "string (full ATS-safe resume in plain text)",
  "PRETTY_MD": "string (same content formatted as markdown)",
  "CHANGELOG": ["string", "..."],
  "meta": {
    "round": number|null,
    "placeholders_used": ["string"],
    "critic_edits_applied": number,
    "critic_edits_skipped_due_to_truth": number
  }
}
Stop immediately after emitting the JSON.`;

const CRITIC_PROMPT = `You are the CRITIC agent in a strictly controlled, production-grade multi-agent resume optimization system.

YOUR ROLE (NON-NEGOTIABLE):
You are adversarial by design. Assume the draft is wrong until proven otherwise.
You do NOT write resumes, rewrite sections, improve wording, redesign layout, or decide final pass/fail.
You DO: Audit truthfulness, audit checklist compliance, audit ATS safety, quantify quality, specify REQUIRED edits the Writer MUST apply, signal when progress is blocked.

INPUTS:
- RAW_RESUME: The ONLY authoritative source of candidate facts.
- CHECKLIST_JSON: Researcher output defining required_sections, keyword_clusters, ats_rules, rejection risks.
- WRITER_DRAFT: The current draft produced by the Writer (JSON with ATS_TEXT, PRETTY_MD, CHANGELOG).
- JOB_DESCRIPTION (optional): Vocabulary guidance only. NOT a source of candidate facts.
- SYSTEM_CONFIG (optional): Loop round number, thresholds.

PRIMARY LAWS:
LAW 1 — TRUTH: RAW_RESUME is the sole source of truth. Any claim not clearly supported is a truth violation. Ambiguity defaults to UNSUPPORTED.
LAW 2 — NO FABRICATION: Flag invented employers, facilities, departments, locations, dates, inflated titles, unlisted tools, unclaimed certifications, unverified metrics, independent practice claims when only "exposure/support" supported.
LAW 3 — CHECKLIST IS LAW: Every required_sections item must exist and be meaningful. Keyword clusters must be integrated semantically. ATS rules must be respected exactly.
LAW 4 — CONSERVATIVE FAILURE BIAS: If uncertain, penalize, flag, require revision.

SCORING PHILOSOPHY: Scores must be DEFENSIBLE. High scores (≥90) are RARE and must be earned. If "okay but not strong," score lower.

REQUIRED EDITS = EXECUTABLE PATCHES:
- Each edit must be atomic and minimal.
- "before" should be an exact snippet when possible.
- Do NOT require new facts. If the only fix needs missing facts → put in data_needed and recommend stop_data_needed.
- Edit types: remove, replace, add, rewrite.

DECISION LOGIC:
- "revise": issues fixable via rewriting/restructuring.
- "stop_data_needed": missing facts block progress.
- "stop_unfixable_truth": RAW_RESUME fundamentally cannot support the target role.
- "pass": ONLY when no truth violations, all required sections present and strong, ATS risks resolved, keyword coverage acceptable, signal quality high.

MANDATORY OUTPUT FORMAT (STRICT JSON ONLY):
{
  "schema_version": "1.0",
  "scores": { "overall": number, "truthfulness": number, "ats_compliance": number, "role_alignment": number, "clarity_signal": number, "keyword_coverage": number },
  "decision_recommendation": "pass"|"revise"|"stop_data_needed"|"stop_unfixable_truth",
  "blocking_issues": [{ "id": "string", "category": "truth|ats|missing_section|format|keyword|clarity", "description": "string" }],
  "non_blocking_issues": [{ "id": "string", "category": "ats|keyword|clarity|style", "description": "string" }],
  "truth_violations": [{ "id": "string", "draft_claim": "string", "why_unverifiable": "string", "recommended_fix": "remove|downgrade|rephrase_to_supported" }],
  "section_compliance": [{ "section": "string", "required": boolean, "present": boolean, "quality": "good|ok|weak|missing", "notes": "string" }],
  "keyword_cluster_coverage": [{ "cluster": "string", "priority": "high|medium|low", "coverage": "good|partial|missing", "notes": "string" }],
  "required_edits": [{ "edit_id": "string", "severity": "blocking|non_blocking", "type": "remove|replace|add|rewrite", "location": "string", "before": "string", "after": "string", "reason": "string" }],
  "data_needed": [{ "question": "string", "reason": "string", "where_it_would_help": "summary|skills|experience|education|certifications", "impact": "high|medium|low" }],
  "praise_to_preserve": ["string"],
  "notes_for_supervisor": ["string"]
}

ERROR CONDITIONS:
If RAW_RESUME missing: {"error":{"code":"RAW_RESUME_MISSING","message":"Cannot evaluate truthfulness without RAW_RESUME."}}
If CHECKLIST_JSON missing: {"error":{"code":"CHECKLIST_MISSING","message":"Cannot evaluate compliance without CHECKLIST_JSON."}}

Emit the JSON and STOP. Do not explain.`;

// ═══════════════════════════════════════════════════════════════════════
// AI CALL HELPER — supports Lovable AI gateway + OpenAI Responses API
// ═══════════════════════════════════════════════════════════════════════

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";

interface AICallConfig {
  provider: "lovable" | "openai";
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPayload: string;
  temperature?: number;
}

async function callAI(config: AICallConfig): Promise<string> {
  const { provider, apiKey, model, systemPrompt, userPayload, temperature = 0.1 } = config;

  if (provider === "openai") {
    // OpenAI Responses API (client.responses.create equivalent)
    const response = await fetch(OPENAI_RESPONSES, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: userPayload,
        temperature,
        top_p: 0.95,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) throw new Error("RATE_LIMIT");
      if (status === 402) throw new Error("CREDITS_EXHAUSTED");
      const text = await response.text();
      throw new Error(`OpenAI Responses API error ${status}: ${text}`);
    }

    const data = await response.json();
    return data.output_text || data.output?.[0]?.content?.[0]?.text || "";
  }

  // Lovable AI Gateway (Chat Completions API)
  const response = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload },
      ],
      // Note: temperature omitted for Lovable AI gateway as some models only support default
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error("RATE_LIMIT");
    if (status === 402) throw new Error("CREDITS_EXHAUSTED");
    const text = await response.text();
    throw new Error(`Lovable AI gateway error ${status}: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ═══════════════════════════════════════════════════════════════════════
// JSON PARSING & SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════════

function safeJsonParse(text: string): any {
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  // Try extracting JSON from markdown code blocks
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* fall through */ }
  }
  // Try extracting any JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error("No valid JSON found in AI response");
}

function assertResearcherSchema(obj: any): void {
  if (obj.error) throw new Error(`Researcher error: ${obj.error.message}`);
  if (!obj.schema_version) throw new Error("Missing schema_version");
  if (!obj.target_role) throw new Error("Missing target_role");
  if (!Array.isArray(obj.required_sections)) throw new Error("Missing required_sections");
  if (!Array.isArray(obj.keyword_clusters)) throw new Error("Missing keyword_clusters");
  if (!Array.isArray(obj.ats_rules)) throw new Error("Missing ats_rules");
}

function assertWriterSchema(obj: any): void {
  if (obj.error) throw new Error(`Writer error: ${obj.error.message}`);
  if (typeof obj.ATS_TEXT !== "string" || !obj.ATS_TEXT) throw new Error("Missing ATS_TEXT");
  if (typeof obj.PRETTY_MD !== "string" || !obj.PRETTY_MD) throw new Error("Missing PRETTY_MD");
  if (!Array.isArray(obj.CHANGELOG)) throw new Error("Missing CHANGELOG");
}

function assertCriticSchema(obj: any): void {
  if (obj.error) throw new Error(`Critic error: ${obj.error.message}`);
  if (!obj.scores || typeof obj.scores.overall !== "number") throw new Error("Missing scores.overall");
  if (!obj.decision_recommendation) throw new Error("Missing decision_recommendation");
  const validDecisions = ["pass", "revise", "stop_data_needed", "stop_unfixable_truth"];
  if (!validDecisions.includes(obj.decision_recommendation)) {
    throw new Error(`Invalid decision: ${obj.decision_recommendation}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SSE HELPER
// ═══════════════════════════════════════════════════════════════════════

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  type: string,
  data: Record<string, unknown>,
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
}

// ═══════════════════════════════════════════════════════════════════════
// PIPELINE STATE for manual mode persistence
// ═══════════════════════════════════════════════════════════════════════

interface PipelineState {
  rawResumeText: string;
  jobDescription: string | null;
  role: string;
  loc: string;
  checklist?: any;
  writerDraft?: any;
  scorecard?: any;
  roundsCompleted?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Determine AI provider
  const useOpenAI = !!OPENAI_API_KEY;
  const aiApiKey = useOpenAI ? OPENAI_API_KEY! : LOVABLE_API_KEY!;
  const aiProvider: "openai" | "lovable" = useOpenAI ? "openai" : "lovable";

  if (!aiApiKey) {
    return new Response(
      JSON.stringify({ error: "AI service not configured. Set LOVABLE_API_KEY or OPENAI_API_KEY." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Model selection per provider
  const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1";
  const OPENAI_TEMPERATURE = parseFloat(Deno.env.get("OPENAI_TEMPERATURE") || "0.1");

  const RESEARCHER_MODEL = useOpenAI ? OPENAI_MODEL : "google/gemini-3-flash-preview";
  const WRITER_MODEL = useOpenAI ? OPENAI_MODEL : "google/gemini-2.5-flash";
  const CRITIC_MODEL = useOpenAI ? OPENAI_MODEL : "google/gemini-3-flash-preview";
  const BASE_TEMP = useOpenAI ? OPENAI_TEMPERATURE : 0.1;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { resumeId, targetRole, location, jobDescription, manual_mode, continuation_id } = body;

  if (!resumeId) {
    return new Response(JSON.stringify({ error: "resumeId is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const MAX_WRITER_CRITIC_ROUNDS = 100;
  const EARLY_EXIT_SCORE = 90; // Accept draft if overall score >= this
  const TIME_BUDGET_MS = 110_000; // 110s budget — leave ~40s margin for save + response
  const pipelineStartTime = Date.now();

  // ── Audit logger ────────────────────────────────────────────────────
  async function logExecution(step: string, agent: string, model: string, input: string, output: string, extra?: any) {
    try {
      await supabase.from("agent_execution_logs").insert({
        user_id: user!.id, resume_id: resumeId, step, agent, model,
        input: input.substring(0, 10000), output: output.substring(0, 10000),
        gatekeeper_json: extra ?? null,
      });
    } catch (e) { console.error("Failed to log execution:", e); }
  }

  // ── Continuation helpers ────────────────────────────────────────────
  async function saveContinuation(stepName: string, nextStep: string, state: PipelineState): Promise<string> {
    await supabase.from("pipeline_continuations")
      .update({ status: "expired" })
      .eq("user_id", user!.id).eq("resume_id", resumeId).eq("status", "awaiting_continue");

    const { data, error } = await supabase.from("pipeline_continuations")
      .insert({ user_id: user!.id, resume_id: resumeId, step_name: stepName, next_step: nextStep, pipeline_state: state as any, status: "awaiting_continue" })
      .select("id").single();
    if (error) throw new Error(`Failed to save continuation: ${error.message}`);
    return data.id;
  }

  async function loadContinuation(contId: string) {
    const { data, error } = await supabase.from("pipeline_continuations")
      .select("*").eq("id", contId).eq("user_id", user!.id).eq("status", "awaiting_continue").single();
    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) {
      await supabase.from("pipeline_continuations").update({ status: "expired" }).eq("id", contId);
      return null;
    }
    await supabase.from("pipeline_continuations").update({ status: "consumed" }).eq("id", contId);
    return data;
  }

  // ── SSE streaming response ──────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── Determine start point ─────────────────────────────────────
        let resumeFromStep: string | null = null;
        let pipelineState: PipelineState | null = null;

        if (continuation_id) {
          const cont = await loadContinuation(continuation_id);
          if (!cont) {
            sendSSE(controller, encoder, "error", { message: "Continuation not found or expired. Please restart optimization." });
            controller.close(); return;
          }
          resumeFromStep = cont.next_step;
          pipelineState = cont.pipeline_state as PipelineState;
          sendSSE(controller, encoder, "progress", { step: "resuming", message: `Resuming from ${resumeFromStep?.replace(/_/g, " ")}...` });
        }

        // ── Initialize artifacts ──────────────────────────────────────
        let rawResumeText = pipelineState?.rawResumeText || "";
        let jd = pipelineState?.jobDescription ?? jobDescription ?? null;
        let role = pipelineState?.role || "";
        let loc = pipelineState?.loc || "";
        let checklist = pipelineState?.checklist || null;
        let writerDraft: any = pipelineState?.writerDraft || null;
        let scorecard: any = pipelineState?.scorecard || null;
        let roundsCompleted = pipelineState?.roundsCompleted || 0;

        // ── 1. Fetch resume (fresh start only) ────────────────────────
        if (!resumeFromStep) {
          sendSSE(controller, encoder, "progress", { step: "init", message: "Loading your resume..." });

          const { data: resume, error: resumeError } = await supabase
            .from("resumes").select("*").eq("id", resumeId).eq("user_id", user!.id).single();

          if (resumeError || !resume) {
            sendSSE(controller, encoder, "error", { message: "Resume not found" });
            controller.close(); return;
          }

          rawResumeText = resume.parsed_content?.rawText || resume.parsed_content?.fullText || resume.parsed_content?.text || "";

          if (!rawResumeText && resume.file_path) {
            const { data: fileData } = await supabase.storage.from("resumes").download(resume.file_path);
            if (fileData) {
              const ab = await fileData.arrayBuffer();
              const raw = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(ab));
              const matches = raw.match(/\(([^)]+)\)/g);
              if (matches) {
                rawResumeText = matches.map((m: string) => m.slice(1, -1)).filter((t: string) => t.length > 2 && /[a-zA-Z]/.test(t)).join(" ");
              }
            }
          }

          if (!rawResumeText || rawResumeText.length < 50) {
            sendSSE(controller, encoder, "error", { message: "Could not extract resume text. Please upload a .docx or text-based PDF." });
            controller.close(); return;
          }

          role = targetRole || "Professional";
          loc = location || "";
        }

        // ── STEP: RESEARCHER ──────────────────────────────────────────
        if (!resumeFromStep || resumeFromStep === "RESEARCHER") {
          sendSSE(controller, encoder, "progress", { step: "researcher", message: "Analyzing industry requirements and ATS standards..." });

          const researcherPayload = JSON.stringify({
            RAW_RESUME: rawResumeText,
            JOB_DESCRIPTION: jd,
            SYSTEM_CONFIG: { max_writer_critic_rounds: MAX_WRITER_CRITIC_ROUNDS, target_role: role, location: loc },
          });

          const researcherOutput = await callAI({
            provider: aiProvider, apiKey: aiApiKey, model: RESEARCHER_MODEL,
            systemPrompt: RESEARCHER_PROMPT, userPayload: researcherPayload, temperature: BASE_TEMP,
          });

          checklist = safeJsonParse(researcherOutput);
          assertResearcherSchema(checklist);

          await logExecution("RESEARCHER", "Researcher", RESEARCHER_MODEL, researcherPayload.substring(0, 5000), researcherOutput.substring(0, 5000));

          sendSSE(controller, encoder, "researcher_done", { message: "Industry analysis complete", checklist });

          // Manual mode pause
          if (manual_mode) {
            const contId = await saveContinuation("RESEARCHER", "WRITER_LOOP", { rawResumeText, jobDescription: jd, role, loc, checklist });
            sendSSE(controller, encoder, "await_user_continue", { step: "RESEARCHER", next_step: "WRITER_LOOP", continuation_id: contId, message: "⏸ Research complete. Awaiting your approval to proceed to writing." });
            controller.close(); return;
          }
        }

        // ── STEP: WRITER ↔ CRITIC LOOP ────────────────────────────────
        if (!resumeFromStep || resumeFromStep === "WRITER_LOOP" || resumeFromStep === "RESEARCHER") {
          let finalDecision: string | null = null;
          const startRound = roundsCompleted > 0 ? roundsCompleted + 1 : 1;

          for (let round = startRound; round <= MAX_WRITER_CRITIC_ROUNDS; round++) {
            // ── Time-budget check BEFORE starting expensive AI calls ──
            const elapsedBeforeRound = Date.now() - pipelineStartTime;
            if (round > startRound && elapsedBeforeRound > TIME_BUDGET_MS) {
              console.log(`Time budget exceeded BEFORE round ${round} (${elapsedBeforeRound}ms). Auto-saving for continuation.`);
              const contId = await saveContinuation("WRITER_CRITIC_LOOP_CHUNK", "WRITER_LOOP", {
                rawResumeText, jobDescription: jd, role, loc, checklist, writerDraft, scorecard, roundsCompleted: round - 1,
              });
              sendSSE(controller, encoder, "auto_continue", {
                step: "WRITER_CRITIC_LOOP",
                continuation_id: contId,
                rounds_so_far: round - 1,
                current_score: scorecard?.scores?.overall ?? 0,
                message: `⏳ Time budget reached before round ${round}. Auto-continuing...`,
              });
              controller.close(); return;
            }

            roundsCompleted = round;

            // ── Writer ────────────────────────────────────────────────
            sendSSE(controller, encoder, "progress", { step: "writer", round, message: `Crafting resume version ${round}...` });

            const writerPayload = JSON.stringify({
              RAW_RESUME: rawResumeText,
              JOB_DESCRIPTION: jd,
              CHECKLIST_JSON: checklist,
              PRIOR_CRITIC_SCORECARD: scorecard, // null on first round
              SYSTEM_CONFIG: { round },
            });

            const writerOutput = await callAI({
              provider: aiProvider, apiKey: aiApiKey, model: WRITER_MODEL,
              systemPrompt: WRITER_PROMPT, userPayload: writerPayload, temperature: BASE_TEMP,
            });

            writerDraft = safeJsonParse(writerOutput);
            assertWriterSchema(writerDraft);

            await logExecution(`WRITER_V${round}`, "Writer", WRITER_MODEL, writerPayload.substring(0, 5000), writerOutput.substring(0, 5000));

            sendSSE(controller, encoder, "writer_done", { round, message: `Version ${round} complete` });

            // ── Critic ────────────────────────────────────────────────
            sendSSE(controller, encoder, "progress", { step: "critic", round, message: `Adversarial review round ${round}...` });

            const criticPayload = JSON.stringify({
              RAW_RESUME: rawResumeText,
              JOB_DESCRIPTION: jd,
              CHECKLIST_JSON: checklist,
              WRITER_DRAFT: writerDraft,
              SYSTEM_CONFIG: { round },
            });

            const criticOutput = await callAI({
              provider: aiProvider, apiKey: aiApiKey, model: CRITIC_MODEL,
              systemPrompt: CRITIC_PROMPT, userPayload: criticPayload, temperature: BASE_TEMP,
            });

            scorecard = safeJsonParse(criticOutput);
            assertCriticSchema(scorecard);

            await logExecution(`CRITIC_V${round}`, "Critic", CRITIC_MODEL, criticPayload.substring(0, 5000), criticOutput.substring(0, 5000));

            sendSSE(controller, encoder, "critic_done", {
              round,
              message: `Review round ${round} scored: ${scorecard.scores.overall}/100`,
              scorecard: {
                overall_score: scorecard.scores.overall,
                ats_score: scorecard.scores.ats_compliance,
                keyword_coverage_score: scorecard.scores.keyword_coverage,
                clarity_score: scorecard.scores.clarity_signal,
                truth_violations: scorecard.truth_violations?.map((tv: any) => tv.draft_claim) || [],
                missing_sections: scorecard.section_compliance?.filter((s: any) => !s.present).map((s: any) => s.section) || [],
                missing_keyword_clusters: scorecard.keyword_cluster_coverage?.filter((k: any) => k.coverage === "missing").map((k: any) => k.cluster) || [],
                required_edits: scorecard.required_edits || [],
                must_fix_before_next_round: scorecard.blocking_issues?.map((b: any) => b.description) || [],
                praise: scorecard.praise_to_preserve || [],
              },
            });

            finalDecision = scorecard.decision_recommendation;
            console.log(`Round ${round} decision: ${finalDecision}`);

            // ── Decision routing ──────────────────────────────────────
            if (finalDecision === "pass") {
              sendSSE(controller, encoder, "progress", { step: "quality_gate", round, message: "✅ Quality threshold passed!" });
              break;
            }

            // Early exit: accept draft if score is good enough to avoid timeout on extra rounds
            if (finalDecision === "revise" && scorecard.scores.overall >= EARLY_EXIT_SCORE) {
              sendSSE(controller, encoder, "progress", { step: "quality_gate", round, message: `✅ Score ${scorecard.scores.overall} meets threshold (${EARLY_EXIT_SCORE}+). Accepting draft.` });
              break;
            }

            if (finalDecision === "stop_data_needed") {
              sendSSE(controller, encoder, "gatekeeper_blocked", {
                step: "QUALITY_GATE", blocking_issues: scorecard.data_needed?.map((d: any) => d.question) || ["Missing data blocks progress"],
                message: `⛔ Pipeline halted: missing information needed. ${scorecard.data_needed?.map((d: any) => d.question).join("; ") || ""}`,
              });
              controller.close(); return;
            }

            if (finalDecision === "stop_unfixable_truth") {
              sendSSE(controller, encoder, "gatekeeper_blocked", {
                step: "QUALITY_GATE", blocking_issues: ["Resume fundamentally cannot support the target role"],
                message: "⛔ Pipeline halted: the resume cannot be optimized for this role without significant additional experience/qualifications.",
              });
              controller.close(); return;
            }

            if (finalDecision !== "revise") {
              console.log(`Unknown decision "${finalDecision}", stopping.`);
              break;
            }

            // (Time budget is now checked at the TOP of the loop before expensive AI calls)

            // If revise and not last round, the scorecard (with required_edits) will be passed as PRIOR_CRITIC_SCORECARD next round
            if (round >= MAX_WRITER_CRITIC_ROUNDS) {
              sendSSE(controller, encoder, "progress", { step: "quality_gate", round, message: `Max rounds reached. Using best available draft (score: ${scorecard.scores.overall}).` });
            }
          }

          // Manual mode pause after writer/critic loop
          if (manual_mode) {
            const contId = await saveContinuation("WRITER_CRITIC_LOOP", "SAVE_AND_COMPLETE", { rawResumeText, jobDescription: jd, role, loc, checklist, writerDraft, scorecard, roundsCompleted });
            sendSSE(controller, encoder, "await_user_continue", { step: "WRITER_CRITIC_LOOP", next_step: "SAVE_AND_COMPLETE", continuation_id: contId, message: `⏸ Writing complete (${roundsCompleted} rounds, score: ${scorecard?.scores?.overall}). Approve to save results.` });
            controller.close(); return;
          }
        }

        // ── SAVE RESULTS & COMPLETE ───────────────────────────────────
        const optimization = {
          checklist,
          scorecard: {
            overall_score: scorecard?.scores?.overall ?? 0,
            ats_score: scorecard?.scores?.ats_compliance ?? 0,
            keyword_coverage_score: scorecard?.scores?.keyword_coverage ?? 0,
            clarity_score: scorecard?.scores?.clarity_signal ?? 0,
            truth_violations: scorecard?.truth_violations?.map((tv: any) => tv.draft_claim) || [],
            missing_sections: [],
            missing_keyword_clusters: [],
            required_edits: scorecard?.required_edits || [],
            must_fix_before_next_round: [],
            praise: scorecard?.praise_to_preserve || [],
          },
          ats_text: writerDraft?.ATS_TEXT || "",
          pretty_md: writerDraft?.PRETTY_MD || "",
          changelog: writerDraft?.CHANGELOG?.join("\n") || "",
          html: "", // No designer step
          rounds_completed: roundsCompleted,
          target_role: role,
          location: loc,
          optimized_at: new Date().toISOString(),
        };

        const { data: currentResume } = await supabase.from("resumes").select("parsed_content").eq("id", resumeId).single();

        await supabase.from("resumes").update({
          ats_score: scorecard?.scores?.ats_compliance ?? null,
          parsed_content: { ...(currentResume?.parsed_content ?? {}), rawText: rawResumeText, optimization },
        }).eq("id", resumeId);

        await supabase.from("agent_logs").insert({
          user_id: user!.id, agent_name: "resume_optimizer", log_level: "info",
          message: `Resume optimized: ${roundsCompleted} rounds, overall score: ${scorecard?.scores?.overall ?? "N/A"}`,
          metadata: { resume_id: resumeId, target_role: role, rounds: roundsCompleted, decision: scorecard?.decision_recommendation, scores: scorecard?.scores, provider: aiProvider },
        });

        sendSSE(controller, encoder, "complete", { message: "Optimization complete", optimization });
      } catch (error: unknown) {
        console.error("Optimization error:", error);
        const msg = error instanceof Error ? error.message : "Optimization failed";
        if (msg === "RATE_LIMIT") {
          sendSSE(controller, encoder, "error", { message: "Rate limit exceeded. Please try again in a moment." });
        } else if (msg === "CREDITS_EXHAUSTED") {
          sendSSE(controller, encoder, "error", { message: "AI credits exhausted. Please add more credits." });
        } else {
          sendSSE(controller, encoder, "error", { message: msg });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
});
