import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Agent System Prompts ──────────────────────────────────────────────

const RESEARCHER_PROMPT = `You are Researcher, an ATS and labor-market analyst.
Goal: produce a Resume Optimization Checklist JSON for the given target role and location.
You MUST:
- Output ONLY valid JSON matching the Research Checklist schema below.
- Focus on 2025–2026 phrasing and ATS keyword clusters.
- No resume writing. No advice paragraphs.

Schema:
{
  "target_role": "string",
  "required_sections": ["Header", "Summary", "Skills", "Experience", "Education"],
  "keyword_clusters": [
    { "name": "cluster name", "keywords": ["keyword1", "keyword2"] }
  ],
  "ats_rules": ["no tables", "no images", "one-column preferred", "standard headings"],
  "common_rejection_reasons": ["missing metrics", "generic summary", "skills not mirrored from postings"]
}`;

const WRITER_PROMPT = `You are Writer, a resume architect and hiring manager.
Inputs you will receive:
1) the user's raw resume/CV text (truth source)
2) the Research Checklist JSON
3) optionally, previous Critic feedback

Rules:
- Do NOT invent experience, employers, dates, credentials, tools, or metrics.
- You must explicitly satisfy the checklist: include all required sections and integrate keyword clusters naturally.
- Output THREE blocks in this exact order, separated by the markers shown:

[ATS_TEXT]
(plain-text ATS-safe resume – no special formatting, standard headings)

[PRETTY_MD]
(clean markdown resume with bold, bullets, sections)

[CHANGELOG]
(bullet list of what you changed/improved)`;

const CRITIC_PROMPT = `You are Critic, a skeptical recruiter and ATS auditor.
You will be given:
- the raw resume (truth source)
- the checklist JSON
- the current draft

Your job:
- Attack weaknesses aggressively: missing sections, weak bullets, keyword gaps, ATS risks, vague claims.
- Flag any truth violations (invented items or suspicious claims not in the original).
- Return ONLY valid JSON matching the Critic Scorecard schema:
{
  "overall_score": number (0-100),
  "ats_score": number (0-100),
  "keyword_coverage_score": number (0-100),
  "clarity_score": number (0-100),
  "truth_violations": ["string"],
  "missing_sections": ["string"],
  "missing_keyword_clusters": ["string"],
  "required_edits": [
    { "type": "replace|add|remove", "location": "section name", "before": "current text", "after": "suggested text" }
  ],
  "must_fix_before_next_round": ["string"],
  "praise": ["string"]
}`;

const DESIGNER_PROMPT = `You are Designer, a typographic resume designer.
Input: an approved resume draft.
You must:
- Keep content IDENTICAL (no meaning changes, no new claims).
- Produce a single-page-feeling HTML layout with clean typography and whitespace.
- Output ONLY the full HTML with embedded CSS (no external resources).
Constraints:
- No external images.
- No tables (use flexbox/grid carefully for layout).
- Strong visual hierarchy: name, title, sections, consistent spacing.
- Professional color palette (subtle blues/grays, not garish).
- Print-friendly (no background colors on text).
- One-column layout for ATS compatibility.`;

const GATEKEEPER_PROMPT = `You are Gatekeeper, a strict process auditor.
You must enforce: NO automatic progression unless all conditions are met.

You will receive:
- step_name: the name of the step just completed
- required_conditions: a list of conditions that must be satisfied
- step_output: the actual output produced by the step agent

Your job:
1) Verify the output meets ALL required_conditions.
2) Verify the output is a concrete artifact (not vague text, not incomplete).
3) Verify the output matches the required schema/format for the step.
4) Return ONLY valid JSON matching this exact schema:
{
  "step": "STEP_NAME",
  "complete": boolean,
  "blocking_issues": ["specific issue description"],
  "evidence": ["specific evidence that condition X is met"],
  "continue": boolean,
  "next_step": "NEXT_STEP_NAME"
}

Rules:
- If ANYTHING is missing, set complete=false and continue=false.
- If complete=true, set continue=true to authorize the next step.
- Be strict. Prefer NO-GO if uncertain.
- blocking_issues must list EXACT missing items, not vague complaints.
- evidence must cite SPECIFIC parts of the output that satisfy conditions.`;

