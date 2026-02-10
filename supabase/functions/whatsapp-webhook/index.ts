import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_WHATSAPP_NUMBER = Deno.env.get("TWILIO_WHATSAPP_NUMBER")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

// Map Lovable model names to OpenAI equivalents
function mapModel(model: string): string {
  const map: Record<string, string> = {
    "google/gemini-3-flash-preview": "gpt-4o-mini",
    "google/gemini-2.5-flash": "gpt-4o-mini",
    "google/gemini-2.5-flash-lite": "gpt-4o-mini",
    "google/gemini-2.5-pro": "gpt-4o",
  };
  return map[model] || model;
}

// ── Conversation States ──
type ConversationState =
  | "greeting"
  | "onboarding_name"
  | "onboarding_email"
  | "onboarding_resume"
  | "onboarding_job_prefs"
  | "idle"
  | "optimizing_awaiting_role"
  | "optimizing"
  | "searching"
  | "applying"
  | "shopping"
  | "gap_filling";

// ── Twilio helpers ──
async function sendWhatsAppMessage(to: string, body: string): Promise<string> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
    To: to,
    Body: body,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Twilio send error:", data);
    throw new Error(`Twilio error: ${data.message || resp.statusText}`);
  }
  return data.sid;
}

// ── AI helpers ──
async function askAI(
  systemPrompt: string,
  userMessage: string,
  model = "google/gemini-3-flash-preview",
  maxTokens = 500,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: mapModel(model),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("AI Gateway error:", resp.status, errText);
    throw new Error(`AI error ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "I'm sorry, I couldn't process that.";
}

async function callAIForPipeline(
  systemPrompt: string,
  userPayload: string,
  model: string,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: mapModel(model),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload },
      ],
    }),
  });

  if (!resp.ok) {
    const status = resp.status;
    if (status === 429) throw new Error("RATE_LIMIT");
    if (status === 402) throw new Error("CREDITS_EXHAUSTED");
    const text = await resp.text();
    throw new Error(`AI error ${status}: ${text}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function safeJsonParse(text: string): any {
  try { return JSON.parse(text.trim()); } catch { /* */ }
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* */ }
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error("No valid JSON found in AI response");
}

// ── Intent detection ──
async function detectIntent(message: string): Promise<{ intent: string; entities: Record<string, string> }> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an intent classifier for a career automation assistant. Classify the user message into one of these intents:
- optimize_resume: User wants to optimize/improve their resume
- search_jobs: User wants to find/search for jobs
- apply_jobs: User wants to apply to jobs
- check_status: User wants status updates on applications
- shop: User wants to buy something (Auto-Shop)
- update_profile: User wants to update their info
- manage_data: User wants to delete, clear, reset, add to, fill, or modify their stored data (resume, profile, preferences, applications, conversations, etc). Examples: "delete my resume", "clear all data", "start fresh", "fill dummy info", "add X to my profile", "reset my account", "remove my applications", "wipe everything"
- help: User needs help or doesn't know what to do
- greeting: User is saying hello
- other: Anything else

Also extract entities like "role" (target role) if mentioned, and "command_detail" with a brief description of what the user wants to do.
Return ONLY valid JSON: {"intent": "...", "entities": {"role": "...", "command_detail": "..."}}`,
        },
        { role: "user", content: message },
      ],
      max_tokens: 150,
    }),
  });

  if (!resp.ok) return { intent: "other", entities: {} };
  const data = await resp.json();
  try {
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* */ }
  return { intent: "other", entities: {} };
}

// ── Smart Data Manager ──
async function handleDataManagement(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userCommand: string,
  from: string,
  context: Record<string, any>,
): Promise<{ reply: string; newContext: Record<string, any>; newState: ConversationState }> {
  // Use AI to interpret the command and map to database operations
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are a data management assistant for Career Compass. The user wants to modify their stored data via WhatsApp.

Available data areas and their tables:
- resume/resumes: User's uploaded resumes (table: resumes, fields: title, parsed_content, ats_score, skills, experience_years, is_primary)
- profile: User's personal info (table: profiles, fields: first_name, last_name, email, phone, location, linkedin_url, bio)
- job_preferences: Job search preferences (table: job_preferences, fields: job_titles, locations, remote_preference, salary_min, salary_max)
- applications: Job applications (table: applications)
- jobs: Saved/matched jobs (table: jobs)
- conversations: Chat history and state (table: conversations + whatsapp_messages)
- automation_settings: Auto-apply settings (table: automation_settings)
- all: Everything above

Interpret the user's natural language command and return a JSON action plan:
{
  "understood": true,
  "summary": "Brief human-readable summary of what will happen",
  "is_destructive": true/false,
  "actions": [
    {
      "type": "delete" | "update" | "insert" | "reset",
      "table": "table_name",
      "description": "what this does",
      "data": {} // for update/insert: the fields and values
    }
  ]
}

Rules:
- For "delete" or "clear" or "reset" or "start fresh": mark is_destructive=true
- For "fill with dummy data": generate realistic placeholder data appropriate for the field
- For "add X to Y": create an update action with the right fields
- For "reset conversation" or "start fresh chat": clear conversations and whatsapp_messages
- If you can't understand the command: {"understood": false, "summary": "I didn't understand. Try: 'delete my resume', 'clear all data', 'add Python to my skills', 'fill dummy profile info'"}
- NEVER delete the user's auth account, only application data`,
        },
        { role: "user", content: userCommand },
      ],
      max_tokens: 800,
    }),
  });

  if (!resp.ok) {
    return { reply: "⚠️ Couldn't process that command. Try again.", newContext: context, newState: "idle" as ConversationState };
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "";
  
  let plan: any;
  try {
    plan = safeJsonParse(content);
  } catch {
    return { reply: "⚠️ I couldn't interpret that. Try something like:\n• _Delete my resume_\n• _Clear all applications_\n• _Fill my profile with dummy data_\n• _Add Python to my skills_", newContext: context, newState: "idle" as ConversationState };
  }

  if (!plan.understood) {
    return { reply: `🤔 ${plan.summary}`, newContext: context, newState: "idle" as ConversationState };
  }

  // If destructive, ask for confirmation
  if (plan.is_destructive && !context.pending_data_action) {
    return {
      reply: `⚠️ *Confirm destructive action:*\n\n${plan.summary}\n\nThis cannot be undone. Reply *yes* to confirm or *no* to cancel.`,
      newContext: { ...context, pending_data_action: plan },
      newState: "idle" as ConversationState,
    };
  }

  // Execute the actions
  return await executeDataPlan(supabase, userId, plan, from);
}

