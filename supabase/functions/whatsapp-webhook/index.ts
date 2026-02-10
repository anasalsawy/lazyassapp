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
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

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
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
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
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
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
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
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
- help: User needs help or doesn't know what to do
- greeting: User is saying hello
- other: Anything else

Also extract entities like "role" (target role) if mentioned.
Return ONLY valid JSON: {"intent": "...", "entities": {"role": "..."}}`,
        },
        { role: "user", content: message },
      ],
      max_tokens: 100,
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
): Promise<void> {
  // Send progress messages via WhatsApp as the pipeline runs
  const sendProgress = async (msg: string) => {
    try { await sendWhatsAppMessage(from, msg); } catch (e) { console.error("Progress msg failed:", e); }
  };

  try {
    await sendProgress(`🔬 *Step 1/3: Research*\nAnalyzing industry requirements for "${targetRole}"...`);

    // ── RESEARCHER ──
    const researcherPayload = JSON.stringify({
      RAW_RESUME: resumeText,
      JOB_DESCRIPTION: null,
      SYSTEM_CONFIG: { max_writer_critic_rounds: 3, target_role: targetRole },
    });

    const researcherOutput = await callAIForPipeline(RESEARCHER_PROMPT, researcherPayload, "google/gemini-3-flash-preview");
    const checklist = safeJsonParse(researcherOutput);

    if (checklist.error) {
      await sendProgress(`❌ Research failed: ${checklist.error.message}`);
      return;
    }

    await sendProgress(`✅ Research complete!\n\n✍️ *Step 2/3: Writing*\nCrafting your optimized resume...`);

    // ── WRITER → CRITIC LOOP (runs until 90+ or data needed) ──
    let writerDraft: any = null;
    let scorecard: any = null;
    const MAX_ROUNDS = 100; // No practical cap — runs until quality gate
    const QUALITY_GATE_SCORE = 90;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // Writer
      await sendProgress(`✍️ *Writing round ${round}/${MAX_ROUNDS}*...`);

      const writerPayload = JSON.stringify({
        RAW_RESUME: resumeText,
        JOB_DESCRIPTION: null,
        CHECKLIST_JSON: checklist,
        PRIOR_CRITIC_SCORECARD: scorecard,
        SYSTEM_CONFIG: { round },
      });

      const writerOutput = await callAIForPipeline(WRITER_PROMPT, writerPayload, "google/gemini-2.5-flash");
      writerDraft = safeJsonParse(writerOutput);

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

      const criticOutput = await callAIForPipeline(CRITIC_PROMPT, criticPayload, "google/gemini-3-flash-preview");
      scorecard = safeJsonParse(criticOutput);

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
          truthViolations.slice(0, 3).map((tv: any) => `  • "${tv.draft_claim}" — ${tv.recommended_fix}`).join("\n");
      }

      if (blockingIssues.length > 0) {
        roundReport += `\n\n🚫 *Blocking issues (${blockingIssues.length}):*\n` +
          blockingIssues.slice(0, 3).map((b: any) => `  • ${b.description}`).join("\n");
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
        const blockingData = dataNeeded.filter((d: any) => d.impact === "high");
        const reasons = (blockingData.length > 0 ? blockingData : dataNeeded)
          .map((d: any) => {
            const q = d.question || d.description || (typeof d === "string" ? d : JSON.stringify(d));
            const where = d.where_it_would_help ? ` (for ${d.where_it_would_help})` : "";
            return `• ${q}${where}`;
          })
          .join("\n") || "Missing critical information";

        await sendProgress(
          `🛑 *Optimization paused — missing data*\n\n` +
          `The AI cannot produce a quality resume without this info:\n${reasons}\n\n` +
          `Please reply with the missing details, then say *Optimize* again.`
        );
        // Do NOT continue — exit the loop entirely
        // Save partial results with a flag
        const partialOverall = scores.overall ?? 0;
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
              rawText: resumeText,
              optimization: {
                status: "paused_data_needed",
                partial_score: partialOverall,
                data_needed: reasons,
                rounds_completed: round,
                target_role: targetRole,
                optimized_at: new Date().toISOString(),
              },
            },
          }).eq("id", resumes[0].id);
        }
        return; // EXIT — do not save as complete
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
    const MIN_ACCEPTABLE_SCORE = 60;

    if (overall < MIN_ACCEPTABLE_SCORE) {
      const dataNeeded = scorecard?.data_needed || [];
      const reasons = dataNeeded
        .map((d: any) => `• ${d.question || d.description || JSON.stringify(d)}`)
        .join("\n") || "• Employment history with dates and company names\n• Specific metrics and achievements";

      await sendProgress(
        `⚠️ *Optimization incomplete* (Score: ${overall}/100)\n\n` +
        `The resume still has too many gaps to be usable. Missing:\n${reasons}\n\n` +
        `Please provide the missing details and say *Optimize* again.`
      );
      return; // Do NOT save a low-quality resume as "complete"
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
            rounds_completed: MAX_ROUNDS,
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
      `🔄 Rounds completed: ${MAX_ROUNDS}\n\n` +
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
            // Fire and forget the pipeline (runs async, sends results via WhatsApp)
            runOptimizationPipeline(supabase, userId, resumeText, extractedRole, from);
            newState = "idle"; // Stay idle, pipeline sends messages directly
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
          reply = "Hey! 👋 Good to hear from you.\n\nWhat can I help with?\n\n📄 Optimize resume\n🔍 Search jobs\n📨 Apply\n📊 Status\n🛒 Shop";
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
            "❓ *Help* — This menu";
          break;
        default:
          reply = await askAI(
            `You are Career Compass, a friendly WhatsApp career assistant. You help users with resume optimization, job searching, auto-applying, and shopping. Keep responses concise (under 300 chars for WhatsApp). If the user seems to want a specific action, suggest the relevant command.`,
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