// ── Helpers ────────────────────────────────────────────────────────────

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  temperature = 0.3,
): Promise<string> {
  const response = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error("RATE_LIMIT");
    if (status === 402) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`AI gateway error: ${status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function safeJsonParse(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No valid JSON found in AI response");
}

function assertGatekeeperSchema(obj: any): void {
  const required = ["step", "complete", "blocking_issues", "evidence", "continue", "next_step"];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`Gatekeeper schema missing field: ${k}`);
  }
  if (!Array.isArray(obj.blocking_issues)) throw new Error("blocking_issues must be an array");
  if (!Array.isArray(obj.evidence)) throw new Error("evidence must be an array");
  if (typeof obj.complete !== "boolean") throw new Error("complete must be boolean");
  if (typeof obj.continue !== "boolean") throw new Error("continue must be boolean");
}

function assertCriticSchema(obj: any): void {
  const requiredNumbers = ["overall_score", "ats_score", "keyword_coverage_score", "clarity_score"];
  for (const k of requiredNumbers) {
    if (typeof obj[k] !== "number") throw new Error(`Critic schema missing numeric field: ${k}`);
  }
  const requiredArrays = ["truth_violations", "missing_sections", "missing_keyword_clusters", "required_edits", "must_fix_before_next_round", "praise"];
  for (const k of requiredArrays) {
    if (!Array.isArray(obj[k])) throw new Error(`Critic schema missing array field: ${k}`);
  }
}

function assertResearcherSchema(obj: any): void {
  if (typeof obj.target_role !== "string") throw new Error("Researcher schema missing: target_role");
  if (!Array.isArray(obj.required_sections)) throw new Error("Researcher schema missing: required_sections");
  if (!Array.isArray(obj.keyword_clusters)) throw new Error("Researcher schema missing: keyword_clusters");
  if (!Array.isArray(obj.ats_rules)) throw new Error("Researcher schema missing: ats_rules");
}

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  type: string,
  data: Record<string, unknown>,
) {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`),
  );
}

// ── Gatekeeper runner ─────────────────────────────────────────────────

interface GatekeeperResult {
  step: string;
  complete: boolean;
  blocking_issues: string[];
  evidence: string[];
  continue: boolean;
  next_step: string;
}

async function runGatekeeper(
  apiKey: string,
  model: string,
  stepName: string,
  nextStep: string,
  requiredConditions: string[],
  stepOutput: string,
): Promise<GatekeeperResult> {
  const userPrompt = `Step completed: ${stepName}
Next step (if approved): ${nextStep}

Required conditions for this step:
${requiredConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Step output:
<<<
${stepOutput.substring(0, 8000)}
>>>

Audit this output and return the Gatekeeper JSON verdict.`;

  const result = await callAI(apiKey, model, GATEKEEPER_PROMPT, userPrompt, 0.1);
  const parsed = safeJsonParse(result);
  assertGatekeeperSchema(parsed); // FIX #3: validate schema
  return parsed as GatekeeperResult;
}

// ── Gate condition definitions per step ────────────────────────────────