async function executeDataPlan(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  plan: any,
  from: string,
): Promise<{ reply: string; newContext: Record<string, any>; newState: ConversationState }> {
  const results: string[] = [];
  let resetConversation = false;

  for (const action of plan.actions || []) {
    try {
      const table = action.table;
      
      switch (action.type) {
        case "delete": {
          if (table === "conversations" || table === "whatsapp_messages") {
            resetConversation = true;
            if (table === "whatsapp_messages") {
              // Get conversation id first
              const { data: conv } = await supabase.from("conversations").select("id").eq("phone_number", from).single();
              if (conv) {
                await supabase.from("whatsapp_messages").delete().eq("conversation_id", conv.id);
              }
            } else {
              // Delete conversation will cascade or we handle messages first
              const { data: conv } = await supabase.from("conversations").select("id").eq("phone_number", from).single();
              if (conv) {
                await supabase.from("whatsapp_messages").delete().eq("conversation_id", conv.id);
                await supabase.from("conversations").delete().eq("id", conv.id);
              }
            }
          } else if (table === "resumes") {
            // Also delete from storage
            const { data: resumes } = await supabase.from("resumes").select("id, file_path").eq("user_id", userId);
            if (resumes) {
              const filePaths = resumes.filter(r => r.file_path).map(r => r.file_path!);
              if (filePaths.length) await supabase.storage.from("resumes").remove(filePaths);
              await supabase.from("resumes").delete().eq("user_id", userId);
            }
          } else {
            await supabase.from(table).delete().eq("user_id", userId);
          }
          results.push(`✅ ${action.description}`);
          break;
        }
        case "update": {
          if (action.data && Object.keys(action.data).length > 0) {
            await supabase.from(table).update(action.data).eq("user_id", userId);
            results.push(`✅ ${action.description}`);
          }
          break;
        }
        case "insert": {
          if (action.data) {
            const insertData = { ...action.data, user_id: userId };
            await supabase.from(table).insert(insertData);
            results.push(`✅ ${action.description}`);
          }
          break;
        }
        case "reset": {
          // Delete then optionally re-insert defaults
          await supabase.from(table).delete().eq("user_id", userId);
          if (action.data && Object.keys(action.data).length > 0) {
            await supabase.from(table).insert({ ...action.data, user_id: userId });
          }
          results.push(`✅ ${action.description}`);
          break;
        }
        default:
          results.push(`⚠️ Unknown action type: ${action.type}`);
      }
    } catch (e: any) {
      console.error(`Data action failed on ${action.table}:`, e.message);
      results.push(`❌ Failed: ${action.description} — ${e.message}`);
    }
  }

  const summary = `🛠 *Data Management Complete:*\n\n${results.join("\n")}\n\nWhat else can I help with?`;
  
  return {
    reply: summary,
    newContext: {},
    newState: resetConversation ? "greeting" as ConversationState : "idle" as ConversationState,
  };
}

// ══════════════════════════════════════════════════════════════
// RESUME OPTIMIZATION PIPELINE (3-agent: Researcher→Writer→Critic)
// ══════════════════════════════════════════════════════════════

const RESEARCHER_PROMPT = `You are the RESEARCHER agent in a multi-agent resume optimization system.
You ONLY generate CHECKLIST_JSON. You do NOT write the resume.
INPUTS: RAW_RESUME (sole source of facts), JOB_DESCRIPTION (optional, vocabulary only), SYSTEM_CONFIG.
OUTPUT: JSON-ONLY with schema_version, target_role, resume_strategy, required_sections, recommended_section_order, ats_rules (8+, 3+ blocking), keyword_clusters (6+), bullet_quality_standard, common_rejection_risks, data_requests, success_criteria, notes.
TRUTH BOUNDARY: Candidate facts ONLY from RAW_RESUME. Do NOT invent details.
If RAW_RESUME missing: {"error":{"code":"RAW_RESUME_MISSING","message":"RAW_RESUME is required."}}`;

const WRITER_PROMPT = `You are the WRITER agent in a multi-agent resume optimization system.
INPUT JSON: RAW_RESUME, JOB_DESCRIPTION, CHECKLIST_JSON, PRIOR_CRITIC_SCORECARD, SYSTEM_CONFIG.
RAW_RESUME is the ONLY source of truth. Do NOT invent facts. Use [PLACEHOLDER] for missing info.
Follow CHECKLIST_JSON strictly. Apply PRIOR_CRITIC_SCORECARD required_edits if present.
OUTPUT STRICT JSON: {"ATS_TEXT":"string","PRETTY_MD":"string","CHANGELOG":["string"],"meta":{"round":number,"placeholders_used":[],"critic_edits_applied":0,"critic_edits_skipped_due_to_truth":0}}`;

const CRITIC_PROMPT = `You are the CRITIC agent. Adversarial by design. Assume draft is wrong until proven.
INPUTS: RAW_RESUME, CHECKLIST_JSON, WRITER_DRAFT, JOB_DESCRIPTION, SYSTEM_CONFIG.
RAW_RESUME is sole source of truth. Flag any invented facts.
OUTPUT STRICT JSON: {"schema_version":"1.0","scores":{"overall":number,"truthfulness":number,"ats_compliance":number,"role_alignment":number,"clarity_signal":number,"keyword_coverage":number},"decision_recommendation":"pass|revise|stop_data_needed|stop_unfixable_truth","blocking_issues":[],"non_blocking_issues":[],"truth_violations":[],"section_compliance":[],"keyword_cluster_coverage":[],"required_edits":[],"data_needed":[],"praise_to_preserve":[],"notes_for_supervisor":[]}`;

