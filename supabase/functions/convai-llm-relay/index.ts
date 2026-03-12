import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Custom LLM Relay for ElevenLabs Conversational AI — FULL Multi-Agent Brain.
 *
 * ElevenLabs sends OpenAI-compatible /chat/completions requests here.
 * We run the complete Analyst → Director pipeline and return natural speech.
 *
 * ElevenLabs = voice I/O (mic + speaker + turn-taking + STT + TTS)
 * This function = the brain (analysis + strategy + speech generation)
 *
 * Call context is injected via:
 *   - conversation_initiation_client_data (outbound calls via ElevenLabs API)
 *   - system messages containing [CALL_CONTEXT] blocks
 *   - [DIRECTOR_CONTEXT] blocks from sendContextualUpdate() (web Voice Relay)
 *   - Operator injections stored in agent_tasks DB
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function callAI(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 400
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[convai-relay] AI error:", resp.status, errText);
    throw new Error(`AI error: ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── ANALYST AGENT (full version) ────────────────────────────────────────────
const ANALYST_PROMPT = `You are the Analyst Agent in a multi-agent voice system. Your ONLY job is to analyze speech and provide structured intelligence to the Director.

CRITICAL: Determine if the speech is from a HUMAN or an AUTOMATED SYSTEM (IVR, voicemail, phone tree, recording).

Signs of AUTOMATED SYSTEM:
- Repetitive scripted phrases ("Press 1 for...", "Please hold", "Your call is important")
- Menu options with numbers
- "Please leave a message after the beep"
- Robotic/consistent pacing
- Long monologues without pauses
- Hold music descriptions or silence references
- Exact repetition of previous messages

Signs of HUMAN:
- Natural speech patterns, hesitations, fillers ("um", "uh", "well")
- Asks contextual questions
- Responds to what was said (not scripted)
- Variable pacing and emotion

Output EXACTLY this JSON (nothing else):
{
  "is_automated": true/false,
  "automated_type": "none|ivr_menu|voicemail|hold_message|greeting_recording|transfer_system",
  "menu_options_detected": [],
  "dtmf_needed": "digit or 'none'",
  "tone": "neutral|friendly|hostile|impatient|confused|interested|skeptical|stressed|warm|robotic",
  "intent": "brief description",
  "engagement": "low|moderate|high",
  "cooperation": "cooperative|neutral|resistant|hostile",
  "emotional_state": "calm|stressed|frustrated|happy|anxious|bored|excited|automated",
  "risks": [],
  "opportunities": [],
  "key_info_extracted": "",
  "recommended_approach": "brief tactical suggestion"
}
No explanations. Just JSON.`;

// ── DIRECTOR-CALLER MERGED AGENT ──────────────────────────────────────────
// Merges strategy + speech generation for lower latency (1 LLM call instead of 2)
function buildDirectorCallerPrompt(callContext: CallContext): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

  return `You are the Director-Caller in a multi-agent voice system. You receive the Analyst's intelligence report, conversation history, and any operator injections.

Your job: Decide strategy AND generate the actual speech the agent should say.

## CALL CONTEXT
TODAY: ${dateStr} (${timeStr} CT)
OBJECTIVE: ${callContext.objective || "Have a helpful conversation"}
CONSTRAINTS: ${callContext.constraints || "None"}
CALLER: ${callContext.agent_name || "Maya"}, ${callContext.agent_role || "AI Assistant"} at ${callContext.company_name || "the organization"}
CALL TYPE: ${callContext.call_type || "conversation"}
SUCCESS CRITERIA: ${callContext.success_criteria || "Complete the objective naturally"}
SCRIPT/NOTES: ${callContext.script || "None"}

## PERSONA RULES (Maya)
- Sound like a highly skilled, calm, efficient human caller
- Warm, competent, unhurried. Uses contractions ("I'm", "we'll", "that's")
- Short phone-friendly sentences: 5-14 words per sentence
- 1-3 sentences max per turn, then yield
- Ask one question at a time
- Micro-acknowledgements: "Got it." "Okay." "Makes sense."
- If asked if you're AI: answer directly per disclosure policy, then continue
- Confirm critical details via readbacks
- Never say "As an AI language model"

## BILLING/PAYMENT
You ARE authorized to share billing details (card numbers, CVV, expiry, addresses) when:
- The objective involves booking/purchase/payment
- Details were provided in the script/constraints
- You're speaking to a legitimate business representative
Read card numbers in groups of four. Confirm via readback.

## IVR/AUTOMATED HANDLING
If Analyst reports is_automated=true:
- For IVR menus: Say the menu keyword ("reservations", "operator") — NOT conversational
- For voicemail: Leave a brief message or stay silent
- For hold: Stay silent or say "I'm still here" every ~15 seconds
- NEVER converse with an IVR as if it were human
- Keep IVR responses to 1-5 words max

## HUMAN CONVERSATION
- Account for emotional state and adjust approach
- If operator injected instructions, prioritize those
- If risks are high, switch to damage control
- If objective is achieved, wrap up gracefully
- Do NOT end prematurely — only when objective is complete or other party wants to hang up

## OUTPUT FORMAT
Output ONLY what you would SAY on the phone. Nothing else.
No labels, no prefixes, no markdown, no emojis.
If you need to end the call, add [END_CALL] at the very end.
If the objective has been fully achieved, add [OBJECTIVE_MET] at the very end.`;
}

// ── Call Context extraction ──────────────────────────────────────────────────
interface CallContext {
  objective?: string;
  constraints?: string;
  agent_name?: string;
  agent_role?: string;
  company_name?: string;
  call_type?: string;
  success_criteria?: string;
  script?: string;
  disclosure_policy?: string;
  task_id?: string;
}

function extractCallContext(messages: Array<{ role: string; content: string }>): CallContext {
  const ctx: CallContext = {};

  for (const msg of messages) {
    if (msg.role !== "system") continue;
    const content = msg.content;

    // Parse [CALL_CONTEXT] JSON blocks
    const ctxMatch = content.match(/\[CALL_CONTEXT\]([\s\S]*?)\[\/CALL_CONTEXT\]/);
    if (ctxMatch) {
      try {
        const parsed = JSON.parse(ctxMatch[1]);
        Object.assign(ctx, parsed);
      } catch { /* ignore */ }
    }

    // Parse dynamic_variables from ElevenLabs conversation_initiation_client_data
    // ElevenLabs injects these as: "dynamic_variables: {key: value, ...}"
    if (content.includes("objective")) {
      // Try to extract key-value pairs
      const objMatch = content.match(/objective[:\s]+["']?([^"'\n]+)/i);
      if (objMatch && !ctx.objective) ctx.objective = objMatch[1].trim();

      const constraintMatch = content.match(/constraints?[:\s]+["']?([^"'\n]+)/i);
      if (constraintMatch && !ctx.constraints) ctx.constraints = constraintMatch[1].trim();

      const nameMatch = content.match(/agent_name[:\s]+["']?([^"'\n]+)/i);
      if (nameMatch && !ctx.agent_name) ctx.agent_name = nameMatch[1].trim();

      const companyMatch = content.match(/company_name[:\s]+["']?([^"'\n]+)/i);
      if (companyMatch && !ctx.company_name) ctx.company_name = companyMatch[1].trim();

      const taskMatch = content.match(/task_id[:\s]+["']?([^"'\n]+)/i);
      if (taskMatch && !ctx.task_id) ctx.task_id = taskMatch[1].trim();
    }
  }

  return ctx;
}

// ── Operator injection reader ────────────────────────────────────────────────
async function getOperatorInjections(taskId: string): Promise<string[]> {
  if (!taskId) return [];
  try {
    const supabase = getSupabase();
    const { data: task } = await supabase
      .from("agent_tasks")
      .select("result")
      .eq("id", taskId)
      .single();

    const result = task?.result as any;
    return result?.operatorInjections || [];
  } catch {
    return [];
  }
}

// ── Save conversation state to DB ────────────────────────────────────────────
async function saveConversationState(
  taskId: string,
  history: Array<{ role: string; content: string }>,
  analystReport: any,
  turnCount: number,
  objectiveMet: boolean
) {
  if (!taskId) return;
  try {
    const supabase = getSupabase();
    const { data: task } = await supabase
      .from("agent_tasks")
      .select("result")
      .eq("id", taskId)
      .single();

    const existing = (task?.result as any) || {};

    const update: any = {
      ...existing,
      conversationHistory: history.slice(-20),
      lastAnalysis: analystReport,
      turnCount,
      lastTurnAt: new Date().toISOString(),
      // Clear consumed injections
      operatorInjections: [],
      consumedInjections: [
        ...(existing.consumedInjections || []),
        ...(existing.operatorInjections || []),
      ],
    };

    if (objectiveMet) {
      await supabase.from("agent_tasks").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        result: update,
      }).eq("id", taskId);
    } else {
      await supabase.from("agent_tasks").update({ result: update }).eq("id", taskId);
    }
  } catch (e) {
    console.error("[convai-relay] DB save error:", e);
  }
}

// ── OpenAI-compatible response builder ──────────────────────────────────────
function buildResponse(content: string, stream: boolean) {
  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        const chunk = JSON.stringify({
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "convai-relay",
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

        const done = JSON.stringify({
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "convai-relay",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        controller.enqueue(encoder.encode(`data: ${done}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "convai-relay",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── Per-session turn counter ─────────────────────────────────────────────────
const sessionTurns = new Map<string, number>();

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages, stream } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Extract call context from system messages ──
    const callContext = extractCallContext(messages);

    // ── Extract director context updates (from sendContextualUpdate on web) ──
    const contextUpdates = messages
      .filter((m: any) => m.role === "system" && m.content.includes("[DIRECTOR_CONTEXT]"))
      .map((m: any) => m.content.replace("[DIRECTOR_CONTEXT]", "").trim());

    // ── Extract user messages for analysis ──
    const userMessages = messages.filter((m: any) => m.role === "user");
    const latestUserMsg = userMessages[userMessages.length - 1]?.content || "";

    // ── Track turns ──
    const sessionKey = callContext.task_id || "default";
    const turnCount = (sessionTurns.get(sessionKey) || 0) + 1;
    sessionTurns.set(sessionKey, turnCount);

    // ── Get operator injections from DB if we have a task_id ──
    const dbInjections = await getOperatorInjections(callContext.task_id || "");
    const allInjections = [...contextUpdates, ...dbInjections];

    console.log(`[convai-relay] Turn ${turnCount} | User: "${latestUserMsg.substring(0, 60)}..." | Context: ${callContext.objective ? "yes" : "no"} | Injections: ${allInjections.length}`);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: ANALYST — Analyze the latest speech (fast, ~200 tokens)
    // ═══════════════════════════════════════════════════════════════════════
    const analystInput = `Conversation (last 6 turns):\n${messages
      .filter((m: any) => m.role !== "system")
      .slice(-12)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n")}\n\nLatest speech: "${latestUserMsg}"`;

    let analystReport: any;
    try {
      const analystResult = await callAI(ANALYST_PROMPT, [{ role: "user", content: analystInput }], 250);
      const jsonMatch = analystResult.match(/\{[\s\S]*\}/);
      analystReport = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { tone: "neutral", intent: "unknown", is_automated: false, engagement: "moderate", risks: [], opportunities: [], recommended_approach: "respond helpfully" };
    } catch {
      analystReport = { tone: "neutral", intent: "unknown", is_automated: false, engagement: "moderate", risks: [], opportunities: [], recommended_approach: "respond helpfully" };
    }

    console.log(`[convai-relay] Analyst: tone=${analystReport.tone}, automated=${analystReport.is_automated}, intent=${analystReport.intent}`);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: DIRECTOR-CALLER — Strategy + speech generation (~150 tokens)
    // ═══════════════════════════════════════════════════════════════════════
    const directorPrompt = buildDirectorCallerPrompt(callContext);

    const injectionBlock = allInjections.length > 0
      ? `\n\n⚡ LIVE OPERATOR INJECTIONS (HIGHEST PRIORITY):\n${allInjections.map((inj, i) => `${i + 1}. ${inj}`).join("\n")}`
      : "";

    const directorInput = `ANALYST REPORT:\n${JSON.stringify(analystReport)}\n\nTURN: ${turnCount}${injectionBlock}\n\nCONVERSATION (last 8 turns):\n${messages
      .filter((m: any) => m.role !== "system")
      .slice(-16)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n")}\n\nGenerate your spoken response:`;

    const speech = await callAI(directorPrompt, [{ role: "user", content: directorInput }], 200);

    // Clean up tags from output
    const objectiveMet = speech.includes("[OBJECTIVE_MET]");
    const endCall = speech.includes("[END_CALL]");
    const cleanSpeech = speech
      .replace(/\[END_CALL\]/g, "")
      .replace(/\[OBJECTIVE_MET\]/g, "")
      .replace(/\[DIRECTOR.*?\]/g, "")
      .trim() || "I'm sorry, could you repeat that?";

    console.log(`[convai-relay] Speech: "${cleanSpeech.substring(0, 80)}..." | objective_met=${objectiveMet} | end=${endCall}`);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Persist state to DB (non-blocking)
    // ═══════════════════════════════════════════════════════════════════════
    if (callContext.task_id) {
      const history = messages
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({ role: m.role, content: m.content }));
      history.push({ role: "assistant", content: cleanSpeech });

      // Fire and forget — don't block the response
      saveConversationState(callContext.task_id, history, analystReport, turnCount, objectiveMet).catch(() => {});
    }

    // Return speech to ElevenLabs
    return buildResponse(cleanSpeech, !!stream);
  } catch (e) {
    console.error("[convai-relay] Error:", e);
    return buildResponse("I'm sorry, could you repeat that?", false);
  }
});