const GATE_CONDITIONS = {
  researcher: [
    "Output is valid JSON",
    "Contains 'target_role' string field",
    "Contains 'required_sections' array with at least Header, Summary, Skills, Experience, Education",
    "Contains 'keyword_clusters' array with at least 2 clusters, each having name and keywords",
    "Contains 'ats_rules' array with at least 3 rules",
    "Contains 'common_rejection_reasons' array",
    "Does NOT contain any resume writing or advice paragraphs — only the checklist",
  ],
  writer: [
    "Output contains [ATS_TEXT] marker followed by plain-text ATS-safe resume content",
    "Output contains [PRETTY_MD] marker followed by clean markdown resume content",
    "Output contains [CHANGELOG] marker followed by bullet list of changes",
    "All required_sections from the checklist are present in the resume",
    "No invented experience, employers, dates, credentials, or metrics (compare to raw resume)",
    "Keyword clusters from checklist are integrated naturally",
  ],
  critic: [
    "Output is valid JSON matching the Critic Scorecard schema",
    "Contains numeric scores: overall_score, ats_score, keyword_coverage_score, clarity_score (all 0-100)",
    "Contains truth_violations array (may be empty)",
    "Contains missing_sections array (may be empty)",
    "Contains missing_keyword_clusters array (may be empty)",
    "Contains required_edits array with concrete before/after patches",
    "Contains must_fix_before_next_round array",
    "Contains praise array",
    "Scores are justified — not blindly high",
  ],
  // FIX #4: Quality threshold conditions verified by Gatekeeper
  quality_threshold: [
    "truth_violations array is empty (length === 0)",
    "missing_sections array is empty (length === 0)",
    "overall_score is >= 90",
    "ats_score is >= 92",
    "keyword_coverage_score is >= 88",
  ],
  // FIX #5: Designer conditions updated to verify content drift
  designer: [
    "Output is valid HTML with embedded CSS",
    "All text content in the HTML is present in the approved content (ignoring HTML tags) — no meaning changes or new claims",
    "No bullet claims in the HTML that do not appear in the approved content",
    "Uses clean typography and visual hierarchy",
    "No external images or resources",
    "No tables — uses flexbox/grid if needed",
    "One-column layout for ATS compatibility",
    "Print-friendly design",
  ],
};

