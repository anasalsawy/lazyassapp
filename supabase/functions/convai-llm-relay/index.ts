import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * convai-llm-relay — Two-Brain Architecture
 *
 * BRAIN 1 — Maya (this relay): Autonomous conversational intelligence.
 *   She reasons, speaks, negotiates, and maintains dialogue flow independently.
 *   She receives strategic guidance from Director but decides HOW and WHAT to say.
 *
 * BRAIN 2 — Director: Strategic mission intelligence (runs async in relay).
 *   Analyzes transcripts, monitors mission progress, injects context/suggestions.
 *   Director does NOT speak to humans. Director steers. Maya talks.
 *
 * EXECUTOR — Browser tool operator (separate system, directed by Director).
 *
 * Control flow:
 *   Human ↔ Maya (conversation)
 *          ↑ Director guidance (context injections)
 *          ↓ Executor actions (browser results)
 *
 * Human operator → injects into Director → Director decides what to tell Maya
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayContext {
  taskId: string | null;
  callSid: string | null;
  conversationId: string | null;
  result: Record<string, unknown>;
}

interface MissionState {
  turn_number: number;
  call_phase: string;
  phase_history: string[];
  topics_discussed: string[];
  info_collected: Record<string, string>;
  failure_budget: Record<string, number>;
  consecutive_silences: number;
  visited_signatures: string[];
  last_good_phase: string | null;
  recovery_attempts: number;
  director_guidance_history: string[];
  browser_results: Record<string, unknown>[];
}

