# Career Compass — Full System Source Code

> Generated: 2026-02-10
> Contains: WhatsApp Webhook, Web Resume Optimizer, Frontend Hook

---

## Table of Contents
1. [WhatsApp Webhook (`supabase/functions/whatsapp-webhook/index.ts`)](#1-whatsapp-webhook)
2. [Web Resume Optimizer (`supabase/functions/optimize-resume/index.ts`)](#2-web-resume-optimizer)
3. [Frontend Hook (`src/hooks/useResumeOptimizer.ts`)](#3-frontend-hook)

---

## 1. WhatsApp Webhook

**File:** `supabase/functions/whatsapp-webhook/index.ts`
**Lines:** 1490

### Architecture
- **State Machine:** `greeting` → `onboarding_name` → `onboarding_email` → `onboarding_resume` → `onboarding_job_prefs` → `idle` → (various action states)
- **Intent Detection:** GPT-4o-mini classifies user messages into intents (optimize_resume, search_jobs, apply_jobs, manage_data, etc.)
- **3-Agent Pipeline:** Researcher → Writer ↔ Critic (up to 100 rounds, 90+ quality gate)
- **Gap Filling:** When score < 90 or `stop_data_needed`, extracts questions and asks user one-by-one via WhatsApp
- **Smart Data Management:** AI interprets natural language data commands, with 2-step confirmation for destructive actions

```typescript
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
              const { data: conv } = await supabase.from("conversations").select("id").eq("phone_number", from).single();
              if (conv) {
                await supabase.from("whatsapp_messages").delete().eq("conversation_id", conv.id);
              }
            } else {
              const { data: conv } = await supabase.from("conversations").select("id").eq("phone_number", from).single();
              if (conv) {
                await supabase.from("whatsapp_messages").delete().eq("conversation_id", conv.id);
                await supabase.from("conversations").delete().eq("id", conv.id);
              }
            }
          } else if (table === "resumes") {
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
  let newConvContext: Record<string, any> = {};
  const sendProgress = async (msg: string) => {
    try { await sendWhatsAppMessage(from, msg); } catch (e) { console.error("Progress msg failed:", e); }
  };

  try {
    // ── RESEARCHER (skip if we already have a checklist) ──
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
    const MAX_ROUNDS = 100;
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
        const questions = dataNeeded
          .filter((d: any) => d.impact === "high" || d.impact === "medium")
          .map((d: any) => ({
            question: d.question || d.description || (typeof d === "string" ? d : JSON.stringify(d)),
            where: d.where_it_would_help || "resume",
            impact: d.impact || "high",
          }));

        if (questions.length === 0) {
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

          await supabase.from("conversations")
            .update({
              state: "gap_filling",
              context_json: {
                ...newConvContext,
                gap_filling: gapState,
              },
            })
            .eq("phone_number", from);

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
        return;
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
          checklist: null,
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

    if (atsText) {
      const chunks = splitText(atsText, 1500);
      for (const chunk of chunks) {
        await sendProgress(chunk);
      }
    }

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
  let { data: conv } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone_number", from)
    .single();

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
              const arrayBuffer = await mediaResp.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              const textDecoder = new TextDecoder("utf-8", { fatal: false });
              const rawText = textDecoder.decode(bytes);
              
              const textMatches = rawText.match(/\(([^)]+)\)/g);
              if (textMatches) {
                extractedText = textMatches
                  .map((m: string) => m.slice(1, -1))
                  .filter((t: string) => t.length > 2 && /[a-zA-Z]/.test(t))
                  .join(" ");
              }
              
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
          break;
        }

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
        if (messageBody.trim().length < 100) {
          reply = "That doesn't look like a full resume. Please paste your complete resume text (at least a few paragraphs):";
          break;
        }
        newContext.resume_text = messageBody;
        if (userId) {
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

      if (!isSkip) {
        const questionKey = `q${currentIdx}`;
        gapState.answers[questionKey] = messageBody.trim();
        gapState.answers[`q${currentIdx}_question`] = gapState.questions[currentIdx].question;
      }

      const nextIdx = currentIdx + 1;

      if (nextIdx < gapState.questions.length) {
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

        const additionalInfo = "\n\n--- ADDITIONAL INFORMATION PROVIDED ---\n" + answeredPairs.join("\n");
        const enrichedResume = gapState.resume_text + additionalInfo;

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

    let reply: string;
    try {
      reply = await handleConversation(supabase, from, body, mediaUrl);
    } catch (convError) {
      console.error("[WhatsApp] Conversation error:", convError);
      reply = "⚠️ Sorry, I'm having trouble processing your request right now. Please try again in a moment.";
    }

    const replySid = await sendWhatsAppMessage(from, reply);

    if (conv) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "outbound",
        body: reply,
        twilio_sid: replySid,
      });
    }

    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { ...corsHeaders, "Content-Type": "application/xml" } },
    );
  } catch (error) {
    console.error("[WhatsApp] Fatal Error:", error);
    try {
      if (from) await sendWhatsAppMessage(from, "⚠️ Something went wrong. Please try again.");
    } catch { /* swallow */ }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
```

---

## 2. Web Resume Optimizer

**File:** `supabase/functions/optimize-resume/index.ts`
**Lines:** 763

### Architecture
- **3-Agent Pipeline:** Researcher → Writer ↔ Critic (adversarial loop)
- **Auto-Chunking:** 80s time budget with state persistence to `pipeline_continuations`
- **Crash Recovery:** State saved in catch block for auto-resume
- **Dual Provider:** Supports OpenAI (Responses API) and Lovable AI Gateway
- **SSE Streaming:** Real-time progress events to frontend
- **Manual Mode:** Optional step-by-step execution with user approval

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════════
// AGENT SYSTEM PROMPTS (production-grade)
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
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* fall through */ }
  }
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

  const useOpenAI = !!OPENAI_API_KEY;
  const aiApiKey = useOpenAI ? OPENAI_API_KEY! : LOVABLE_API_KEY!;
  const aiProvider: "openai" | "lovable" = useOpenAI ? "openai" : "lovable";

  if (!aiApiKey) {
    return new Response(
      JSON.stringify({ error: "AI service not configured. Set LOVABLE_API_KEY or OPENAI_API_KEY." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

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
  const EARLY_EXIT_SCORE = 90;
  const TIME_BUDGET_MS = 80_000;
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
      // Declare pipeline state OUTSIDE try so catch can access for crash recovery
      let resumeFromStep: string | null = null;
      let pipelineState: PipelineState | null = null;
      let rawResumeText = "";
      let jd: string | null = jobDescription ?? null;
      let role = "";
      let loc = "";
      let checklist: any = null;
      let writerDraft: any = null;
      let scorecard: any = null;
      let roundsCompleted = 0;

      try {
        // ── Determine start point ─────────────────────────────────────
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

        // ── Initialize artifacts from continuation ────────────────────
        if (pipelineState) {
          rawResumeText = pipelineState.rawResumeText || "";
          jd = pipelineState.jobDescription ?? jd;
          role = pipelineState.role || "";
          loc = pipelineState.loc || "";
          checklist = pipelineState.checklist || null;
          writerDraft = pipelineState.writerDraft || null;
          scorecard = pipelineState.scorecard || null;
          roundsCompleted = pipelineState.roundsCompleted || 0;
        }

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
              PRIOR_CRITIC_SCORECARD: scorecard,
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
          html: "",
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

        // Crash-safe: try to save state so progress isn't lost
        try {
          if (rawResumeText && checklist && roundsCompleted > 0) {
            const contId = await saveContinuation("CRASH_RECOVERY", "WRITER_LOOP", {
              rawResumeText, jobDescription: jd, role, loc, checklist, writerDraft, scorecard, roundsCompleted,
            });
            console.log(`Crash recovery state saved: continuation ${contId}, round ${roundsCompleted}`);
            sendSSE(controller, encoder, "auto_continue", {
              step: "CRASH_RECOVERY",
              continuation_id: contId,
              rounds_so_far: roundsCompleted,
              current_score: scorecard?.scores?.overall ?? 0,
              message: `⏳ Recovering from interruption at round ${roundsCompleted}. Auto-continuing...`,
            });
          } else {
            if (msg === "RATE_LIMIT") {
              sendSSE(controller, encoder, "error", { message: "Rate limit exceeded. Please try again in a moment." });
            } else if (msg === "CREDITS_EXHAUSTED") {
              sendSSE(controller, encoder, "error", { message: "AI credits exhausted. Please add more credits." });
            } else {
              sendSSE(controller, encoder, "error", { message: msg });
            }
          }
        } catch (saveErr) {
          console.error("Failed to save crash recovery state:", saveErr);
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
```

---

## 3. Frontend Hook

**File:** `src/hooks/useResumeOptimizer.ts`
**Lines:** 407

### Architecture
- Manages SSE stream consumption and state machine (`idle` → `running` → `complete`/`error`/`awaiting_continue`)
- Auto-continue loop: re-invokes edge function with `continuation_id` when auto-chunking occurs
- Manual mode support: pauses and exposes `continueOptimization()` for user approval

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

export interface ManualPause {
  step: string;
  next_step: string;
  continuation_id: string;
  message: string;
}

type OptimizerStatus = "idle" | "running" | "complete" | "error" | "awaiting_continue";

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
  const [manualPause, setManualPause] = useState<ManualPause | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resumeIdRef = useRef<string>("");
  const autoContinueIdRef = useRef<string | null>(null);

  const processSSEStream = useCallback(
    async (response: Response) => {
      if (!response.body) throw new Error("No response body");
      autoContinueIdRef.current = null;

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
                  { step: event.step, round: event.round, message: event.message },
                ]);
                break;

              case "researcher_done":
                setCurrentStep("researcher_done");
                setProgress((prev) => [
                  ...prev,
                  { step: "researcher_done", message: event.message, checklist: event.checklist },
                ]);
                break;

              case "writer_done":
                setCurrentStep("writer_done");
                if (event.round) setCurrentRound(event.round);
                setProgress((prev) => [
                  ...prev,
                  { step: "writer_done", round: event.round, message: event.message },
                ]);
                break;

              case "critic_done":
                setCurrentStep("critic_done");
                if (event.scorecard) setLatestScorecard(event.scorecard);
                setProgress((prev) => [
                  ...prev,
                  { step: "critic_done", round: event.round, message: event.message, scorecard: event.scorecard },
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
                    { step: "gatekeeper_pass", message: event.message, gatekeeper: verdict },
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
                    { step: "gatekeeper_fail", message: event.message, gatekeeper: verdict },
                  ]);
                }
                break;

              case "gatekeeper_blocked":
                setCurrentStep("gatekeeper_blocked");
                setStatus("error");
                {
                  const verdict: GatekeeperVerdict = {
                    step: event.step,
                    passed: false,
                    blocking_issues: event.blocking_issues,
                  };
                  setGatekeeperVerdicts((prev) => [...prev, verdict]);
                  setProgress((prev) => [
                    ...prev,
                    { step: "gatekeeper_blocked", message: event.message, gatekeeper: verdict },
                  ]);
                }
                setError(event.message);
                toast({ title: "Pipeline blocked", description: event.message, variant: "destructive" });
                break;

              case "await_user_continue":
                setStatus("awaiting_continue");
                setCurrentStep("awaiting_continue");
                setManualPause({
                  step: event.step,
                  next_step: event.next_step,
                  continuation_id: event.continuation_id,
                  message: event.message,
                });
                setProgress((prev) => [
                  ...prev,
                  { step: "awaiting_continue", message: event.message },
                ]);
                break;

              case "auto_continue":
                setCurrentStep("auto_continuing");
                if (event.rounds_so_far) setCurrentRound(event.rounds_so_far);
                setProgress((prev) => [
                  ...prev,
                  { step: "auto_continue", round: event.rounds_so_far, message: event.message },
                ]);
                autoContinueIdRef.current = event.continuation_id;
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
                toast({ title: "Optimization failed", description: event.message, variant: "destructive" });
                break;
            }
          } catch {
            // Partial JSON, wait for more data
          }
        }
      }
    },
    [toast],
  );

  const callEdgeFunction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!session?.access_token) {
        toast({ title: "Not signed in", description: "Please sign in to optimize your resume.", variant: "destructive" });
        return;
      }

      abortRef.current = new AbortController();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
          signal: abortRef.current.signal,
        },
      );

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Request failed with status ${response.status}`);
      }

      await processSSEStream(response);

      return autoContinueIdRef.current;
    },
    [session, processSSEStream, toast],
  );

  const callWithAutoResume = useCallback(
    async (payload: Record<string, unknown>) => {
      let contId = await callEdgeFunction(payload);
      while (contId) {
        await new Promise((r) => setTimeout(r, 500));
        contId = await callEdgeFunction({
          resumeId: payload.resumeId,
          continuation_id: contId,
          manual_mode: payload.manual_mode,
        });
      }
    },
    [callEdgeFunction],
  );

  const optimize = useCallback(
    async (resumeId: string, targetRole: string, location?: string, manualMode?: boolean) => {
      setStatus("running");
      setProgress([]);
      setCurrentStep("init");
      setCurrentRound(0);
      setResult(null);
      setLatestScorecard(null);
      setGatekeeperVerdicts([]);
      setError(null);
      setManualPause(null);
      setIsManualMode(!!manualMode);
      resumeIdRef.current = resumeId;

      try {
        await callWithAutoResume({
          resumeId,
          targetRole,
          location,
          manual_mode: !!manualMode,
        });
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.error("Optimization error:", e);
        setStatus("error");
        setError(e.message || "Something went wrong");
        toast({ title: "Optimization failed", description: e.message || "Please try again.", variant: "destructive" });
      }
    },
    [callWithAutoResume, toast],
  );

  const continueOptimization = useCallback(
    async () => {
      if (!manualPause?.continuation_id || !resumeIdRef.current) return;

      const continuationId = manualPause.continuation_id;
      setStatus("running");
      setManualPause(null);
      setCurrentStep("resuming");

      try {
        await callWithAutoResume({
          resumeId: resumeIdRef.current,
          continuation_id: continuationId,
          manual_mode: isManualMode,
        });
      } catch (e: any) {
        if (e.name === "AbortError") return;
        console.error("Continue error:", e);
        setStatus("error");
        setError(e.message || "Something went wrong");
        toast({ title: "Continue failed", description: e.message || "Please try again.", variant: "destructive" });
      }
    },
    [manualPause, isManualMode, callWithAutoResume, toast],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setCurrentStep("");
    setProgress([]);
    setManualPause(null);
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
    setManualPause(null);
    setIsManualMode(false);
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
    manualPause,
    isManualMode,
    optimize,
    continueOptimization,
    cancel,
    reset,
  };
}
```