// ── Main Handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "AI service not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { resumeId, targetRole, location, manual_continue } = body;

  if (!resumeId) {
    return new Response(JSON.stringify({ error: "resumeId is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── FIX #6: Helper to log agent execution ───────────────────────────
  async function logExecution(
    userId: string,
    rId: string,
    step: string,
    agent: string,
    model: string,
    input: string,
    output: string,
    gatekeeperJson: any,
  ) {
    try {
      await supabase.from("agent_execution_logs").insert({
        user_id: userId,
        resume_id: rId,
        step,
        agent,
        model,
        input: input.substring(0, 10000), // cap storage size
        output: output.substring(0, 10000),
        gatekeeper_json: gatekeeperJson,
      });
    } catch (e) {
      console.error("Failed to log execution:", e);
    }
  }

  // ── SSE streaming response ──────────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── 1. Fetch resume ───────────────────────────────────────────
        sendSSE(controller, encoder, "progress", {
          step: "init",
          message: "Loading your resume...",
        });

        const { data: resume, error: resumeError } = await supabase
          .from("resumes")
          .select("*")
          .eq("id", resumeId)
          .eq("user_id", user.id)
          .single();

        if (resumeError || !resume) {
          sendSSE(controller, encoder, "error", { message: "Resume not found" });
          controller.close();
          return;
        }

        // Get resume text
        let rawResumeText =
          resume.parsed_content?.rawText ||
          resume.parsed_content?.fullText ||
          resume.parsed_content?.text ||
          "";

        if (!rawResumeText && resume.file_path) {
          const { data: fileData } = await supabase.storage
            .from("resumes")
            .download(resume.file_path);

          if (fileData) {
            const arrayBuffer = await fileData.arrayBuffer();
            const textDecoder = new TextDecoder("utf-8", { fatal: false });
            const raw = textDecoder.decode(new Uint8Array(arrayBuffer));
            const textMatches = raw.match(/\(([^)]+)\)/g);
            if (textMatches) {
              rawResumeText = textMatches
                .map((m: string) => m.slice(1, -1))
                .filter((t: string) => t.length > 2 && /[a-zA-Z]/.test(t))
                .join(" ");
            }
          }
        }

        if (!rawResumeText || rawResumeText.length < 50) {
          sendSSE(controller, encoder, "error", {
            message: "Could not extract resume text. Please upload a .docx or text-based PDF for best results.",
          });
          controller.close();
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const role = targetRole || "Professional";
        const loc = location || profile?.location || "";

        const FAST_MODEL = "google/gemini-3-flash-preview";
        const QUALITY_MODEL = "openai/gpt-5";
        const GATE_MODEL = "google/gemini-2.5-flash-lite";
        const MAX_ROUNDS = 4;
        const MAX_GATE_RETRIES = 2;

        // ── FIX #1: runGateWithRetry — truly blocking, no forced pass ──
        async function runGateWithRetry(
          stepName: string,
          nextStep: string,
          conditions: string[],
          getOutput: () => Promise<string>,
          onRetry: (issues: string[]) => void,
        ): Promise<{ output: string; gate: GatekeeperResult }> {
          let output = await getOutput();

          for (let attempt = 0; attempt <= MAX_GATE_RETRIES; attempt++) {
            sendSSE(controller, encoder, "progress", {
              step: "gatekeeper",
              message: `Verifying ${stepName} output...`,
              gate_step: stepName,
            });

            let gate: GatekeeperResult;
            try {
              gate = await runGatekeeper(
                LOVABLE_API_KEY!,
                GATE_MODEL,
                stepName,
                nextStep,
                conditions,
                output,
              );
            } catch (e) {
              // FIX #1A: Parse failure = NO-GO, not auto-pass
              console.error(`Gatekeeper parse/schema failed for ${stepName}:`, e);
              gate = {
                step: stepName,
                complete: false,
                blocking_issues: [`Gatekeeper response could not be parsed: ${(e as Error).message}`],
                evidence: ["Parse/schema error in Gatekeeper output"],
                continue: false,
                next_step: nextStep,
              };
            }

            if (gate.continue) {
              sendSSE(controller, encoder, "gatekeeper_pass", {
                step: stepName,
                next_step: nextStep,
                evidence: gate.evidence,
                message: `✅ ${stepName} verified. Proceeding to ${nextStep}.`,
              });
              console.log(`GATE PASS: ${stepName} → ${nextStep}`);
              return { output, gate };
            }

            // NO-GO
            console.log(`GATE FAIL (attempt ${attempt + 1}): ${stepName}`, gate.blocking_issues);

            if (attempt < MAX_GATE_RETRIES) {
              sendSSE(controller, encoder, "gatekeeper_fail", {
                step: stepName,
                blocking_issues: gate.blocking_issues,
                message: `⚠️ ${stepName} did not pass audit. Retrying... (${gate.blocking_issues.length} issues)`,
                retry: attempt + 1,
              });
              onRetry(gate.blocking_issues);
              output = await getOutput();
            } else {
              // FIX #1B: After max retries → STOP PIPELINE (no forced pass)
              sendSSE(controller, encoder, "gatekeeper_blocked", {
                step: stepName,
                blocking_issues: gate.blocking_issues,
                message: `⛔ ${stepName} blocked after ${MAX_GATE_RETRIES} retries. Pipeline halted.`,
              });
              console.log(`GATE BLOCKED: ${stepName} after ${MAX_GATE_RETRIES} retries`);
              throw new Error(`Gatekeeper blocked step: ${stepName}. Issues: ${gate.blocking_issues.join("; ")}`);
            }
          }

          // FIX #1C: Removed unconditional pass — this path throws instead
          throw new Error(`Gatekeeper exhausted retries for ${stepName}`);
        }

        // ── 2. Researcher + Gate ──────────────────────────────────────
        sendSSE(controller, encoder, "progress", {
          step: "researcher",
          message: "Analyzing industry requirements...",
        });

        let checklist: any;
        let researcherOutput = "";

        const researcherInput = `Target role: ${role}\nLocation: ${loc}\nSeniority: entry-level to mid-level\n\nHere is the candidate's current resume for context (use it to infer industry):\n${rawResumeText.substring(0, 2000)}\n\nCreate the Resume Optimization Checklist JSON now.`;

        const researcherResult = await runGateWithRetry(
          "RESEARCHER",
          "WRITER_DRAFT_V1",
          GATE_CONDITIONS.researcher,
          async () => {
            const text = await callAI(
              LOVABLE_API_KEY!,
              FAST_MODEL,
              RESEARCHER_PROMPT,
              researcherInput,
            );
            return text;
          },
          (issues) => {
            console.log("Researcher retry due to:", issues);
          },
        );

        researcherOutput = researcherResult.output;

        // FIX #2: No fallback checklist — halt if invalid
        try {
          checklist = safeJsonParse(researcherResult.output);
          assertResearcherSchema(checklist);
        } catch (e) {
          sendSSE(controller, encoder, "error", {
            message: `Researcher output was not valid JSON. Optimization halted. Please retry. (${(e as Error).message})`,
          });
          controller.close();
          return;
        }

        // FIX #6: Log researcher execution
        await logExecution(user.id, resumeId, "RESEARCHER", "Researcher", FAST_MODEL, researcherInput, researcherOutput, researcherResult.gate);

        sendSSE(controller, encoder, "researcher_done", {
          message: "Industry analysis complete",
          checklist,
        });

        // ── 3. Writer ↔ Critic loop with gates ────────────────────────
        let draft = "";
        let scorecard: any = null;
        let roundsCompleted = 0;
        let criticFeedback = "";

        for (let round = 1; round <= MAX_ROUNDS; round++) {
          roundsCompleted = round;

          // ── Writer + Gate ────────────────────────────────────────────
          sendSSE(controller, encoder, "progress", {
            step: "writer",
            round,
            message: `Crafting resume version ${round}...`,
          });

          const writerUserPrompt = `Here is my RAW RESUME (truth source):\n<<<\n${rawResumeText}\n>>>\n\nHere is the Research Checklist JSON:\n<<<\n${JSON.stringify(checklist)}\n>>>\n\n${
            criticFeedback
              ? `Previous Critic feedback and required edits:\n<<<\n${criticFeedback}\n>>>\n\nApply ALL required edits from the Critic.\n\n`
              : ""
          }Create Draft v${round}.`;

          const writerResult = await runGateWithRetry(
            `WRITER_DRAFT_V${round}`,
            `CRITIC_SCORE_V${round}`,
            GATE_CONDITIONS.writer,
            async () => {
              return await callAI(LOVABLE_API_KEY!, QUALITY_MODEL, WRITER_PROMPT, writerUserPrompt, 0.4);
            },
            (issues) => {
              console.log(`Writer v${round} retry due to:`, issues);
            },
          );

          draft = writerResult.output;

          // FIX #6: Log writer execution
          await logExecution(user.id, resumeId, `WRITER_DRAFT_V${round}`, "Writer", QUALITY_MODEL, writerUserPrompt.substring(0, 5000), draft, writerResult.gate);

          sendSSE(controller, encoder, "writer_done", {
            round,
            message: `Version ${round} complete`,
          });

          // ── Critic + Gate ────────────────────────────────────────────
          sendSSE(controller, encoder, "progress", {
            step: "critic",
            round,
            message: `Quality review round ${round}...`,
          });

          const criticUserPrompt = `Truth source (raw resume):\n<<<\n${rawResumeText}\n>>>\n\nChecklist:\n<<<\n${JSON.stringify(checklist)}\n>>>\n\nCurrent draft:\n<<<\n${draft}\n>>>\n\nScore it and return the Critic Scorecard JSON.`;

          const criticResult = await runGateWithRetry(
            `CRITIC_SCORE_V${round}`,
            round < MAX_ROUNDS ? `WRITER_DRAFT_V${round + 1}` : "QUALITY_GATE",
            GATE_CONDITIONS.critic,
            async () => {
              return await callAI(LOVABLE_API_KEY!, FAST_MODEL, CRITIC_PROMPT, criticUserPrompt);
            },
            (issues) => {
              console.log(`Critic v${round} retry due to:`, issues);
            },
          );

          // FIX #2: No fallback scorecard — halt if invalid
          try {
            scorecard = safeJsonParse(criticResult.output);
            assertCriticSchema(scorecard); // FIX #3: validate schema
          } catch (e) {
            sendSSE(controller, encoder, "error", {
              message: `Critic output was not valid JSON. Optimization halted. Please retry. (${(e as Error).message})`,
            });
            controller.close();
            return;
          }

          // FIX #6: Log critic execution
          await logExecution(user.id, resumeId, `CRITIC_SCORE_V${round}`, "Critic", FAST_MODEL, criticUserPrompt.substring(0, 5000), criticResult.output, criticResult.gate);

          sendSSE(controller, encoder, "critic_done", {
            round,
            message: `Review round ${round} scored`,
            scorecard,
          });

          // FIX #4: Quality threshold verified by Gatekeeper, not just code
          sendSSE(controller, encoder, "progress", {
            step: "quality_gate",
            round,
            message: `Auditing quality thresholds for round ${round}...`,
          });

          try {
            const qualityGateResult = await runGateWithRetry(
              "QUALITY_GATE",
              round < MAX_ROUNDS ? `WRITER_DRAFT_V${round + 1}` : "DESIGNER",
              GATE_CONDITIONS.quality_threshold,
              async () => JSON.stringify(scorecard),
              () => {
                // Quality gate retries don't re-run critic, they just re-evaluate
                console.log(`Quality gate retry for round ${round}`);
              },
            );

            // FIX #6: Log quality gate
            await logExecution(user.id, resumeId, `QUALITY_GATE_V${round}`, "Gatekeeper", GATE_MODEL, JSON.stringify(scorecard), "PASS", qualityGateResult.gate);

            console.log(`Quality gate passed at round ${round}`);
            break; // Quality passed — exit Writer↔Critic loop
          } catch {
            // Quality gate failed — continue loop if rounds remain
            if (round >= MAX_ROUNDS) {
              // Final round and quality still didn't pass — pipeline blocked
              sendSSE(controller, encoder, "gatekeeper_blocked", {
                step: "QUALITY_GATE",
                blocking_issues: ["Quality thresholds not met after maximum rounds"],
                message: `⛔ Quality thresholds not met after ${MAX_ROUNDS} rounds. Pipeline halted.`,
              });
              throw new Error(`Quality gate blocked after ${MAX_ROUNDS} rounds`);
            }

            // Prepare critic feedback for next Writer round
            criticFeedback = JSON.stringify({
              required_edits: scorecard.required_edits,
              must_fix: scorecard.must_fix_before_next_round,
              missing_sections: scorecard.missing_sections,
              missing_keywords: scorecard.missing_keyword_clusters,
            });
          }
        }

        // ── 4. Extract ATS text and Pretty MD from draft ──────────────
        let atsText = draft;
        let prettyMd = draft;
        let changelog = "";

        const atsMatch = draft.match(/\[ATS_TEXT\]\s*([\s\S]*?)(?=\[PRETTY_MD\]|$)/);
        const mdMatch = draft.match(/\[PRETTY_MD\]\s*([\s\S]*?)(?=\[CHANGELOG\]|$)/);
        const changeMatch = draft.match(/\[CHANGELOG\]\s*([\s\S]*?)$/);

        if (atsMatch) atsText = atsMatch[1].trim();
        if (mdMatch) prettyMd = mdMatch[1].trim();
        if (changeMatch) changelog = changeMatch[1].trim();

        // ── 5. Designer + Gate (FIX #5: pass approved content for drift check) ──
        sendSSE(controller, encoder, "progress", {
          step: "designer",
          message: "Creating professional layout...",
        });

        let html = "";

        const designerInput = `Approved resume content:\n<<<\n${prettyMd || atsText}\n>>>\n\nGenerate the HTML now.`;

        const approvedContent = prettyMd || atsText;

        const designerResult = await runGateWithRetry(
          "DESIGNER",
          "COMPLETE",
          GATE_CONDITIONS.designer,
          async () => {
            const rawHtml = await callAI(
              LOVABLE_API_KEY!,
              QUALITY_MODEL,
              DESIGNER_PROMPT,
              designerInput,
              0.3,
            );
            // FIX #5: Return BOTH approved content and HTML so Gatekeeper can verify drift
            return `APPROVED CONTENT:\n<<<\n${approvedContent}\n>>>\n\nDESIGNER HTML:\n<<<\n${rawHtml}\n>>>`;
          },
          (issues) => {
            console.log("Designer retry due to:", issues);
          },
        );

        // Extract just the HTML portion from the combined gate output
        const designerGateOutput = designerResult.output;
        const htmlPortionMatch = designerGateOutput.match(/DESIGNER HTML:\n<<<\n([\s\S]*?)\n>>>/);
        html = htmlPortionMatch ? htmlPortionMatch[1] : designerResult.output;

        // Extract just the HTML portion if wrapped in markdown code blocks
        const htmlMatch = html.match(/```html?\s*([\s\S]*?)```/);
        if (htmlMatch) {
          html = htmlMatch[1].trim();
        }

        if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html")) {
          const htmlStart = html.indexOf("<!DOCTYPE");
          const htmlAlt = html.indexOf("<html");
          const startIdx = htmlStart >= 0 ? htmlStart : htmlAlt;
          if (startIdx >= 0) {
            html = html.substring(startIdx);
          }
        }

        // Fallback if HTML is still invalid
        if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
          html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;line-height:1.6;color:#333;max-width:800px;margin:0 auto;padding:40px}
h1{color:#1e40af;border-bottom:2px solid #2563eb;padding-bottom:10px}
h2{color:#1e40af;font-size:16px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e5e7eb;margin-top:25px}
</style></head><body>
<pre>${atsText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body></html>`;
        }

        // FIX #6: Log designer execution
        await logExecution(user.id, resumeId, "DESIGNER", "Designer", QUALITY_MODEL, designerInput.substring(0, 5000), html.substring(0, 5000), designerResult.gate);

        sendSSE(controller, encoder, "designer_done", {
          message: "Professional layout created",
        });

        // ── 6. Save results ───────────────────────────────────────────
        const optimization = {
          checklist,
          scorecard,
          ats_text: atsText,
          pretty_md: prettyMd,
          changelog,
          html,
          rounds_completed: roundsCompleted,
          target_role: role,
          location: loc,
          optimized_at: new Date().toISOString(),
        };

        await supabase
          .from("resumes")
          .update({
            ats_score: scorecard?.ats_score ?? resume.ats_score,
            parsed_content: {
              ...(resume.parsed_content ?? {}),
              rawText: rawResumeText,
              optimization,
            },
          })
          .eq("id", resumeId);

        await supabase.from("agent_logs").insert({
          user_id: user.id,
          agent_name: "resume_optimizer",
          log_level: "info",
          message: `Resume optimized: ${roundsCompleted} rounds, ATS score: ${scorecard?.ats_score ?? "N/A"}`,
          metadata: {
            resume_id: resumeId,
            target_role: role,
            rounds: roundsCompleted,
            scores: {
              overall: scorecard?.overall_score,
              ats: scorecard?.ats_score,
              keywords: scorecard?.keyword_coverage_score,
              clarity: scorecard?.clarity_score,
            },
          },
        });

        // ── 7. Send final result ──────────────────────────────────────
        sendSSE(controller, encoder, "complete", {
          message: "Optimization complete",
          optimization,
        });
      } catch (error: unknown) {
        console.error("Optimization error:", error);
        const msg = error instanceof Error ? error.message : "Optimization failed";
        sendSSE(controller, encoder, "error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