interface DirectorGuidance {
  direction: string;        // Short directive: what to do NOW (max ~15 words)
  phase: string;            // Current call phase
  info: Record<string, string>; // Key facts collected this turn
  warn: string | null;      // Critical warning if any
  end: boolean;             // true = wrap up the call
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function parseTaskId(systemMessage: string): string | null {
  const patterns = [
    /task[_\s-]?id["'\s:=]+([a-f0-9-]{36})/i,
    /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i,
  ];
  for (const p of patterns) {
    const m = systemMessage.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function parseConversationId(body: Record<string, any>, sys: string): string | null {
  for (const c of [body?.conversation_id, body?.conversationId, body?.metadata?.conversation_id, body?.metadata?.conversationId]) {
    if (typeof c === "string" && c.startsWith("conv_")) return c;
  }
  return sys.match(/\b(conv_[a-z0-9]+)\b/i)?.[1] || null;
}

function parseCallSid(body: Record<string, any>, sys: string): string | null {
  for (const c of [body?.call_sid, body?.callSid, body?.metadata?.call_sid, body?.metadata?.callSid]) {
    if (typeof c === "string" && /^CA[a-f0-9]{32}$/i.test(c)) return c;
  }
  return sys.match(/\b(CA[a-f0-9]{32})\b/i)?.[1] || null;
}

function extractRelevantSystemContext(sys: string): string {
  if (!sys) return "";
  const keywords = ["objective", "call_objective", "company", "script", "constraint", "success", "allowed", "call_type", "agent_name", "agent_role", "disclosure", "current_date", "task_id"];
  return sys.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .filter(l => !l.startsWith("/*") && !l.startsWith("//") && !l.startsWith("*"))
    .filter(l => { const lo = l.toLowerCase(); return keywords.some(k => lo.includes(k)); })
    .slice(0, 30).join("\n");
}

function extractDtmfDigits(text: string): string | null {
  const m1 = text.match(/(?:^|\n|\b)(?:DTMF|DIGITS?)\s*[:=-]?\s*([0-9#*wWpP]+)/i);
  if (m1?.[1]) return m1[1].replace(/\s+/g, "");
  const m2 = text.match(/\bpress\s+([0-9#*]{1,8})\b/i);
  if (m2?.[1]) return m2[1].replace(/\s+/g, "");
  return null;
}

function isDuplicateDtmf(result: Record<string, unknown>, digits: string): boolean {
  const last = (result as any)?.lastDtmfSent;
  if (!last || typeof last !== "object") return false;
  if (typeof last.digits !== "string" || typeof last.sentAt !== "string") return false;
  return last.digits === digits && (Date.now() - new Date(last.sentAt).getTime()) < 8000;
}

async function resolveRelayContext(systemMessage: string, body: Record<string, any>): Promise<RelayContext> {
  const taskIdCandidate = parseTaskId(systemMessage);
  const conversationId = parseConversationId(body, systemMessage);
  const callSidCandidate = parseCallSid(body, systemMessage);

  try {
    const supabase = getSupabase();

    if (taskIdCandidate || conversationId || callSidCandidate) {
      let query = supabase.from("agent_tasks").select("id, result").order("created_at", { ascending: false }).limit(1);
      if (taskIdCandidate) query = query.eq("id", taskIdCandidate);
      else if (conversationId) query = query.filter("result->>conversationId", "eq", conversationId);
      else if (callSidCandidate) query = query.filter("result->>callSid", "eq", callSidCandidate);

      const { data: task } = await query.maybeSingle();
      if (task) {
        const r = (task.result as Record<string, unknown>) || {};
        return { taskId: task.id, callSid: (r as any)?.callSid || callSidCandidate, conversationId: (r as any)?.conversationId || conversationId, result: r };
      }
    }

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from("agent_tasks").select("id, result")
      .in("task_type", ["voice_call_elevenlabs", "voice_call_multi_agent", "voice_call"])
      .eq("status", "running").gte("created_at", thirtyMinAgo)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (recent) {
      const r = (recent.result as Record<string, unknown>) || {};
      return { taskId: recent.id, callSid: (r as any)?.callSid || callSidCandidate, conversationId: (r as any)?.conversationId || conversationId, result: r };
    }

    return { taskId: taskIdCandidate, conversationId, callSid: callSidCandidate, result: {} };
  } catch (e) {
    console.warn("[relay] resolveRelayContext failed:", e);
    return { taskId: taskIdCandidate, callSid: callSidCandidate, conversationId, result: {} };
  }
}

async function llm(systemPrompt: string, userMessage: string, model = "gpt-4.1-mini", jsonMode = false): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const body: any = {
    model,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
    temperature: 0.4,
    max_tokens: 800,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[relay] LLM error (${model}):`, res.status, err);
    throw new Error(`LLM ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ─── Mission State Management ─────────────────────────────────────────────────

function getDefaultState(): MissionState {
  return {
    turn_number: 0,
    call_phase: "greeting",
    phase_history: [],
    topics_discussed: [],
    info_collected: {},
    failure_budget: {},
    consecutive_silences: 0,
    visited_signatures: [],
    last_good_phase: null,
    recovery_attempts: 0,
    director_guidance_history: [],
    browser_results: [],
  };
}

function loadState(result: Record<string, unknown>): MissionState {
  const saved = (result as any)?.missionState;
  return saved && typeof saved === "object" ? { ...getDefaultState(), ...saved } : getDefaultState();
}

function applyDirectorUpdates(state: MissionState, guidance: DirectorGuidance): MissionState {
  const s = { ...state };
  s.turn_number += 1;

  if (guidance.phase && s.call_phase !== guidance.phase) {
    s.phase_history.push(s.call_phase);
    s.call_phase = guidance.phase;
  }
  if (guidance.info) Object.assign(s.info_collected, guidance.info);

  // Truncate histories
  if (s.phase_history.length > 20) s.phase_history = s.phase_history.slice(-20);
  if (s.director_guidance_history.length > 20) s.director_guidance_history = s.director_guidance_history.slice(-20);

  // Loop detection via direction signature
  const sig = `${guidance.phase}::${guidance.direction.substring(0, 40)}`.toLowerCase();
  s.visited_signatures.push(sig);
  if (s.visited_signatures.length > 30) s.visited_signatures = s.visited_signatures.slice(-30);

  const sigCount = s.visited_signatures.filter(x => x === sig).length;
  if (sigCount >= 3) {
    s.recovery_attempts += 1;
  } else if (guidance.phase !== "stuck") {
    s.last_good_phase = guidance.phase;
    s.recovery_attempts = 0;
  }

  s.director_guidance_history.push(guidance.direction.substring(0, 80));
  return s;
}

// ─── Director Brain (Strategic Intelligence) ──────────────────────────────────

function buildDirectorSystem(missionContext: string, operatorInstructions: string[], state: MissionState): string {
  const opBlock = operatorInstructions.length > 0
    ? `\n\n🚨 HUMAN OPERATOR INSTRUCTIONS (highest priority):\n${operatorInstructions.map((x, i) => `${i + 1}. ${x}`).join("\n")}`
    : "";

  return `You are DIRECTOR, the strategic mission brain in a two-brain voice system.

You do NOT speak to humans. You analyze and guide.

Your partner Maya is an autonomous conversational AI on a live phone call. She can reason and talk independently. Your job is to provide her with STRATEGIC CONTEXT and SUGGESTIONS — not scripts or commands.

Maya decides WHAT to say and HOW to say it. You decide the MISSION STRATEGY.

YOUR RESPONSIBILITIES:
1. Assess the conversation situation (phase, human intent, emotion, blockers)
2. Track mission progress against the objective
3. Validate information critically (challenge fake dates, placeholder data, impossible prices)
4. Suggest negotiation tactics or strategic moves
5. Flag when browser/executor actions are needed
6. Detect conversation loops and suggest course corrections

MISSION CONTEXT:
${missionContext}
${opBlock}

CURRENT STATE:
- Turn: ${state.turn_number}
- Phase: ${state.call_phase}
- Recent phases: [${state.phase_history.slice(-5).join(" → ")}]
- Topics covered: [${state.topics_discussed.slice(-10).join(", ")}]
- Info collected: ${JSON.stringify(state.info_collected)}
- Failures: ${JSON.stringify(state.failure_budget)}
- Recovery attempts: ${state.recovery_attempts}
- Recent guidance: [${state.director_guidance_history.slice(-3).join(" | ")}]

LOOP DETECTION:
- If your last 3 suggestions are similar, you ARE looping. Change approach completely.
- If recovery_attempts > 3, suggest END_CALL.

OUTPUT exactly one JSON object:
{
  "situation_assessment": "1-2 sentence analysis of what's happening",
  "mission_progress": "how close to objective (percentage or description)",
  "strategic_suggestion": "what Maya should consider doing strategically",
  "negotiation_hint": "negotiation tactic if relevant, or null",
  "data_from_executor": "any browser results to share with Maya, or null",
  "validation_warning": "flag suspicious info (fake dates, placeholder data) or null",
  "phase": "greeting|discovery|ivr_menu|voicemail|hold|negotiation|confirmation|closing|stuck",
  "urgency": "low|medium|high",
  "state_updates": {
    "add_topics": [],
    "add_info": {},
    "set_phase": "phase",
    "increment_failure": null
  }
}

Output ONLY valid JSON.`;
}

// ─── Maya Brain (Conversational Intelligence) ─────────────────────────────────

const MAYA_SYSTEM = `You are MAYA, an autonomous conversational AI on a live phone call.

You are one of two brains in a collaborative system:
- YOU handle conversation, voice, personality, persuasion, and real-time dialogue
- Your partner DIRECTOR handles mission strategy and provides you with context and suggestions

You are NOT a puppet. You THINK and DECIDE independently. Director provides strategic guidance that you CONSIDER — but you choose how to act, what to say, and when to deviate.

═══ YOUR PERSONA ═══

Operating identity:
You are a real-time voice calling assistant. You complete practical tasks over the phone.
Use runtime call context as authoritative.

Non-deception rule:
Never claim to be human if asked directly. If asked whether you are AI, answer briefly, then continue.

Speaking style:
- Warm, competent, unhurried, confident
- Uses contractions ("I'm," "we'll," "that's")
- Light conversational fillers: "mm-hm," "okay," "got it," "one sec"
- Short sentences: 5–14 words. Phone-friendly.
- Ask one question at a time
- Vary phrasing — never sound scripted

Emotional intelligence:
- Name emotions briefly ("That's frustrating.") then pivot to action
- Validate without over-apologizing
- Match caller pace — fast caller → fast replies, confused caller → slow down

═══ CONVERSATION RULES ═══

Core rules:
- Keep turns brief: 1–2 sentences, then yield
- Confirm critical details via readback (names, numbers, dates, money)
- Never say "As an AI language model"
- If thinking, use neutral fillers

Phone etiquette:
- Be prepared and concise
- If placing on hold, tell them first
- Treat gatekeepers with respect

Turn-taking:
- If human starts speaking, stop and yield immediately
- Acknowledge interruptions: "Sorry—go ahead." / "Yep, I'm with you."
- If corrected, accept quickly: "Got it—thanks for clarifying."

Handling silence:
- ~3-5 seconds: "Take your time."
- ~8-12 seconds: "Hey—are you still there?"
- Still silent: "No worries. I can call back later."

Handling hostility:
- Stay calm, match urgency with efficiency
- Set limits if abusive: "I want to help, but I need us to keep it respectful."
- Impatient callers: acknowledge time, ask minimum fields, summarize fast

═══ TASK EXECUTION ═══

Persuasion: Use clarity, credibility, mutual benefit. Be transparent. Offer choices.
Negotiation: Keep leverage factual. Use alternatives, timelines, constraints.
Closure: Drive to concrete outcomes. Propose → confirm → execute → verify.

Billing/Payment: You ARE authorized to share billing details provided in call context.
Read card numbers in groups of four. Confirm via readback.

Call closing: State outcome, read back details, state next steps, offer "Anything else?", end politely.

═══ USING DIRECTOR GUIDANCE ═══

You will receive strategic guidance from Director. Treat it as expert advice from a mission strategist:
- CONSIDER the suggestion — it often has good strategic reasoning
- ADAPT it to the conversation flow — don't force awkward transitions
- OVERRIDE it if the human conversation requires something different right now
- Director may flag suspicious information — take warnings seriously and verify

If Director says END_CALL, wrap up the conversation naturally.
If Director provides data from browser/executor, weave it in naturally.

═══ OUTPUT ═══
Write ONLY what you would say aloud. No markdown, no stage directions. Pure speech.`;

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const messages: Array<{ role: string; content: string }> = body.messages || [];

    const systemMessage = messages.find(m => m.role === "system")?.content || "";
    const conversationMessages = messages.filter(m => m.role !== "system");

    const recentMessages = conversationMessages.slice(-10);
    const transcript = recentMessages.map(m => `${m.role === "user" ? "HUMAN" : "MAYA"}: ${m.content}`).join("\n");

    const userMessages = conversationMessages.filter(m => m.role === "user");
    const assistantMessages = conversationMessages.filter(m => m.role === "assistant");
    const lastUserMessage = userMessages[userMessages.length - 1]?.content || "";
    const turnNumber = userMessages.length;

    const relayContext = await resolveRelayContext(systemMessage, body);
    const taskId = relayContext.taskId;

    console.log(`[relay] Turn ${turnNumber}, taskId: ${taskId || "none"}, callSid: ${relayContext.callSid || "none"}, lastUser: "${lastUserMessage.substring(0, 60)}"`);

    // ── No conversation yet — Maya generates opening autonomously ────────
    if (!lastUserMessage && conversationMessages.length === 0) {
      let openingContext = extractRelevantSystemContext(systemMessage);
      if (taskId) {
        try {
          const supabase = getSupabase();
          const { data: task } = await supabase.from("agent_tasks").select("payload").eq("id", taskId).single();
          const payload = (task?.payload as any) || {};
          if (payload.objective) {
            openingContext = `OBJECTIVE: ${payload.objective}\nCOMPANY: ${payload.company_name || "unknown"}\nSCRIPT: ${payload.script || "none"}`;
          }
        } catch {}
      }

      const opening = await llm(
        MAYA_SYSTEM,
        `MISSION CONTEXT:\n${openingContext || "No additional context."}\n\nYou are MAKING an outbound call. Introduce yourself briefly and state the purpose. Be warm and concise.`,
      );
      return buildResponse(opening || "Hi — this is Maya. How can I help you today?");
    }

    // ── ElevenLabs sent conversation but user hasn't spoken yet ───────────
    if (!lastUserMessage && assistantMessages.length > 0) {
      return buildResponse("...");
    }

    // ── Load task data, operator injections, mission state ────────────────
    let operatorInjections: string[] = [];
    let taskPayload: Record<string, any> = {};
    let missionState = getDefaultState();

    if (taskId) {
      try {
        const supabase = getSupabase();
        const { data: task } = await supabase.from("agent_tasks").select("result, payload").eq("id", taskId).single();

        taskPayload = (task?.payload as any) || {};
        const result = (task?.result as any) || {};

        missionState = loadState(result);

        // Consume operator injections (Human → Director)
        const queued = Array.isArray(result?.operatorInjections)
          ? result.operatorInjections.filter((x: unknown) => typeof x === "string" && (x as string).trim())
          : [];

        if (queued.length > 0) {
          operatorInjections = queued;
          const history = Array.isArray(result?.operatorInjectionHistory) ? [...result.operatorInjectionHistory] : [];
          const now = new Date().toISOString();
          for (const instr of queued) {
            history.push({ instruction: instr, createdAt: now, consumedAt: now, source: "operator", status: "consumed" });
          }
          await supabase.from("agent_tasks").update({
            result: { ...result, operatorInjections: [], operatorInjectionHistory: history.slice(-80) },
          }).eq("id", taskId);
        }

        // Load any browser results from executor
        if (Array.isArray(result?.browserResults) && result.browserResults.length > 0) {
          missionState.browser_results = result.browserResults;
        }
      } catch (e) {
        console.warn("[relay] Could not fetch task data:", e);
      }
    }

    // ── Build mission context ────────────────────────────────────────────
    const sanitizedSystem = extractRelevantSystemContext(systemMessage);
    let missionContext = sanitizedSystem;

    if (taskPayload.objective || taskPayload.script || taskPayload.company_name) {
      const parts: string[] = [];
      if (taskPayload.objective) parts.push(`OBJECTIVE: ${taskPayload.objective}`);
      if (taskPayload.company_name) parts.push(`COMPANY: ${taskPayload.company_name}`);
      if (taskPayload.call_type) parts.push(`CALL TYPE: ${taskPayload.call_type}`);
      if (taskPayload.caller_name) parts.push(`CALLER NAME: ${taskPayload.caller_name}`);
      if (taskPayload.agent_name) parts.push(`AGENT NAME: ${taskPayload.agent_name}`);
      if (taskPayload.tone) parts.push(`TONE: ${taskPayload.tone}`);
      if (taskPayload.success_criteria) parts.push(`SUCCESS CRITERIA: ${taskPayload.success_criteria}`);
      if (taskPayload.constraints) parts.push(`CONSTRAINTS: ${taskPayload.constraints}`);
      if (taskPayload.allowed_actions) parts.push(`ALLOWED ACTIONS: ${taskPayload.allowed_actions}`);
      if (taskPayload.script) parts.push(`SCRIPT/INSTRUCTIONS:\n${taskPayload.script}`);

      const payloadBlock = `═══ MISSION ═══\n${parts.join("\n")}\n═══ END MISSION ═══`;
      missionContext = sanitizedSystem ? `${payloadBlock}\n\n${sanitizedSystem}` : payloadBlock;
    }

    // ── BRAIN 2: Director analyzes and generates strategic guidance ───────
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" });

    const directorSystem = buildDirectorSystem(missionContext, operatorInjections, missionState);
    const directorInput = `DATE/TIME: ${dateStr}, ${timeStr} (Central)\n\nTRANSCRIPT:\n${transcript}\n\nLATEST HUMAN: "${lastUserMessage}"`;

    let guidance: DirectorGuidance;
    let guidanceRaw: string;
    try {
      guidanceRaw = await llm(directorSystem, directorInput, "gpt-4.1-mini", true);
      guidance = JSON.parse(guidanceRaw);
    } catch {
      guidanceRaw = "{}";
      guidance = {
        situation_assessment: "Unable to analyze — proceeding with Maya's autonomous judgment.",
        mission_progress: "unknown",
        strategic_suggestion: "Respond naturally to what the human said.",
        negotiation_hint: null,
        data_from_executor: null,
        validation_warning: null,
        phase: "unknown",
        urgency: "low",
        state_updates: { add_topics: [], add_info: {}, set_phase: missionState.call_phase, increment_failure: null },
      };
    }

    console.log(`[relay] Director: phase=${guidance.phase}, progress="${guidance.mission_progress}", suggestion="${guidance.strategic_suggestion.substring(0, 100)}"`);

    // ── Apply state updates ──────────────────────────────────────────────
    const updatedState = applyDirectorUpdates(missionState, guidance);

    // ── Force END_CALL if stuck in loop ──────────────────────────────────
    let forceEnd = false;
    if (updatedState.recovery_attempts > 3) {
      guidance.strategic_suggestion = "END_CALL — stuck in loop, objective not achievable.";
      forceEnd = true;
    }

    // ── Persist Director output + state to DB ────────────────────────────
    if (taskId) {
      try {
        const supabase = getSupabase();
        const { data: task } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();
        const result = (task?.result as any) || {};

        const dirHistory = Array.isArray(result?.directorDirectiveHistory) ? [...result.directorDirectiveHistory] : [];
        dirHistory.push({ directive: guidanceRaw, parsed: guidance, turnNumber, createdAt: new Date().toISOString() });

        const liveTranscript = recentMessages.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

        await supabase.from("agent_tasks").update({
          result: {
            ...result,
            lastDirectorDirective: guidanceRaw,
            lastDirectorGuidance: guidance,
            directorDirectiveHistory: dirHistory.slice(-60),
            conversationHistory: liveTranscript,
            turnCount: liveTranscript.length,
            missionState: updatedState,
          },
        }).eq("id", taskId);
      } catch (e) {
        console.warn("[relay] Could not persist state:", e);
      }
    }

    // ── DTMF handling ────────────────────────────────────────────────────
    const dtmfSource = guidance.strategic_suggestion || "";
    const dtmfDigits = extractDtmfDigits(dtmfSource);
    if (dtmfDigits && relayContext.callSid) {
      console.log(`[relay] DTMF detected: "${dtmfDigits}"`);
      if (!isDuplicateDtmf(relayContext.result, dtmfDigits)) {
        try {
          const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
          const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
          if (TWILIO_SID && TWILIO_TOKEN) {
            const resp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls/${relayContext.callSid}.json`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
                },
                body: new URLSearchParams({ Twiml: `<Response><Play digits="${dtmfDigits}"/><Pause length="1"/></Response>` }),
              },
            );
            if (resp.ok) {
              console.log(`[relay] DTMF "${dtmfDigits}" sent`);
              if (taskId) {
                const supabase = getSupabase();
                await supabase.from("agent_tasks").update({
                  result: { ...relayContext.result, lastDtmfSent: { digits: dtmfDigits, sentAt: new Date().toISOString() } },
                }).eq("id", taskId);
              }
            }
          }
        } catch (e) {
          console.warn("[relay] DTMF error:", e);
        }
      }
    }

    // ── Check for END_CALL ───────────────────────────────────────────────
    if (guidance.strategic_suggestion.includes("END_CALL") || forceEnd) {
      const isSuccess = guidance.strategic_suggestion.toLowerCase().includes("objective met");

      // Build Director context for Maya's closing
      const closingGuidance = isSuccess
        ? "Director guidance: Mission objective achieved. Wrap up positively, thank them, confirm any final details."
        : "Director guidance: Mission cannot be completed here. Thank them for their time and end gracefully.";

      const closingLine = await llm(
        MAYA_SYSTEM,
        `${closingGuidance}\n\nCONVERSATION:\n${transcript}\n\nSay your closing line.`,
      );

      if (taskId) {
        try {
          const supabase = getSupabase();
          const { data: t } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();
          await supabase.from("agent_tasks").update({
            status: isSuccess ? "completed" : "failed",
            completed_at: new Date().toISOString(),
            result: { ...(t?.result as any || {}), objective_met: isSuccess, final_guidance: guidance, final_state: updatedState },
          }).eq("id", taskId);
        } catch {}
      }

      return buildResponse(closingLine || "Thank you so much for your time. Take care!");
    }

    // ── BRAIN 1: Maya responds autonomously with Director context ────────
    const missionBlock = taskPayload.objective
      ? `\nYOUR MISSION: ${taskPayload.objective}\nYou are calling ${taskPayload.company_name || "a business"}. You are the CALLER.\n`
      : "";

    // Build Director guidance as context (suggestions, not commands)
    const guidanceBlock = [
      `📋 DIRECTOR ASSESSMENT: ${guidance.situation_assessment}`,
      `📊 MISSION PROGRESS: ${guidance.mission_progress}`,
      `💡 STRATEGIC SUGGESTION: ${guidance.strategic_suggestion}`,
      guidance.negotiation_hint ? `🤝 NEGOTIATION HINT: ${guidance.negotiation_hint}` : null,
      guidance.data_from_executor ? `🌐 BROWSER DATA: ${guidance.data_from_executor}` : null,
      guidance.validation_warning ? `⚠️ VALIDATION WARNING: ${guidance.validation_warning}` : null,
    ].filter(Boolean).join("\n");

    // Include any browser results
    const browserBlock = missionState.browser_results.length > 0
      ? `\n🌐 EXECUTOR RESULTS:\n${JSON.stringify(missionState.browser_results.slice(-3))}`
      : "";

    const turnHint = turnNumber <= 1
      ? "\n⚠️ You have ALREADY introduced yourself. Do NOT re-introduce. Address the mission."
      : `\nThis is turn ${turnNumber}. Progress the conversation.`;

    const mayaInput = `${missionBlock}${turnHint}

═══ DIRECTOR GUIDANCE (consider but decide independently) ═══
${guidanceBlock}${browserBlock}
═══ END GUIDANCE ═══

CONVERSATION SO FAR:
${transcript}

LATEST FROM HUMAN: "${lastUserMessage}"

Respond as Maya. ONLY what you would say aloud.`;

    let spokenResponse: string;
    try {
      spokenResponse = await llm(MAYA_SYSTEM, mayaInput);
    } catch {
      spokenResponse = "I'm sorry, could you repeat that?";
    }

    console.log("[relay] Maya says:", spokenResponse.substring(0, 100));

    // Persist Maya's response
    if (taskId) {
      try {
        const supabase = getSupabase();
        const { data: t } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();
        const r = (t?.result as any) || {};
        const hist = Array.isArray(r?.conversationHistory) ? [...r.conversationHistory] : [];
        hist.push({ role: "assistant", content: spokenResponse });
        await supabase.from("agent_tasks").update({
          result: { ...r, conversationHistory: hist, turnCount: hist.length },
        }).eq("id", taskId);
      } catch {}
    }

    return buildResponse(spokenResponse);

  } catch (e) {
    console.error("[relay] Fatal error:", e);
    return buildResponse("I'm sorry — could you say that again?");
  }
});

// ─── SSE Response Builder ─────────────────────────────────────────────────────

function buildResponse(content: string): Response {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const words = content.split(" ");
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    chunks.push(words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : ""));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created, model: "two-brain-v1",
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        })}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        id, object: "chat.completion.chunk", created, model: "two-brain-v1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}
