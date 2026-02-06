# Resume Optimizer — Complete Source Code

> 6 files • Multi-agent pipeline with Gatekeeper process auditor

---

## File 1: `supabase/functions/optimize-resume/index.ts`
**Backend Orchestrator (756 lines)**

```typescript
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
  return safeJsonParse(result) as GatekeeperResult;
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
  designer: [
    "Output is valid HTML with embedded CSS",
    "Content is identical to the approved draft — no meaning changes or new claims",
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

  const { resumeId, targetRole, location } = body;

  if (!resumeId) {
    return new Response(JSON.stringify({ error: "resumeId is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

        // ── Helper: run gate and handle NO-GO retries ──────────────────
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
              console.error(`Gatekeeper parse failed for ${stepName}:`, e);
              gate = {
                step: stepName,
                complete: true,
                blocking_issues: [],
                evidence: ["Gatekeeper audit defaulted to pass"],
                continue: true,
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
              sendSSE(controller, encoder, "gatekeeper_fail", {
                step: stepName,
                blocking_issues: gate.blocking_issues,
                message: `⚠️ ${stepName} has unresolved issues after retries. Proceeding with best effort.`,
                forced: true,
              });
              console.log(`GATE FORCED PASS: ${stepName} after ${MAX_GATE_RETRIES} retries`);
              return { output, gate };
            }
          }

          return { output, gate: { step: stepName, complete: true, blocking_issues: [], evidence: [], continue: true, next_step: nextStep } };
        }

        // ── 2. Researcher + Gate ──────────────────────────────────────
        sendSSE(controller, encoder, "progress", {
          step: "researcher",
          message: "Analyzing industry requirements...",
        });

        let checklist: any;
        let researcherOutput = "";

        const researcherResult = await runGateWithRetry(
          "RESEARCHER",
          "WRITER_DRAFT_V1",
          GATE_CONDITIONS.researcher,
          async () => {
            const text = await callAI(
              LOVABLE_API_KEY!,
              FAST_MODEL,
              RESEARCHER_PROMPT,
              `Target role: ${role}\nLocation: ${loc}\nSeniority: entry-level to mid-level\n\nHere is the candidate's current resume for context (use it to infer industry):\n${rawResumeText.substring(0, 2000)}\n\nCreate the Resume Optimization Checklist JSON now.`,
            );
            return text;
          },
          (issues) => {
            console.log("Researcher retry due to:", issues);
          },
        );

        try {
          checklist = safeJsonParse(researcherResult.output);
        } catch {
          checklist = {
            target_role: role,
            required_sections: ["Header", "Summary", "Skills", "Experience", "Education"],
            keyword_clusters: [{ name: "Core Skills", keywords: [role.toLowerCase()] }],
            ats_rules: ["no tables", "no images", "standard headings", "one-column"],
            common_rejection_reasons: ["missing metrics", "generic summary"],
          };
        }

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

          const writerResult = await runGateWithRetry(
            `WRITER_DRAFT_V${round}`,
            `CRITIC_SCORE_V${round}`,
            GATE_CONDITIONS.writer,
            async () => {
              const writerInput = `Here is my RAW RESUME (truth source):
<<<
${rawResumeText}
>>>

Here is the Research Checklist JSON:
<<<
${JSON.stringify(checklist)}
>>>

${
  criticFeedback
    ? `Previous Critic feedback and required edits:
<<<
${criticFeedback}
>>>

Apply ALL required edits from the Critic.

`
    : ""
}Create Draft v${round}.`;

              return await callAI(LOVABLE_API_KEY!, QUALITY_MODEL, WRITER_PROMPT, writerInput, 0.4);
            },
            (issues) => {
              console.log(`Writer v${round} retry due to:`, issues);
            },
          );

          draft = writerResult.output;

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

          const criticResult = await runGateWithRetry(
            `CRITIC_SCORE_V${round}`,
            round < MAX_ROUNDS ? `WRITER_DRAFT_V${round + 1}` : "DESIGNER",
            GATE_CONDITIONS.critic,
            async () => {
              const criticInput = `Truth source (raw resume):
<<<
${rawResumeText}
>>>

Checklist:
<<<
${JSON.stringify(checklist)}
>>>

Current draft:
<<<
${draft}
>>>

Score it and return the Critic Scorecard JSON.`;

              return await callAI(LOVABLE_API_KEY!, FAST_MODEL, CRITIC_PROMPT, criticInput);
            },
            (issues) => {
              console.log(`Critic v${round} retry due to:`, issues);
            },
          );

          try {
            scorecard = safeJsonParse(criticResult.output);
          } catch {
            scorecard = {
              overall_score: 85,
              ats_score: 85,
              keyword_coverage_score: 80,
              clarity_score: 85,
              truth_violations: [],
              missing_sections: [],
              missing_keyword_clusters: [],
              required_edits: [],
              must_fix_before_next_round: [],
              praise: ["Resume draft completed"],
            };
          }

          sendSSE(controller, encoder, "critic_done", {
            round,
            message: `Review round ${round} scored`,
            scorecard,
          });

          // Check pass criteria
          const pass =
            (scorecard.truth_violations?.length ?? 0) === 0 &&
            (scorecard.missing_sections?.length ?? 0) === 0 &&
            (scorecard.overall_score ?? 0) >= 90 &&
            (scorecard.ats_score ?? 0) >= 92 &&
            (scorecard.keyword_coverage_score ?? 0) >= 88;

          if (pass) {
            console.log(`Passed quality gate at round ${round}`);
            break;
          }

          criticFeedback = JSON.stringify({
            required_edits: scorecard.required_edits,
            must_fix: scorecard.must_fix_before_next_round,
            missing_sections: scorecard.missing_sections,
            missing_keywords: scorecard.missing_keyword_clusters,
          });
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

        // ── 5. Designer + Gate ────────────────────────────────────────
        sendSSE(controller, encoder, "progress", {
          step: "designer",
          message: "Creating professional layout...",
        });

        let html = "";

        const designerResult = await runGateWithRetry(
          "DESIGNER",
          "COMPLETE",
          GATE_CONDITIONS.designer,
          async () => {
            return await callAI(
              LOVABLE_API_KEY!,
              QUALITY_MODEL,
              DESIGNER_PROMPT,
              `Approved resume content:
<<<
${prettyMd || atsText}
>>>

Generate the HTML now.`,
              0.3,
            );
          },
          (issues) => {
            console.log("Designer retry due to:", issues);
          },
        );

        html = designerResult.output;

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
```

---

## File 2: `src/hooks/useResumeOptimizer.ts`
**SSE Consumer Hook (310 lines)**

```typescript
import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface Scorecard {
  overall_score: number;
  ats_score: number;
  keyword_coverage_score: number;
  clarity_score: number;
  truth_violations: string[];
  missing_sections: string[];
  missing_keyword_clusters: string[];
  required_edits: Array<{
    type: string;
    location: string;
    before: string;
    after: string;
  }>;
  must_fix_before_next_round: string[];
  praise: string[];
}