async function runOptimizationPipeline(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  resumeText: string,
  targetRole: string,
  from: string,
  existingChecklist?: any,
  existingScorecard?: any,
  startRound?: number,
): Promise<void> {
  // Reference for updating conversation context (for gap-filling)
  let newConvContext: Record<string, any> = {};
  // Send progress messages via WhatsApp as the pipeline runs
  const sendProgress = async (msg: string) => {
    try { await sendWhatsAppMessage(from, msg); } catch (e) { console.error("Progress msg failed:", e); }
  };

  try {
    // ── RESEARCHER (skip if we already have a checklist from gap-filling resume) ──
    let checklist = existingChecklist || null;

    if (!checklist) {
      await sendProgress(`🔬 *Step 1/3: Research*\nAnalyzing industry requirements for "${targetRole}"...`);

      const researcherPayload = JSON.stringify({
        RAW_RESUME: resumeText,
        JOB_DESCRIPTION: null,
        SYSTEM_CONFIG: { max_writer_critic_rounds: 100, target_role: targetRole },
      });

      const researcherOutput = await callAIForPipeline(RESEARCHER_PROMPT, researcherPayload, "google/gemini-3-flash-preview");
      checklist = safeJsonParse(researcherOutput);

      if (checklist.error) {
        await sendProgress(`❌ Research failed: ${checklist.error.message}`);
        return;
      }

      await sendProgress(`✅ Research complete!\n\n✍️ *Step 2/3: Writing*\nCrafting your optimized resume...`);
    } else {
      await sendProgress(`✍️ *Resuming optimization* with new information...`);
    }

    // ── WRITER → CRITIC LOOP (runs until 90+ or data needed) ──
    let writerDraft: any = null;
    let scorecard: any = existingScorecard || null;
    const MAX_ROUNDS = 100; // No practical cap — runs until quality gate
    const QUALITY_GATE_SCORE = 90;
    const initialRound = startRound || 1;
    let lastCompletedRound = initialRound - 1;

    for (let round = initialRound; round <= MAX_ROUNDS; round++) {
      lastCompletedRound = round;
      // Writer
      await sendProgress(`✍️ *Writing round ${round}/${MAX_ROUNDS}*...`);

      const writerPayload = JSON.stringify({
        RAW_RESUME: resumeText,
        JOB_DESCRIPTION: null,
        CHECKLIST_JSON: checklist,
        PRIOR_CRITIC_SCORECARD: scorecard,
        SYSTEM_CONFIG: { round },
      });

      let writerOutput: string;
      try {
        writerOutput = await callAIForPipeline(WRITER_PROMPT, writerPayload, "google/gemini-2.5-flash");
        writerDraft = safeJsonParse(writerOutput);
      } catch (e: any) {
        console.error(`Writer round ${round} parse error:`, e.message);
        await sendProgress(`⚠️ Writer output malformed in round ${round}, retrying...`);
        continue;
      }

      if (writerDraft.error) {
        await sendProgress(`❌ Writing failed: ${writerDraft.error.message}`);
        return;
      }

      // Report writer meta
      const meta = writerDraft.meta || {};
      const changelogPreview = (writerDraft.CHANGELOG || []).slice(0, 3).map((c: string) => `  • ${c}`).join("\n");
      await sendProgress(
        `✅ *Draft v${round} written*\n` +
        `• Critic edits applied: ${meta.critic_edits_applied ?? "N/A"}\n` +
        `• Placeholders used: ${(meta.placeholders_used || []).length}\n` +
        (changelogPreview ? `\n📝 *Changes:*\n${changelogPreview}` : "")
      );

      // Critic
      await sendProgress(`🔍 *Reviewing round ${round}/${MAX_ROUNDS}*...`);

      const criticPayload = JSON.stringify({
        RAW_RESUME: resumeText,
        JOB_DESCRIPTION: null,
        CHECKLIST_JSON: checklist,
        WRITER_DRAFT: writerDraft,
        SYSTEM_CONFIG: { round },
      });

      let criticOutput: string;
      try {
        criticOutput = await callAIForPipeline(CRITIC_PROMPT, criticPayload, "google/gemini-3-flash-preview");
        scorecard = safeJsonParse(criticOutput);
      } catch (e: any) {
        console.error(`Critic round ${round} parse error:`, e.message);
        await sendProgress(`⚠️ Critic output malformed in round ${round}, retrying...`);
        continue;
      }

      if (scorecard.error) {
        await sendProgress(`❌ Review failed: ${scorecard.error.message}`);
        return;
      }

      const decision = scorecard.decision_recommendation;
      const scores = scorecard.scores || {};
      const truthViolations = scorecard.truth_violations || [];
      const blockingIssues = scorecard.blocking_issues || [];
      const requiredEdits = scorecard.required_edits || [];

      // ── Send detailed round scorecard ──
      let roundReport =
        `📊 *Round ${round} Scorecard:*\n` +
        `• Overall: *${scores.overall ?? "?"}/100*\n` +
        `• Truthfulness: ${scores.truthfulness ?? "?"}/100\n` +
        `• ATS Compliance: ${scores.ats_compliance ?? "?"}/100\n` +
        `• Role Alignment: ${scores.role_alignment ?? "?"}/100\n` +
        `• Clarity/Signal: ${scores.clarity_signal ?? "?"}/100\n` +
        `• Keyword Coverage: ${scores.keyword_coverage ?? "?"}/100\n` +
        `\n🏷 Decision: *${decision}*`;

      if (truthViolations.length > 0) {
        roundReport += `\n\n⚠️ *Truth violations (${truthViolations.length}):*\n` +
          truthViolations.slice(0, 3).map((tv: any) => {
            if (typeof tv === "string") return `  • ${tv}`;
            return `  • ${tv.draft_claim || tv.claim || tv.description || JSON.stringify(tv)}${tv.recommended_fix ? ` — ${tv.recommended_fix}` : ""}`;
          }).join("\n");
      }

      if (blockingIssues.length > 0) {
        roundReport += `\n\n🚫 *Blocking issues (${blockingIssues.length}):*\n` +
          blockingIssues.slice(0, 3).map((b: any) => {
            if (typeof b === "string") return `  • ${b}`;
            return `  • ${b.description || b.issue || b.message || JSON.stringify(b)}`;
          }).join("\n");
      }

      if (requiredEdits.length > 0) {
        roundReport += `\n\n🔧 *Required edits: ${requiredEdits.length}* (${requiredEdits.filter((e: any) => e.severity === "blocking").length} blocking)`;
      }

      await sendProgress(roundReport);

      if (decision === "pass" || scores.overall >= QUALITY_GATE_SCORE) {
        await sendProgress(`✅ *Quality gate passed!* Score: ${scores.overall}/100 (target: ${QUALITY_GATE_SCORE})`);
        break;
      }

      if (decision === "stop_data_needed") {
        const dataNeeded = scorecard.data_needed || [];
        // Build gap-filling question list
        const questions = dataNeeded
          .filter((d: any) => d.impact === "high" || d.impact === "medium")
          .map((d: any) => ({
            question: d.question || d.description || (typeof d === "string" ? d : JSON.stringify(d)),
            where: d.where_it_would_help || "resume",
            impact: d.impact || "high",
          }));

        if (questions.length === 0) {
          // Fallback: extract from blocking_issues
          const blockingIssues = scorecard.blocking_issues || [];
          for (const b of blockingIssues) {
            questions.push({
              question: b.description || JSON.stringify(b),
              where: b.category || "resume",
              impact: "high",
            });
          }
        }

        if (questions.length > 0) {
          // Save state for gap-filling: questions, partial results, resume context
          const gapState = {
            questions,
            current_question_index: 0,
            answers: {} as Record<string, string>,
            resume_text: resumeText,
            target_role: targetRole,
            partial_score: scores.overall ?? 0,
            rounds_completed: round,
            checklist,
            writer_draft: writerDraft,
            scorecard,
          };

          // Save to conversation context
          await supabase.from("conversations")
            .update({
              state: "gap_filling",
              context_json: {
                ...newConvContext,
                gap_filling: gapState,
              },
            })
            .eq("phone_number", from);

          // Ask the first question
          const firstQ = questions[0];
          await sendProgress(
            `🔍 *I need more information to get your score above 90.*\n` +
            `Current score: *${scores.overall}/100*\n\n` +
            `Question 1 of ${questions.length}:\n` +
            `❓ ${firstQ.question}\n\n` +
            `_Reply with your answer, or type *skip* to skip this question._`
          );
          return; // EXIT — wait for user response
        }

        // No specific questions — generic ask
        await sendProgress(
          `🛑 *Optimization paused — missing data* (Score: ${scores.overall}/100)\n\n` +
          `The AI needs more details to reach 90+. Please provide:\n` +
          `• Employment history with company names and dates\n` +
          `• Specific achievements with metrics\n` +
          `• Tools and systems you've used\n\n` +
          `Reply with the details, then say *Optimize* again.`
        );
        return;
      }

      if (decision === "stop_unfixable_truth") {
        await sendProgress(
          `🛑 *Optimization stopped*\n\n` +
          `The resume cannot adequately support the target role "${targetRole}". ` +
          `Consider targeting a different role or providing more relevant experience details.`
        );
        return; // EXIT
      }

      if (decision !== "revise") {
        await sendProgress(`⚠️ Unexpected decision: "${decision}". Stopping.`);
        return;
      }

      if (round < MAX_ROUNDS) {
        await sendProgress(`🔄 Revising for round ${round + 1}...`);
      }
    }

    // ── QUALITY GATE: Refuse to save garbage ──
    const overall = scorecard?.scores?.overall ?? 0;
    const atsScore = scorecard?.scores?.ats_compliance ?? 0;
    const MIN_ACCEPTABLE_SCORE = 90;

    if (overall < MIN_ACCEPTABLE_SCORE) {
      // Trigger gap-filling instead of giving up
      const dataNeeded = scorecard?.data_needed || [];
      const questions = dataNeeded
        .map((d: any) => ({
          question: d.question || d.description || (typeof d === "string" ? d : JSON.stringify(d)),
          where: d.where_it_would_help || "resume",
          impact: d.impact || "high",
        }))
        .filter((q: any) => q.question);

      if (questions.length > 0) {
        const gapState = {
          questions,
          current_question_index: 0,
          answers: {} as Record<string, string>,
          resume_text: resumeText,
          target_role: targetRole,
          partial_score: overall,
          rounds_completed: MAX_ROUNDS,
          checklist: null, // Will re-research with new data
        };

        await supabase.from("conversations")
          .update({
            state: "gap_filling",
            context_json: { gap_filling: gapState },
          })
          .eq("phone_number", from);

        const firstQ = questions[0];
        await sendProgress(
          `⚠️ *Score: ${overall}/100* — need 90+ to complete.\n\n` +
          `I need ${questions.length} piece(s) of information.\n\n` +
          `Question 1 of ${questions.length}:\n` +
          `❓ ${firstQ.question}\n\n` +
          `_Reply with your answer, or type *skip* to skip._`
        );
        return;
      }

      await sendProgress(
        `⚠️ *Score: ${overall}/100* — target is 90+.\n\n` +
        `Please provide more details about your work history, then say *Optimize* again.`
      );
      return;
    }

    // ── SAVE RESULTS (only if quality is acceptable) ──

    // Find user's primary resume to update
    const { data: resumes } = await supabase
      .from("resumes")
      .select("id, parsed_content")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .limit(1);

    if (resumes?.length) {
      const resumeId = resumes[0].id;
      const existing = resumes[0].parsed_content ?? {};

      await supabase.from("resumes").update({
        ats_score: atsScore,
        parsed_content: {
          ...existing,
          rawText: resumeText,
          optimization: {
            status: "complete",
            ats_text: writerDraft?.ATS_TEXT || "",
            pretty_md: writerDraft?.PRETTY_MD || "",
            changelog: writerDraft?.CHANGELOG?.join("\n") || "",
            scorecard: {
              overall_score: overall,
              ats_score: atsScore,
              keyword_coverage_score: scorecard?.scores?.keyword_coverage ?? 0,
              clarity_score: scorecard?.scores?.clarity_signal ?? 0,
              truthfulness_score: scorecard?.scores?.truthfulness ?? 0,
              role_alignment_score: scorecard?.scores?.role_alignment ?? 0,
            },
            rounds_completed: lastCompletedRound,
            target_role: targetRole,
            optimized_at: new Date().toISOString(),
          },
        },
      }).eq("id", resumeId);
    }

    // ── SEND RESULT ──
    const atsText = writerDraft?.ATS_TEXT || "";
    // WhatsApp has a 1600 char limit per message, split if needed
    const resultHeader =
      `🎉 *Resume Optimization Complete!*\n\n` +
      `📊 *Scores:*\n` +
      `• Overall: ${overall}/100\n` +
      `• Truthfulness: ${scorecard?.scores?.truthfulness ?? 0}/100\n` +
      `• ATS Compliance: ${atsScore}/100\n` +
      `• Role Alignment: ${scorecard?.scores?.role_alignment ?? 0}/100\n` +
      `• Keyword Coverage: ${scorecard?.scores?.keyword_coverage ?? 0}/100\n` +
      `• Clarity: ${scorecard?.scores?.clarity_signal ?? 0}/100\n\n` +
      `🎯 Target Role: ${targetRole}\n` +
      `🔄 Rounds completed: ${lastCompletedRound}\n\n` +
      `Your optimized resume is below ⬇️`;

    await sendProgress(resultHeader);

    // Send optimized resume in chunks (WhatsApp ~1600 char limit)
    if (atsText) {
      const chunks = splitText(atsText, 1500);
      for (const chunk of chunks) {
        await sendProgress(chunk);
      }
    }

    // Praise highlights
    const praise = scorecard?.praise_to_preserve;
    if (praise?.length) {
      await sendProgress(`💪 *Strengths preserved:*\n${praise.map((p: string) => `• ${p}`).join("\n")}`);
    }

    await sendProgress(
      `✅ Done! Your resume has been saved and updated.\n\n` +
      `What's next?\n📄 *Optimize* again for a different role\n🔍 *Search* for jobs\n📨 *Apply* to matched jobs`
    );
  } catch (error: any) {
    console.error("Optimization pipeline error:", error);
    let errorMsg = "❌ Optimization failed. Please try again later.";
    if (error.message === "RATE_LIMIT") {
      errorMsg = "⏳ Rate limit hit. Please wait a minute and try again.";
    } else if (error.message === "CREDITS_EXHAUSTED") {
      errorMsg = "💳 AI credits exhausted. Please add more credits.";
    }
    await sendProgress(errorMsg);
  }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find a good break point (newline or space)
    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt < maxLen * 0.5) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt));
    remaining = remaining.substring(breakAt).trimStart();
  }
  return chunks;
}

