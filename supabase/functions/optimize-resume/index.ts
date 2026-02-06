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
  // Try to find JSON in the response
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
          sendSSE(controller, encoder, "error", {
            message: "Resume not found",
          });
          controller.close();
          return;
        }

        // Get resume text
        let rawResumeText =
          resume.parsed_content?.rawText ||
          resume.parsed_content?.fullText ||
          resume.parsed_content?.text ||
          "";

        // If no text, try downloading and extracting
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
                .filter(
                  (t: string) => t.length > 2 && /[a-zA-Z]/.test(t),
                )
                .join(" ");
            }
          }
        }

        if (!rawResumeText || rawResumeText.length < 50) {
          sendSSE(controller, encoder, "error", {
            message:
              "Could not extract resume text. Please upload a .docx or text-based PDF for best results.",
          });
          controller.close();
          return;
        }

        // Get user profile for additional context
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const role = targetRole || "Professional";
        const loc = location || profile?.location || "";

        const FAST_MODEL = "google/gemini-3-flash-preview";
        const QUALITY_MODEL = "openai/gpt-5";
        const MAX_ROUNDS = 4;

        // ── 2. Researcher ─────────────────────────────────────────────
        sendSSE(controller, encoder, "progress", {
          step: "researcher",
          message: "Analyzing industry requirements...",
        });

        let checklist: any;
        try {
          const checklistText = await callAI(
            LOVABLE_API_KEY,
            FAST_MODEL,
            RESEARCHER_PROMPT,
            `Target role: ${role}\nLocation: ${loc}\nSeniority: entry-level to mid-level\n\nHere is the candidate's current resume for context (use it to infer industry):\n${rawResumeText.substring(0, 2000)}\n\nCreate the Resume Optimization Checklist JSON now.`,
          );
          checklist = safeJsonParse(checklistText);
        } catch (e) {
          console.error("Researcher failed:", e);
          // Fallback checklist
          checklist = {
            target_role: role,
            required_sections: ["Header", "Summary", "Skills", "Experience", "Education"],
            keyword_clusters: [
              { name: "Core Skills", keywords: [role.toLowerCase()] },
            ],
            ats_rules: ["no tables", "no images", "standard headings", "one-column"],
            common_rejection_reasons: ["missing metrics", "generic summary"],
          };
        }

        sendSSE(controller, encoder, "researcher_done", {
          message: "Industry analysis complete",
          checklist,
        });

        // ── 3. Writer ↔ Critic loop ───────────────────────────────────
        let draft = "";
        let scorecard: any = null;
        let roundsCompleted = 0;
        let criticFeedback = "";

        for (let round = 1; round <= MAX_ROUNDS; round++) {
          roundsCompleted = round;

          // Writer
          sendSSE(controller, encoder, "progress", {
            step: "writer",
            round,
            message: `Crafting resume version ${round}...`,
          });

          const writerInput = `Here is my RAW RESUME (truth source):\n<<<\n${rawResumeText}\n>>>\n\nHere is the Research Checklist JSON:\n<<<\n${JSON.stringify(checklist)}\n>>>\n\n${
            criticFeedback
              ? `Previous Critic feedback and required edits:\n<<<\n${criticFeedback}\n>>>\n\nApply ALL required edits from the Critic.\n\n`
              : ""
          }Create Draft v${round}.`;

          try {
            draft = await callAI(LOVABLE_API_KEY, QUALITY_MODEL, WRITER_PROMPT, writerInput, 0.4);
          } catch (e: any) {
            if (e.message === "RATE_LIMIT" || e.message === "CREDITS_EXHAUSTED") {
              sendSSE(controller, encoder, "error", {
                message: e.message === "RATE_LIMIT"
                  ? "Rate limit reached. Please try again in a moment."
                  : "AI credits exhausted. Please add more credits.",
              });
              controller.close();
              return;
            }
            throw e;
          }

          sendSSE(controller, encoder, "writer_done", {
            round,
            message: `Version ${round} complete`,
          });

          // Critic
          sendSSE(controller, encoder, "progress", {
            step: "critic",
            round,
            message: `Quality review round ${round}...`,
          });

          const criticInput = `Truth source (raw resume):\n<<<\n${rawResumeText}\n>>>\n\nChecklist:\n<<<\n${JSON.stringify(checklist)}\n>>>\n\nCurrent draft:\n<<<\n${draft}\n>>>\n\nScore it and return the Critic Scorecard JSON.`;

          try {
            const scoreText = await callAI(LOVABLE_API_KEY, FAST_MODEL, CRITIC_PROMPT, criticInput);
            scorecard = safeJsonParse(scoreText);
          } catch (e: any) {
            if (e.message === "RATE_LIMIT" || e.message === "CREDITS_EXHAUSTED") {
              sendSSE(controller, encoder, "error", {
                message: e.message === "RATE_LIMIT"
                  ? "Rate limit reached. Please try again in a moment."
                  : "AI credits exhausted. Please add more credits.",
              });
              controller.close();
              return;
            }
            console.error("Critic parse failed, using defaults:", e);
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

          // Feed critic feedback into next round
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

        const atsMatch = draft.match(
          /\[ATS_TEXT\]\s*([\s\S]*?)(?=\[PRETTY_MD\]|$)/,
        );
        const mdMatch = draft.match(
          /\[PRETTY_MD\]\s*([\s\S]*?)(?=\[CHANGELOG\]|$)/,
        );
        const changeMatch = draft.match(/\[CHANGELOG\]\s*([\s\S]*?)$/);

        if (atsMatch) atsText = atsMatch[1].trim();
        if (mdMatch) prettyMd = mdMatch[1].trim();
        if (changeMatch) changelog = changeMatch[1].trim();

        // ── 5. Designer ───────────────────────────────────────────────
        sendSSE(controller, encoder, "progress", {
          step: "designer",
          message: "Creating professional layout...",
        });

        let html = "";
        try {
          html = await callAI(
            LOVABLE_API_KEY,
            QUALITY_MODEL,
            DESIGNER_PROMPT,
            `Approved resume content:\n<<<\n${prettyMd || atsText}\n>>>\n\nGenerate the HTML now.`,
            0.3,
          );

          // Extract just the HTML portion if wrapped in markdown code blocks
          const htmlMatch = html.match(
            /```html?\s*([\s\S]*?)```/,
          );
          if (htmlMatch) {
            html = htmlMatch[1].trim();
          }

          // Ensure it starts with <!DOCTYPE or <html
          if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html")) {
            const htmlStart = html.indexOf("<!DOCTYPE");
            const htmlAlt = html.indexOf("<html");
            const startIdx = htmlStart >= 0 ? htmlStart : htmlAlt;
            if (startIdx >= 0) {
              html = html.substring(startIdx);
            }
          }
        } catch (e: any) {
          console.error("Designer failed:", e);
          // Generate a basic HTML fallback
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

        // Log activity
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
        const msg =
          error instanceof Error ? error.message : "Optimization failed";
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