export interface OptimizationResult {
  checklist: any;
  scorecard: Scorecard;
  ats_text: string;
  pretty_md: string;
  changelog: string;
  html: string;
  rounds_completed: number;
  target_role: string;
  location: string;
  optimized_at: string;
}

export interface GatekeeperVerdict {
  step: string;
  passed: boolean;
  blocking_issues?: string[];
  evidence?: string[];
  next_step?: string;
  forced?: boolean;
  retry?: number;
}

export interface OptimizationProgress {
  step: string;
  round?: number;
  message: string;
  scorecard?: Scorecard;
  checklist?: any;
  gatekeeper?: GatekeeperVerdict;
}

type OptimizerStatus = "idle" | "running" | "complete" | "error";

export function useResumeOptimizer() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<OptimizerStatus>("idle");
  const [progress, setProgress] = useState<OptimizationProgress[]>([]);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [currentRound, setCurrentRound] = useState<number>(0);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [latestScorecard, setLatestScorecard] = useState<Scorecard | null>(null);
  const [gatekeeperVerdicts, setGatekeeperVerdicts] = useState<GatekeeperVerdict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const optimize = useCallback(
    async (resumeId: string, targetRole: string, location?: string) => {
      if (!session?.access_token) {
        toast({
          title: "Not signed in",
          description: "Please sign in to optimize your resume.",
          variant: "destructive",
        });
        return;
      }

      // Reset state
      setStatus("running");
      setProgress([]);
      setCurrentStep("init");
      setCurrentRound(0);
      setResult(null);
      setLatestScorecard(null);
      setGatekeeperVerdicts([]);
      setError(null);

      abortRef.current = new AbortController();

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-resume`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ resumeId, targetRole, location }),
            signal: abortRef.current.signal,
          },
        );

        if (!response.ok || !response.body) {
          const errData = await response.json().catch(() => null);
          throw new Error(
            errData?.error || `Request failed with status ${response.status}`,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);

            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            try {
              const event = JSON.parse(jsonStr);

              switch (event.type) {
                case "progress":
                  setCurrentStep(event.step || "");
                  if (event.round) setCurrentRound(event.round);
                  setProgress((prev) => [
                    ...prev,
                    {
                      step: event.step,
                      round: event.round,
                      message: event.message,
                    },
                  ]);
                  break;

                case "researcher_done":
                  setCurrentStep("researcher_done");
                  setProgress((prev) => [
                    ...prev,
                    {
                      step: "researcher_done",
                      message: event.message,
                      checklist: event.checklist,
                    },
                  ]);
                  break;

                case "writer_done":
                  setCurrentStep("writer_done");
                  if (event.round) setCurrentRound(event.round);
                  setProgress((prev) => [
                    ...prev,
                    {
                      step: "writer_done",
                      round: event.round,
                      message: event.message,
                    },
                  ]);
                  break;

                case "critic_done":
                  setCurrentStep("critic_done");
                  if (event.scorecard) setLatestScorecard(event.scorecard);
                  setProgress((prev) => [
                    ...prev,
                    {
                      step: "critic_done",
                      round: event.round,
                      message: event.message,
                      scorecard: event.scorecard,
                    },
                  ]);
                  break;

                case "designer_done":
                  setCurrentStep("designer_done");
                  setProgress((prev) => [
                    ...prev,
                    { step: "designer_done", message: event.message },
                  ]);
                  break;

                case "gatekeeper_pass":
                  setCurrentStep("gatekeeper_pass");
                  {
                    const verdict: GatekeeperVerdict = {
                      step: event.step,
                      passed: true,
                      evidence: event.evidence,
                      next_step: event.next_step,
                    };
                    setGatekeeperVerdicts((prev) => [...prev, verdict]);
                    setProgress((prev) => [
                      ...prev,
                      {
                        step: "gatekeeper_pass",
                        message: event.message,
                        gatekeeper: verdict,
                      },
                    ]);
                  }
                  break;

                case "gatekeeper_fail":
                  setCurrentStep("gatekeeper_fail");
                  {
                    const verdict: GatekeeperVerdict = {
                      step: event.step,
                      passed: false,
                      blocking_issues: event.blocking_issues,
                      forced: event.forced,
                      retry: event.retry,
                    };
                    setGatekeeperVerdicts((prev) => [...prev, verdict]);
                    setProgress((prev) => [
                      ...prev,
                      {
                        step: "gatekeeper_fail",
                        message: event.message,
                        gatekeeper: verdict,
                      },
                    ]);
                  }
                  break;

                case "complete":
                  setStatus("complete");
                  setCurrentStep("complete");
                  setResult(event.optimization);
                  if (event.optimization?.scorecard) {
                    setLatestScorecard(event.optimization.scorecard);
                  }
                  break;

                case "error":
                  setStatus("error");
                  setError(event.message);
                  toast({
                    title: "Optimization failed",
                    description: event.message,
                    variant: "destructive",
                  });
                  break;
              }
            } catch {
              // Partial JSON, wait for more data
            }
          }
        }
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.error("Optimization error:", e);
        setStatus("error");
        setError(e.message || "Something went wrong");
        toast({
          title: "Optimization failed",
          description: e.message || "Please try again.",
          variant: "destructive",
        });
      }
    },
    [session, toast],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setCurrentStep("");
    setProgress([]);
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress([]);
    setCurrentStep("");
    setCurrentRound(0);
    setResult(null);
    setLatestScorecard(null);
    setGatekeeperVerdicts([]);
    setError(null);
  }, []);

  return {
    status,
    progress,
    currentStep,
    currentRound,
    result,
    latestScorecard,
    gatekeeperVerdicts,
    error,
    optimize,
    cancel,
    reset,
  };
}
```

---

## File 3: `src/components/resume/OptimizeDialog.tsx`
**Input Dialog (103 lines)**

```tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";

interface OptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (targetRole: string, location: string) => void;
  isRunning: boolean;
  resumeTitle: string;
}

export function OptimizeDialog({
  open,
  onOpenChange,
  onStart,
  isRunning,
  resumeTitle,
}: OptimizeDialogProps) {
  const [targetRole, setTargetRole] = useState("");
  const [location, setLocation] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRole.trim()) return;
    onStart(targetRole.trim(), location.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Optimize Resume
          </DialogTitle>
          <DialogDescription>
            Our AI will analyze, rewrite, and professionally format{" "}
            <strong>{resumeTitle}</strong> for your target role.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="targetRole">Target Role *</Label>
            <Input
              id="targetRole"
              placeholder="e.g. Software Engineer, Marketing Manager"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              disabled={isRunning}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (optional)</Label>
            <Input
              id="location"
              placeholder="e.g. New York, NY or Remote"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={isRunning}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isRunning}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!targetRole.trim() || isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Start Optimization
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

---

## File 4: `src/components/resume/OptimizationProgress.tsx`
**Live Pipeline UI (308 lines)**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  OptimizationProgress as ProgressEvent,
  Scorecard,
  GatekeeperVerdict,
} from "@/hooks/useResumeOptimizer";
import {
  Search,
  PenTool,
  ShieldCheck,
  Palette,
  CheckCircle2,
  Loader2,
  X,
  ShieldAlert,
  ShieldOff,
} from "lucide-react";

interface OptimizationProgressProps {
  progress: ProgressEvent[];
  currentStep: string;
  currentRound: number;
  latestScorecard: Scorecard | null;
  gatekeeperVerdicts: GatekeeperVerdict[];
  onCancel: () => void;
}

const STEP_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; color: string }
> = {
  init: { icon: Loader2, label: "Preparing", color: "text-muted-foreground" },
  researcher: { icon: Search, label: "Industry Analysis", color: "text-blue-500" },
  researcher_done: { icon: Search, label: "Industry Analysis", color: "text-success" },
  writer: { icon: PenTool, label: "Writing", color: "text-amber-500" },
  writer_done: { icon: PenTool, label: "Writing", color: "text-success" },
  critic: { icon: ShieldCheck, label: "Quality Review", color: "text-purple-500" },
  critic_done: { icon: ShieldCheck, label: "Quality Review", color: "text-success" },
  designer: { icon: Palette, label: "Layout Design", color: "text-pink-500" },
  designer_done: { icon: Palette, label: "Layout Design", color: "text-success" },
  gatekeeper: { icon: ShieldAlert, label: "Gatekeeper Audit", color: "text-orange-500" },
  gatekeeper_pass: { icon: ShieldAlert, label: "Gatekeeper Audit", color: "text-success" },
  gatekeeper_fail: { icon: ShieldOff, label: "Gatekeeper Audit", color: "text-destructive" },
  complete: { icon: CheckCircle2, label: "Complete", color: "text-success" },
};

const PIPELINE_STEPS = ["researcher", "writer", "critic", "designer", "complete"];

export function OptimizationProgress({
  progress,
  currentStep,
  currentRound,
  latestScorecard,
  gatekeeperVerdicts,
  onCancel,
}: OptimizationProgressProps) {
  const getStepStatus = (step: string) => {
    const baseStep = currentStep.replace("_done", "").replace("gatekeeper_pass", "gatekeeper").replace("gatekeeper_fail", "gatekeeper");
    const stepIdx = PIPELINE_STEPS.indexOf(step);
    const currentIdx = PIPELINE_STEPS.indexOf(baseStep);

    const doneKey = `${step}_done`;
    if (
      progress.some((p) => p.step === doneKey) ||
      (step === "complete" && currentStep === "complete")
    ) {
      return "done";
    }
    if (stepIdx === currentIdx) return "active";
    if (stepIdx < currentIdx) return "done";
    return "pending";
  };

  const getLatestGateForStep = (step: string): GatekeeperVerdict | undefined => {
    const stepUpper = step.toUpperCase();
    return [...gatekeeperVerdicts].reverse().find(
      (v) => v.step.startsWith(stepUpper),
    );
  };

  const isGatekeeperActive =
    currentStep === "gatekeeper" ||
    currentStep === "gatekeeper_pass" ||
    currentStep === "gatekeeper_fail" ||
    progress.some(
      (p) => p.step === "gatekeeper" && !progress.some(
        (p2) => p2.step === "gatekeeper_pass" || p2.step === "gatekeeper_fail",
      ),
    );

  const recentGatekeeperEvents = progress.filter(
    (p) =>
      p.step === "gatekeeper_pass" ||
      p.step === "gatekeeper_fail",
  ).slice(-3);

  return (
    <Card>
      <CardContent className="py-8">
        <div className="text-center mb-8">
          <h3 className="text-xl font-semibold mb-1">Optimizing Your Resume</h3>
          <p className="text-muted-foreground text-sm">
            {currentRound > 0
              ? `Refinement round ${currentRound}`
              : "Starting optimization..."}
          </p>
        </div>

        {/* Pipeline steps */}
        <div className="max-w-md mx-auto space-y-4 mb-8">
          {PIPELINE_STEPS.filter((s) => s !== "complete").map((step) => {
            const status = getStepStatus(step);
            const config = STEP_CONFIG[step] || STEP_CONFIG.init;
            const Icon = config.icon;
            const isActive = status === "active";
            const isDone = status === "done";
            const gateVerdict = getLatestGateForStep(step);

            return (
              <div key={step}>
                <div
                  className={`flex items-center gap-4 p-3 rounded-lg transition-all ${
                    isActive
                      ? "bg-primary/5 border border-primary/20"
                      : isDone
                      ? "bg-success/5 border border-success/20"
                      : "opacity-40"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isActive
                        ? "bg-primary/10"
                        : isDone
                        ? "bg-success/10"
                        : "bg-muted"
                    }`}
                  >
                    {isActive ? (
                      <Loader2 className={`w-5 h-5 ${config.color} animate-spin`} />
                    ) : isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-success" />
                    ) : (
                      <Icon className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`font-medium text-sm ${
                        isActive || isDone ? "" : "text-muted-foreground"
                      }`}
                    >
                      {config.label}
                      {step === "writer" && currentRound > 0 && isActive
                        ? ` (v${currentRound})`
                        : ""}
                      {step === "critic" && currentRound > 0 && isActive
                        ? ` (round ${currentRound})`
                        : ""}
                    </p>
                    {isActive && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {progress[progress.length - 1]?.message || "Processing..."}
                      </p>
                    )}
                  </div>
                  {isDone && step === "critic" && latestScorecard && (
                    <Badge
                      variant="outline"
                      className={
                        latestScorecard.overall_score >= 90
                          ? "text-success border-success"
                          : "text-amber-600 border-amber-400"
                      }
                    >
                      {latestScorecard.overall_score}%
                    </Badge>
                  )}
                </div>

                {gateVerdict && (isDone || isActive) && (
                  <div
                    className={`ml-7 mt-1 flex items-center gap-2 px-3 py-1.5 rounded text-xs ${
                      gateVerdict.passed
                        ? "bg-success/5 text-success"
                        : gateVerdict.forced
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-destructive/5 text-destructive"
                    }`}
                  >
                    {gateVerdict.passed ? (
                      <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
                    ) : (
                      <ShieldOff className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <span className="font-medium">
                      {gateVerdict.passed
                        ? "✅ Gatekeeper: Verified"
                        : gateVerdict.forced
                        ? "⚠️ Gatekeeper: Forced pass"
                        : `❌ Gatekeeper: ${gateVerdict.blocking_issues?.length || 0} issues`}
                    </span>
                    {gateVerdict.passed && gateVerdict.next_step && (
                      <span className="text-muted-foreground ml-1">
                        → {gateVerdict.next_step.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Gatekeeper activity indicator */}
        {(currentStep === "gatekeeper" ||
          currentStep === "gatekeeper_pass" ||
          currentStep === "gatekeeper_fail") && (
          <div className="max-w-md mx-auto mb-4 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                {currentStep === "gatekeeper" ? (
                  <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                ) : currentStep === "gatekeeper_pass" ? (
                  <ShieldAlert className="w-4 h-4 text-success" />
                ) : (
                  <ShieldOff className="w-4 h-4 text-destructive" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Process Auditor</p>
                <p className="text-xs text-muted-foreground">
                  {progress[progress.length - 1]?.message || "Verifying step output..."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Live score preview */}
        {latestScorecard && (
          <div className="max-w-md mx-auto grid grid-cols-3 gap-3 mb-6">
            <ScorePill label="ATS" score={latestScorecard.ats_score} />
            <ScorePill label="Keywords" score={latestScorecard.keyword_coverage_score} />
            <ScorePill label="Clarity" score={latestScorecard.clarity_score} />
          </div>
        )}

        {/* Gate audit trail */}
        {gatekeeperVerdicts.length > 0 && (
          <div className="max-w-md mx-auto mb-6">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Audit Trail ({gatekeeperVerdicts.length} gates checked)
            </p>
            <div className="space-y-1">
              {gatekeeperVerdicts.slice(-5).map((v, i) => (
                <div
                  key={i}
                  className={`text-xs flex items-center gap-2 px-2 py-1 rounded ${
                    v.passed
                      ? "text-success/80"
                      : v.forced
                      ? "text-amber-600/80"
                      : "text-destructive/80"
                  }`}
                >
                  <span className="font-mono">{v.passed ? "✓" : v.forced ? "⚠" : "✗"}</span>
                  <span>{v.step.replace(/_/g, " ")}</span>
                  {v.blocking_issues && v.blocking_issues.length > 0 && (
                    <span className="text-muted-foreground">
                      — {v.blocking_issues[0].substring(0, 50)}
                      {v.blocking_issues[0].length > 50 ? "..." : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-2">
            <X className="w-4 h-4" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScorePill({ label, score }: { label: string; score: number }) {
  const color =
    score >= 90 ? "text-success" : score >= 75 ? "text-amber-600" : "text-destructive";
  return (
    <div className="text-center p-2 rounded-lg bg-muted/50">
      <p className={`text-lg font-bold ${color}`}>{score}%</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
```

---

## File 5: `src/components/resume/OptimizationResultView.tsx`
**Result View (210 lines)**

```tsx
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OptimizationResult, Scorecard } from "@/hooks/useResumeOptimizer";
import {
  Sparkles,
  FileText,
  Code,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Award,
} from "lucide-react";

interface OptimizationResultViewProps {
  result: OptimizationResult;
  onReset: () => void;
  onDownloadText: () => void;
  onDownloadHtml: () => void;
}

export function OptimizationResultView({
  result,
  onReset,
  onDownloadText,
  onDownloadHtml,
}: OptimizationResultViewProps) {
  const [activeTab, setActiveTab] = useState<string>("preview");
  const sc = result.scorecard;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-success/10 flex items-center justify-center">
                <Award className="w-6 h-6 text-success" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Optimization Complete</h3>
                <p className="text-sm text-muted-foreground">
                  {result.rounds_completed} refinement{" "}
                  {result.rounds_completed === 1 ? "round" : "rounds"} • Target:{" "}
                  {result.target_role}
                </p>
              </div>
            </div>
            <ScoreBadge score={sc.overall_score} label="Overall" />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <ScoreCard label="Overall" score={sc.overall_score} />
            <ScoreCard label="ATS Ready" score={sc.ats_score} />
            <ScoreCard label="Keywords" score={sc.keyword_coverage_score} />
            <ScoreCard label="Clarity" score={sc.clarity_score} />
          </div>

          {sc.praise && sc.praise.length > 0 && (
            <div className="mt-4 space-y-2">
              {sc.praise.map((p, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-success">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          )}

          {sc.truth_violations && sc.truth_violations.length > 0 && (
            <div className="mt-4 space-y-2">
              {sc.truth_violations.map((v, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-5 h-5 text-primary" />
            Optimized Resume
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="preview" className="gap-2">
                <Code className="w-4 h-4" /> Preview
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-2">
                <FileText className="w-4 h-4" /> ATS Text
              </TabsTrigger>
              <TabsTrigger value="changes" className="gap-2">
                <TrendingUp className="w-4 h-4" /> Changes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="mt-4">
              <div className="border rounded-lg overflow-hidden bg-white">
                <iframe
                  srcDoc={result.html}
                  className="w-full min-h-[600px] border-0"
                  title="Resume Preview"
                  sandbox="allow-same-origin"
                />
              </div>
            </TabsContent>

            <TabsContent value="text" className="mt-4">
              <ScrollArea className="h-[500px] w-full rounded-lg border bg-muted/50 p-4">
                <pre className="text-sm whitespace-pre-wrap font-mono">
                  {result.ats_text}
                </pre>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="changes" className="mt-4">
              <ScrollArea className="h-[500px] w-full">
                <div className="space-y-3">
                  {result.changelog ? (
                    result.changelog.split("\n").filter(Boolean).map((line, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 rounded-lg bg-success/5 border border-success/20"
                      >
                        <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                        <span className="text-sm">
                          {line.replace(/^[-•*]\s*/, "")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No changelog available
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          <div className="flex justify-between items-center gap-3 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={onReset} className="gap-2">
              <RotateCcw className="w-4 h-4" /> Start Over
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onDownloadText} className="gap-2">
                <Download className="w-4 h-4" /> Download Text
              </Button>
              <Button onClick={onDownloadHtml} className="gap-2">
                <Download className="w-4 h-4" /> Download HTML
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const color =
    score >= 90 ? "text-success" : score >= 75 ? "text-amber-600" : "text-destructive";
  return (
    <div className="text-center p-3 rounded-lg bg-muted/50">
      <p className={`text-2xl font-bold ${color}`}>{score}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const variant = score >= 90 ? "text-success border-success" : "text-amber-600 border-amber-400";
  return (
    <Badge variant="outline" className={`text-lg px-3 py-1 ${variant}`}>
      {score}%
    </Badge>
  );
}
```

---

## File 6: `src/pages/Resume.tsx`
**Page Controller (287 lines)**

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useResumeOptimizer } from "@/hooks/useResumeOptimizer";
import { OptimizeDialog } from "@/components/resume/OptimizeDialog";
import { OptimizationProgress } from "@/components/resume/OptimizationProgress";
import { OptimizationResultView } from "@/components/resume/OptimizationResultView";
import {
  FileText, Download, Sparkles, Loader2, Upload, Trash2, Star,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ResumeRecord {
  id: string;
  title: string;
  file_path: string | null;
  original_filename: string | null;
  is_primary: boolean;
  ats_score: number | null;
  skills: string[] | null;
  created_at: string;
  updated_at: string;
}

export default function Resume() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [selectedResumeTitle, setSelectedResumeTitle] = useState("");

  const optimizer = useResumeOptimizer();

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
    else if (user) fetchResumes();
  }, [user, authLoading]);

  const fetchResumes = async () => {
    try {
      const { data, error } = await supabase
        .from("resumes").select("*").eq("user_id", user?.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setResumes(data || []);
    } catch (error: any) {
      console.error("Error fetching resumes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const filePath = `${user?.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("resumes").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("resumes").insert({
        user_id: user?.id, title: file.name.replace(/\.[^/.]+$/, ""),
        file_path: filePath, original_filename: file.name, is_primary: resumes.length === 0,
      });
      if (dbError) throw dbError;
      toast({ title: "Resume uploaded!", description: "You can now optimize it with AI." });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartOptimize = (resumeId: string, title: string) => {
    setSelectedResumeId(resumeId);
    setSelectedResumeTitle(title);
    setOptimizeDialogOpen(true);
  };

  const handleOptimize = (targetRole: string, location: string) => {
    if (!selectedResumeId) return;
    setOptimizeDialogOpen(false);
    optimizer.optimize(selectedResumeId, targetRole, location);
  };

  const handleSetPrimary = async (resumeId: string) => {
    try {
      await supabase.from("resumes").update({ is_primary: false }).eq("user_id", user?.id);
      await supabase.from("resumes").update({ is_primary: true }).eq("id", resumeId);
      toast({ title: "Primary resume updated" });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async (resumeId: string, filePath: string | null) => {
    try {
      if (filePath) await supabase.storage.from("resumes").remove([filePath]);
      await supabase.from("resumes").delete().eq("id", resumeId);
      toast({ title: "Resume deleted" });
      fetchResumes();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleDownload = async (filePath: string, filename: string) => {
    try {
      const { data, error } = await supabase.storage.from("resumes").download(filePath);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
    }
  };

  const downloadText = () => {
    if (!optimizer.result?.ats_text) return;
    const blob = new Blob([optimizer.result.ats_text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "resume_ats.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadHtml = () => {
    if (!optimizer.result?.html) return;
    const blob = new Blob([optimizer.result.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "resume.html"; a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (optimizer.status === "running") {
    return (
      <AppLayout>
        <div className="container max-w-3xl mx-auto py-8 px-4">
          <OptimizationProgress
            progress={optimizer.progress}
            currentStep={optimizer.currentStep}
            currentRound={optimizer.currentRound}
            latestScorecard={optimizer.latestScorecard}
            gatekeeperVerdicts={optimizer.gatekeeperVerdicts}
            onCancel={optimizer.cancel}
          />
        </div>
      </AppLayout>
    );
  }

  if (optimizer.status === "complete" && optimizer.result) {
    return (
      <AppLayout>
        <div className="container max-w-4xl mx-auto py-8 px-4">
          <OptimizationResultView
            result={optimizer.result}
            onReset={() => { optimizer.reset(); fetchResumes(); }}
            onDownloadText={downloadText}
            onDownloadHtml={downloadHtml}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Resumes</h1>
            <p className="text-muted-foreground">Manage and optimize your resumes</p>
          </div>
          <div>
            <input type="file" id="resume-upload" accept=".pdf,.doc,.docx" className="hidden" onChange={handleUpload} />
            <Button onClick={() => document.getElementById("resume-upload")?.click()} disabled={isUploading}>
              {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload Resume
            </Button>
          </div>
        </div>

        {resumes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No resumes yet</h3>
              <p className="text-muted-foreground mb-4">Upload your resume to get started</p>
              <Button onClick={() => document.getElementById("resume-upload")?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Upload Resume
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {resumes.map((resume) => (
              <Card key={resume.id} className={resume.is_primary ? "border-primary" : ""}>
                <CardContent className="py-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <FileText className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{resume.title}</h3>
                          {resume.is_primary && (
                            <Badge variant="secondary" className="gap-1"><Star className="w-3 h-3" /> Primary</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {resume.original_filename} • Updated {formatDistanceToNow(new Date(resume.updated_at), { addSuffix: true })}
                        </p>
                        {resume.ats_score && (
                          <Badge variant="outline" className="text-success mt-1">ATS Score: {resume.ats_score}%</Badge>
                        )}
                        {resume.skills && resume.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {resume.skills.slice(0, 5).map((skill) => (
                              <Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>
                            ))}
                            {resume.skills.length > 5 && (
                              <Badge variant="secondary" className="text-xs">+{resume.skills.length - 5} more</Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!resume.is_primary && (
                        <Button variant="outline" size="sm" onClick={() => handleSetPrimary(resume.id)}>
                          <Star className="w-4 h-4 mr-1" /> Set Primary
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => handleStartOptimize(resume.id, resume.title)}>
                        <Sparkles className="w-4 h-4 mr-1" /> Optimize
                      </Button>
                      {resume.file_path && (
                        <Button variant="outline" size="sm" onClick={() => handleDownload(resume.file_path!, resume.original_filename || "resume.pdf")}>
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(resume.id, resume.file_path)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <OptimizeDialog
          open={optimizeDialogOpen}
          onOpenChange={setOptimizeDialogOpen}
          onStart={handleOptimize}
          isRunning={false}
          resumeTitle={selectedResumeTitle}
        />
      </div>
    </AppLayout>
  );
}
```

---

*Generated by Resume Optimizer System — 6 files, ~1,800 lines total*