// ══════════════════════════════════════════════════════════════
// STATE MACHINE
// ══════════════════════════════════════════════════════════════

async function handleConversation(
  supabase: ReturnType<typeof createClient>,
  from: string,
  messageBody: string,
  mediaUrl: string | null,
): Promise<string> {
  // Find or create conversation
  let { data: conv } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone_number", from)
    .single();

  // Look up user by phone in profiles
  let userId: string | null = null;
  if (conv) {
    userId = conv.user_id;
  } else {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("phone", from.replace("whatsapp:", ""))
      .single();
    if (profile) userId = profile.user_id;
  }

  const state: ConversationState = conv?.state || "greeting";
  const context = conv?.context_json || {};

  let reply = "";
  let newState: ConversationState = state;
  let newContext = { ...context };

  switch (state) {
    // ── GREETING ──
    case "greeting": {
      if (!userId) {
        reply =
          "👋 Welcome to Career Compass!\n\nI'm your AI career assistant. I can help you with:\n\n" +
          "📄 *Resume Optimization* — AI-powered resume enhancement\n" +
          "🔍 *Job Search* — Find matching positions\n" +
          "📨 *Auto-Apply* — Apply to jobs automatically\n" +
          "🛒 *Auto-Shop* — Find the best deals\n\n" +
          "Let's get you set up! What's your full name?";
        newState = "onboarding_name";
      } else {
        reply =
          "👋 Welcome back to Career Compass!\n\nWhat can I help you with today?\n\n" +
          "📄 Optimize resume\n🔍 Search jobs\n📨 Check applications\n🛒 Shop for something\n\n" +
          "Just tell me what you need!";
        newState = "idle";
      }
      break;
    }

    // ── ONBOARDING ──
    case "onboarding_name": {
      newContext.full_name = messageBody.trim();
      reply = `Nice to meet you, ${newContext.full_name}! 🎉\n\nWhat's your email address? (This is where we'll send job alerts and updates)`;
      newState = "onboarding_email";
      break;
    }

    case "onboarding_email": {
      const email = messageBody.trim().toLowerCase();
      if (!email.includes("@")) {
        reply = "That doesn't look like a valid email. Please enter your email address:";
        break;
      }
      newContext.email = email;

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: newContext.full_name },
      });

      if (authError) {
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("email", email)
          .single();

        if (existingProfile) {
          userId = existingProfile.user_id;
          await supabase.from("profiles")
            .update({ phone: from.replace("whatsapp:", ""), first_name: newContext.full_name?.split(" ")[0], last_name: newContext.full_name?.split(" ").slice(1).join(" ") })
            .eq("user_id", userId);
        } else {
          reply = `⚠️ Couldn't create your account: ${authError.message}\n\nPlease try a different email:`;
          break;
        }
      } else if (authData?.user) {
        userId = authData.user.id;
        await supabase.from("profiles")
          .update({ phone: from.replace("whatsapp:", ""), first_name: newContext.full_name?.split(" ")[0], last_name: newContext.full_name?.split(" ").slice(1).join(" ") })
          .eq("user_id", userId);
      }

      newContext.user_id = userId;
      reply =
        "✅ Account created!\n\n" +
        "Now, send me your *resume* as a document or paste the text, and I'll analyze it for you.\n\n" +
        "Or type *skip* to set up your resume later.";
      newState = "onboarding_resume";
      break;
    }

    case "onboarding_resume": {
      if (messageBody.toLowerCase().trim() === "skip") {
        reply = "No problem! You can send your resume anytime.\n\nWhat job titles are you looking for? (e.g., Software Engineer, Data Analyst)\n\nOr type *skip* to set this up later.";
        newState = "onboarding_job_prefs";
        break;
      }

      if (mediaUrl) {
        newContext.resume_media_url = mediaUrl;
        // Download the file from Twilio and extract text
        let extractedText = "";
        try {
          const mediaResp = await fetch(mediaUrl, {
            headers: {
              Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            },
          });
          if (mediaResp.ok) {
            const contentType = mediaResp.headers.get("content-type") || "";
            if (contentType.includes("text") || contentType.includes("plain")) {
              extractedText = await mediaResp.text();
            } else {
              // For PDFs and other binary docs, try basic text extraction
              const arrayBuffer = await mediaResp.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              const textDecoder = new TextDecoder("utf-8", { fatal: false });
              const rawText = textDecoder.decode(bytes);
              
              // Extract readable text from PDF stream objects
              const textMatches = rawText.match(/\(([^)]+)\)/g);
              if (textMatches) {
                extractedText = textMatches
                  .map((m: string) => m.slice(1, -1))
                  .filter((t: string) => t.length > 2 && /[a-zA-Z]/.test(t))
                  .join(" ");
              }
              
              // Also try extracting text between stream markers
              if (extractedText.length < 100) {
                const streamMatches = rawText.match(/stream\s*([\s\S]*?)endstream/g);
                if (streamMatches) {
                  const additionalText = streamMatches
                    .map((s: string) => s.replace(/stream\s*/, "").replace(/endstream/, ""))
                    .join(" ")
                    .replace(/[^\x20-\x7E\n]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                  if (additionalText.length > extractedText.length) {
                    extractedText = additionalText;
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error("Media download/extract failed:", e);
        }

        // If extraction failed or got too little text, ask user to paste
        if (extractedText.length < 50) {
          if (userId) {
            const { data: existing } = await supabase.from("resumes").select("id").eq("user_id", userId).eq("is_primary", true).limit(1);
            if (!existing?.length) {
              await supabase.from("resumes").insert({
                user_id: userId,
                title: "WhatsApp Upload",
                is_primary: true,
                parsed_content: { source: "whatsapp_media", media_url: mediaUrl },
              });
            }
          }
          reply = "📄 I received your file but couldn't extract enough text from it (PDFs can be tricky!).\n\nPlease *paste your full resume text* here instead, and I'll save it for optimization.";
          // Stay in onboarding_resume state so the next text message gets saved
          break;
        }

        // Successfully extracted text — save it
        if (userId) {
          const { data: existing } = await supabase.from("resumes").select("id").eq("user_id", userId).eq("is_primary", true).limit(1);
          if (existing?.length) {
            await supabase.from("resumes").update({
              parsed_content: { rawText: extractedText, fullText: extractedText, text: extractedText, source: "whatsapp_media", media_url: mediaUrl },
            }).eq("id", existing[0].id);
          } else {
            await supabase.from("resumes").insert({
              user_id: userId,
              title: "WhatsApp Upload",
              is_primary: true,
              parsed_content: { rawText: extractedText, fullText: extractedText, text: extractedText, source: "whatsapp_media", media_url: mediaUrl },
            });
          }
        }
        // Check if we should go to optimization instead of job prefs
        if (context.pending_action === "optimize_after_resume") {
          newContext.optimize_resume_text = extractedText;
          delete newContext.pending_action;
          reply = `📄 Got your resume! Extracted ${extractedText.length} characters.\n\nWhat target role should I optimize it for?\n\nExample: _Medical Coding Specialist_ or _Software Engineer_`;
          newState = "optimizing_awaiting_role";
        } else {
          reply = `📄 Got your resume! Extracted ${extractedText.length} characters of text.\n\nWhat job titles are you interested in?`;
          newState = "onboarding_job_prefs";
        }
      } else {
        newContext.resume_text = messageBody;
        // Save pasted text as a resume record
        if (userId) {
          // Upsert primary resume
          const { data: existing } = await supabase.from("resumes").select("id").eq("user_id", userId).eq("is_primary", true).limit(1);
          if (existing?.length) {
            await supabase.from("resumes").update({
              parsed_content: { rawText: messageBody, fullText: messageBody, text: messageBody },
            }).eq("id", existing[0].id);
          } else {
            await supabase.from("resumes").insert({
              user_id: userId,
              title: "WhatsApp Resume",
              is_primary: true,
              parsed_content: { rawText: messageBody, fullText: messageBody, text: messageBody },
            });
          }
        }
        // Check if we should go to optimization instead of job prefs
        if (context.pending_action === "optimize_after_resume") {
          newContext.optimize_resume_text = messageBody;
          delete newContext.pending_action;
          reply = "📄 Got your resume text!\n\nWhat target role should I optimize it for?\n\nExample: _Medical Coding Specialist_ or _Software Engineer_";
          newState = "optimizing_awaiting_role";
        } else {
          reply = "📄 Got your resume text! I'll process it.\n\nWhat job titles are you looking for?";
          newState = "onboarding_job_prefs";
        }
      }
      break;
    }

    case "onboarding_job_prefs": {
      if (messageBody.toLowerCase().trim() !== "skip") {
        const titles = messageBody.split(",").map((t: string) => t.trim()).filter(Boolean);
        if (titles.length > 0 && userId) {
          // Upsert job preferences
          const { data: existing } = await supabase.from("job_preferences").select("id").eq("user_id", userId).limit(1);
          if (existing?.length) {
            await supabase.from("job_preferences").update({ job_titles: titles }).eq("id", existing[0].id);
          } else {
            await supabase.from("job_preferences").insert({ user_id: userId, job_titles: titles });
          }
        }
      }

      reply =
        "🎉 You're all set up!\n\nHere's what I can do:\n\n" +
        "📄 *Optimize* — Optimize your resume for a target role\n" +
        "🔍 *Search* — Find matching jobs\n" +
        "📨 *Apply* — Auto-apply to matched jobs\n" +
        "📊 *Status* — Check application status\n" +
        "🛒 *Shop* — Find best deals\n" +
        "❓ *Help* — See all commands\n\n" +
        "What would you like to do?";
      newState = "idle";
      break;
    }

    // ── IDLE: INTENT ROUTING ──
    case "idle": {
      // Check for pending destructive action confirmation
      if (context.pending_data_action) {
        const answer = messageBody.toLowerCase().trim();
        if (answer === "yes" || answer === "y" || answer === "confirm") {
          const result = await executeDataPlan(supabase, userId!, context.pending_data_action, from);
          reply = result.reply;
          newContext = result.newContext;
          newState = result.newState;
          break;
        } else {
          reply = "❌ Cancelled. No data was changed.\n\nWhat else can I help with?";
          delete newContext.pending_data_action;
          break;
        }
      }

      const { intent, entities } = await detectIntent(messageBody);

      switch (intent) {
        case "optimize_resume": {
          if (!userId) {
            reply = "You need to set up your account first. What's your full name?";
            newState = "onboarding_name";
            break;
          }

          // Check if user has a resume
          const { data: resumes } = await supabase
            .from("resumes")
            .select("id, title, ats_score, parsed_content")
            .eq("user_id", userId)
            .eq("is_primary", true)
            .limit(1);

          if (!resumes?.length) {
            reply = "📄 You don't have a resume uploaded yet.\n\nPaste your resume text here and I'll save it for you:";
            newContext.pending_action = "optimize_after_resume";
            newState = "onboarding_resume";
            break;
          }

          const resume = resumes[0];
          const resumeText = resume.parsed_content?.rawText || resume.parsed_content?.fullText || resume.parsed_content?.text || "";

          if (!resumeText || resumeText.length < 50) {
            reply = "📄 Your resume doesn't have enough text to optimize.\n\nPlease paste your full resume text:";
            newContext.pending_action = "optimize_after_resume";
            newState = "onboarding_resume";
            break;
          }

          // If role was extracted from intent, start immediately
          const extractedRole = entities?.role;
          if (extractedRole) {
            reply = `📄 Found your resume: *${resume.title}*\n\n🚀 Starting optimization for *${extractedRole}*...\n\nThis takes 2-4 minutes. I'll send progress updates!`;
            newContext.optimize_resume_text = resumeText;
            newContext.optimize_resume_id = resume.id;
            runOptimizationPipeline(supabase, userId, resumeText, extractedRole, from);
            newState = "idle";
          } else {
            reply =
              `📄 Found your resume: *${resume.title}*\n` +
              (resume.ats_score ? `Current ATS Score: ${resume.ats_score}%\n\n` : "\n") +
              "What target role should I optimize it for?\n\n" +
              "Example: _Medical Coding Specialist_ or _Software Engineer_";
            newContext.optimize_resume_text = resumeText;
            newContext.optimize_resume_id = resume.id;
            newState = "optimizing_awaiting_role";
          }
          break;
        }

        case "manage_data": {
          if (!userId) {
            reply = "You need to set up your account first. What's your full name?";
            newState = "onboarding_name";
            break;
          }
          const result = await handleDataManagement(supabase, userId, messageBody, from, newContext);
          reply = result.reply;
          newContext = result.newContext;
          newState = result.newState;
          break;
        }

        case "search_jobs":
          reply = await handleSearchIntent(supabase, userId!, messageBody);
          break;
        case "apply_jobs":
          reply = await handleApplyIntent(supabase, userId!);
          break;
        case "check_status":
          reply = await handleStatusIntent(supabase, userId!);
          break;
        case "shop":
          reply = "🛒 Auto-Shop activated!\n\nTell me what you're looking for and your budget.\n\nExample: _Buy wireless earbuds under $50_";
          break;
        case "greeting":
          reply = "Hey! 👋 Good to hear from you.\n\nWhat can I help with?\n\n📄 Optimize resume\n🔍 Search jobs\n📨 Apply\n📊 Status\n🛒 Shop\n🛠 Manage data";
          break;
        case "help":
          reply =
            "Here are my commands:\n\n" +
            "📄 *Optimize [role]* — AI resume optimization\n" +
            "🔍 *Search [role]* — Find jobs\n" +
            "📨 *Apply* — Auto-apply to matches\n" +
            "📊 *Status* — Application updates\n" +
            "🛒 *Shop [product]* — Find best deals\n" +
            "👤 *Update profile* — Edit your info\n" +
            "🛠 *Manage data* — Delete, reset, or modify your data\n" +
            "❓ *Help* — This menu";
          break;
        default:
          reply = await askAI(
            `You are Career Compass, a friendly WhatsApp career assistant. You help users with resume optimization, job searching, auto-applying, shopping, and managing their data. Keep responses concise (under 300 chars for WhatsApp). If the user seems to want a specific action, suggest the relevant command. For data management (delete, reset, fill, add to), tell them to just describe what they want naturally.`,
            messageBody,
          );
      }
      break;
    }

    // ── AWAITING TARGET ROLE FOR OPTIMIZATION ──
    case "optimizing_awaiting_role": {
      const targetRole = messageBody.trim();
      if (targetRole.toLowerCase() === "cancel") {
        reply = "Optimization cancelled. What else can I help with?";
        newState = "idle";
        break;
      }

      const resumeText = context.optimize_resume_text;
      if (!resumeText || !userId) {
        reply = "Something went wrong. Let's start over — type *Optimize* to try again.";
        newState = "idle";
        break;
      }

      reply = `🚀 Starting optimization for *${targetRole}*...\n\nThis takes 2-4 minutes. I'll send progress updates!`;
      
      // Fire and forget — pipeline sends WhatsApp messages directly
      runOptimizationPipeline(supabase, userId, resumeText, targetRole, from);
      newState = "idle";
      break;
    }

    // ── GAP FILLING: One question at a time ──
    case "gap_filling": {
      const gapState = context.gap_filling;
      if (!gapState || !gapState.questions) {
        reply = "Something went wrong with the gap-filling flow. Type *Optimize* to start over.";
        newState = "idle";
        break;
      }

      const currentIdx = gapState.current_question_index || 0;
      const isSkip = messageBody.toLowerCase().trim() === "skip";
      const isCancel = messageBody.toLowerCase().trim() === "cancel";

      if (isCancel) {
        reply = "Optimization cancelled. Type *Optimize* to start fresh.";
        newState = "idle";
        newContext = {};
        break;
      }

      // Save the answer (or skip)
      if (!isSkip) {
        const questionKey = `q${currentIdx}`;
        gapState.answers[questionKey] = messageBody.trim();
        gapState.answers[`q${currentIdx}_question`] = gapState.questions[currentIdx].question;
      }

      const nextIdx = currentIdx + 1;

      if (nextIdx < gapState.questions.length) {
        // Ask next question
        gapState.current_question_index = nextIdx;
        const nextQ = gapState.questions[nextIdx];
        reply =
          `✅ Got it!\n\n` +
          `Question ${nextIdx + 1} of ${gapState.questions.length}:\n` +
          `❓ ${nextQ.question}\n\n` +
          `_Reply with your answer, or type *skip* to skip._`;
        newContext.gap_filling = gapState;
        newState = "gap_filling";
      } else {
        // All questions answered — append answers to resume text and re-optimize
        const answeredPairs: string[] = [];
        for (let i = 0; i < gapState.questions.length; i++) {
          const answer = gapState.answers[`q${i}`];
          if (answer) {
            const question = gapState.answers[`q${i}_question`] || gapState.questions[i].question;
            answeredPairs.push(`${question}: ${answer}`);
          }
        }

        if (answeredPairs.length === 0) {
          reply = "You skipped all questions. Type *Optimize* to try again with more details in your resume.";
          newState = "idle";
          newContext = {};
          break;
        }

        // Append new data to resume text
        const additionalInfo = "\n\n--- ADDITIONAL INFORMATION PROVIDED ---\n" + answeredPairs.join("\n");
        const enrichedResume = gapState.resume_text + additionalInfo;

        // Update resume in database
        if (userId) {
          const { data: resumes } = await supabase
            .from("resumes")
            .select("id, parsed_content")
            .eq("user_id", userId)
            .eq("is_primary", true)
            .limit(1);

          if (resumes?.length) {
            const existing = resumes[0].parsed_content ?? {};
            await supabase.from("resumes").update({
              parsed_content: {
                ...existing,
                rawText: enrichedResume,
                fullText: enrichedResume,
                text: enrichedResume,
              },
            }).eq("id", resumes[0].id);
          }
        }

        reply =
          `✅ Got all ${answeredPairs.length} answers!\n\n` +
          `🚀 Re-running optimization with your new details...\n` +
          `Previous score: ${gapState.partial_score}/100 → targeting 90+`;

        // Fire and forget — re-run pipeline with enriched resume
        runOptimizationPipeline(
          supabase,
          userId!,
          enrichedResume,
          gapState.target_role,
          from,
        );
        newState = "idle";
        newContext = {};
      }
      break;
    }

    default:
      reply = await askAI(
        "You are Career Compass, a WhatsApp career assistant. Keep responses brief and helpful.",
        messageBody,
      );
      newState = "idle";
  }

  // Upsert conversation
  if (conv) {
    await supabase.from("conversations")
      .update({
        state: newState,
        context_json: newContext,
        last_message_at: new Date().toISOString(),
        ...(userId && userId !== conv.user_id ? { user_id: userId } : {}),
      })
      .eq("id", conv.id);
  } else {
    const effectiveUserId = userId || "00000000-0000-0000-0000-000000000000";
    await supabase.from("conversations").insert({
      user_id: effectiveUserId,
      phone_number: from,
      state: newState,
      context_json: newContext,
      last_message_at: new Date().toISOString(),
    });
  }

  return reply;
}

// ── Other intent handlers ──
async function handleSearchIntent(supabase: ReturnType<typeof createClient>, userId: string, message: string): Promise<string> {
  const { data: prefs } = await supabase.from("job_preferences").select("job_titles, locations").eq("user_id", userId).single();
  const titles = prefs?.job_titles?.join(", ") || "not set";
  const locations = prefs?.locations?.join(", ") || "any location";
  return `🔍 I'll search for jobs matching:\n\n*Titles:* ${titles}\n*Locations:* ${locations}\n\nI'm kicking off a deep search now. I'll message you when results are ready! 🚀\n\n_This typically takes 5-10 minutes._`;
}

async function handleApplyIntent(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: jobs } = await supabase.from("jobs").select("id, title, company, match_score").eq("user_id", userId).gte("match_score", 70).order("match_score", { ascending: false }).limit(5);
  if (!jobs?.length) return "📨 No matched jobs to apply to yet.\n\nTry *Search* first to find jobs, then I can auto-apply!";
  const jobList = jobs.map((j, i) => `${i + 1}. *${j.title}* at ${j.company} (${j.match_score}% match)`).join("\n");
  return `📨 Top matches ready to apply:\n\n${jobList}\n\nReply *apply all* to auto-apply, or *apply 1,3* for specific ones.`;
}

async function handleStatusIntent(supabase: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: apps, count } = await supabase.from("applications").select("status, company_name, job_title", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
  if (!apps?.length) return "📊 No applications yet. Use *Search* to find jobs and *Apply* to get started!";
  const statusEmoji: Record<string, string> = { applied: "📤", interview: "🎯", offer: "🎉", rejected: "❌", pending: "⏳" };
  const list = apps.map((a) => `${statusEmoji[a.status] || "📋"} *${a.job_title || "Unknown"}* at ${a.company_name || "Unknown"} — ${a.status}`).join("\n");
  return `📊 Your applications (${count} total):\n\n${list}\n\n_Showing latest 5_`;
}

// ── Main Handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let from = "";
    let body = "";
    let mediaUrl: string | null = null;
    let messageSid = "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      from = formData.get("From")?.toString() || "";
      body = formData.get("Body")?.toString() || "";
      mediaUrl = formData.get("MediaUrl0")?.toString() || null;
      messageSid = formData.get("MessageSid")?.toString() || "";
    } else if (contentType.includes("application/json")) {
      const json = await req.json();
      from = json.From || json.from || "";
      body = json.Body || json.body || json.message || "";
      mediaUrl = json.MediaUrl0 || json.media_url || null;
      messageSid = json.MessageSid || json.message_sid || "";
    }

    if (!from) {
      return new Response(
        JSON.stringify({ error: "Missing From" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If body is empty but we have media, that's fine (e.g. PDF with no caption)
    if (!body && !mediaUrl) {
      return new Response(
        JSON.stringify({ error: "Missing Body and MediaUrl" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[WhatsApp] From: ${from}, Body: ${body.substring(0, 100)}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Store inbound message
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, user_id")
      .eq("phone_number", from)
      .single();

    if (conv) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "inbound",
        body,
        media_url: mediaUrl,
        twilio_sid: messageSid,
      });
    }

    // Process conversation
    const reply = await handleConversation(supabase, from, body, mediaUrl);

    // Send reply via Twilio
    const replySid = await sendWhatsAppMessage(from, reply);

    // Store outbound message
    if (conv) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "outbound",
        body: reply,
        twilio_sid: replySid,
      });
    }

    // Return TwiML empty response
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { ...corsHeaders, "Content-Type": "application/xml" } },
    );
  } catch (error) {
    console.error("[WhatsApp] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
