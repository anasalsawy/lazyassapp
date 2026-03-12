import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * convai-llm-relay — Custom LLM endpoint for ElevenLabs Conversational AI
 *
 * ElevenLabs sends the conversation history here on every turn.
 * We run a 2-agent pipeline (optimized from 3):
 *   1. DIRECTOR — Analyzes the situation (tone, intent, IVR, blockers) AND
 *                 decides the strategic move in a single pass. Uses mission
 *                 context + operator injections.
 *   2. CALLER   — Maya persona. Takes the Director's instruction and produces
 *                 the actual spoken line, filtered through her persona rules.
 *
 * ~1.0–1.5s relay overhead (down from ~1.5–2.0s with 3 agents).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Call the Lovable AI gateway */
async function llm(
  systemPrompt: string,
  userMessage: string,
  model = "google/gemini-2.5-flash",
): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const res = await fetch("https://ai.gateway.lovable.dev/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Lovable-API-Key": apiKey } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[relay] LLM error (${model}):`, res.status, err);
    throw new Error(`LLM ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ─── Agent Prompts ────────────────────────────────────────────────────────────

function buildDirectorSystem(missionContext: string, operatorInjections: string[], turnNumber: number): string {
  const injectionBlock = operatorInjections.length > 0
    ? `\n\n🚨 OPERATOR LIVE INJECTIONS (highest priority — follow these NOW):\n${operatorInjections.map((inj, i) => `${i + 1}. ${inj}`).join("\n")}`
    : "";

  const turnAwareness = turnNumber <= 1
    ? "\n⚠️ IMPORTANT: This is the FIRST response turn. Maya has ALREADY introduced herself via the first_message. Do NOT introduce again. Immediately address the mission objective."
    : `\nThis is turn ${turnNumber}. Do NOT re-introduce. Progress the conversation toward the objective.`;

  return `You are the DIRECTOR in a multi-agent voice calling system. You perform situational analysis, CRITICAL VALIDATION, and strategic decision-making in a single pass.

STEP 1 — ANALYZE the conversation:
- CALL_PHASE: greeting | discovery | ivr_menu | voicemail | gatekeeper | hold | negotiation | confirmation | closing
- HUMAN_INTENT: what the human wants (1 sentence)
- EMOTIONAL_STATE: calm | confused | impatient | hostile | friendly | neutral
- IVR_DETECTED: is this an automated system? (IVR, voicemail, recording)
- KEY_INFO: any names, dates, prices, confirmation numbers mentioned
- BLOCKER: anything preventing progress (wrong dept, needs manager, on hold)

STEP 2 — VALIDATE information critically:
You are an INTELLIGENT agent, not a passive note-taker. CHALLENGE suspicious information:
- IMPOSSIBLE DATES: "tomorrow April 2nd" when today is March — politely clarify. Dates that don't match day-of-week, past dates for future events, etc.
- FAKE/PLACEHOLDER DATA: Flight numbers like "0000", "1234", "0001" — these are likely fake. Ask the person to confirm or provide the real one.
- NONSENSICAL PRICES: $0, $1 for expensive items, or absurdly high prices — question them.
- CONTRADICTIONS: If someone says one thing then contradicts it — point it out gently.
- MISSING CRITICAL INFO: Don't proceed without essential details. Ask for them.
- SUSPICIOUS PATTERNS: Repeated round numbers, placeholder-looking data, info that doesn't pass a basic smell test.

DO NOT blindly accept and parrot back information. If something sounds wrong, SAY SO politely but clearly:
  "Just to double-check — you mentioned flight 0000, that doesn't look like a standard flight number. Could you verify that?"
  "You said the departure is tomorrow April 2nd, but I'm showing today as [date]. Want to confirm the correct date?"

STEP 3 — DECIDE the strategic move based on your analysis + mission context.
${turnAwareness}

MISSION CONTEXT:
${missionContext}
${injectionBlock}

OUTPUT FORMAT (plain text, compact):
PHASE: [detected phase]
INTENT: [human intent]
EMOTION: [emotional state]
IVR: [true/false]
KEY_INFO: [extracted info or "none"]
VALIDATION_FLAG: [any suspicious/invalid info detected — or "clean"]
BLOCKER: [blocker or "none"]
---
STRATEGY: [what the caller should do — NEVER "introduce self" if Maya already spoke]
KEY_LINE: [essential content to convey]
TONE: [warm/assertive/empathetic/urgent/casual]
SPECIAL: [optional: spell name, read back number, end call, DTMF instruction, CHALLENGE specific info]

CRITICAL RULES:
- NEVER instruct Maya to introduce herself if there are already assistant messages in the conversation.
- If the human just said "hello" or a greeting, SKIP introductions and state the PURPOSE of the call.
- Progress toward the objective every turn. Do not repeat previous turns.
- ALWAYS validate information before accepting it. You are a SMART agent — act like one.
- If info seems fake, placeholder, or impossible, instruct Maya to politely challenge it.
- Use common sense: real flight numbers are 1-4 digits and not all zeros, dates must be logically consistent, prices should be realistic for the item.

If IVR detected, issue navigation instructions (DTMF or voice keywords).
If objective achieved: STRATEGY: END_CALL — objective met.
If call is going nowhere: STRATEGY: END_CALL — objective not achievable.

Be decisive. One clear instruction per turn.`;
}

const CALLER_SYSTEM = `You are MAYA, the voice on the phone call. You speak directly to the human.

You receive a DIRECTIVE from the Director telling you WHAT to say. Your job is to say it in your voice — warm, professional, human, and phone-appropriate.

YOUR PERSONA RULES:
- Sound like a skilled, calm, efficient human caller
- Use contractions (I'm, we'll, that's)
- Short sentences: 5-14 words preferred
- One question per turn, then yield
- Light conversational fillers when natural: "got it", "mm-hm", "right", "one sec"
- Never say "As an AI" or "I'm an AI" unless directly asked
- If asked if you're AI/automated: answer honestly and briefly, then continue the task
- Micro-acknowledgements: "Got it." "Okay." "Makes sense."
- Validate emotions briefly, then pivot to action
- If the human is impatient, match their speed — be fast and direct
- Read back critical details (names, numbers, dates, prices)
- For IVR/automated systems: respond with the appropriate menu selection or keyword
- For voicemail: leave a short professional message with callback info
- End turns with a question or clear handoff to let them speak

OUTPUT: Write ONLY what you would say out loud. No stage directions, no markdown, no commentary. Pure speech.`;

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const messages: Array<{ role: string; content: string }> = body.messages || [];

    const systemMessage = messages.find((m) => m.role === "system")?.content || "";
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const recentMessages = conversationMessages.slice(-10);
    const transcript = recentMessages
      .map((m) => `${m.role === "user" ? "HUMAN" : "MAYA"}: ${m.content}`)
      .join("\n");

    const userMessages = conversationMessages.filter((m) => m.role === "user");
    const assistantMessages = conversationMessages.filter((m) => m.role === "assistant");
    const lastUserMessage = userMessages.pop()?.content || "";
    const turnNumber = userMessages.length + (lastUserMessage ? 1 : 0);

    console.log(`[relay] Turn ${turnNumber}, user msgs: ${userMessages.length + (lastUserMessage ? 1 : 0)}, assistant msgs: ${assistantMessages.length}, lastUser: "${lastUserMessage.substring(0, 60)}"`);

    // No conversation yet and no user message — generate opening line
    if (!lastUserMessage && conversationMessages.length === 0) {
      const openingDirective = "Introduce yourself and state the purpose of the call. Be warm and concise.";
      const opening = await llm(
        CALLER_SYSTEM,
        `SYSTEM CONTEXT:\n${systemMessage}\n\nDIRECTIVE: ${openingDirective}`,
      );
      return buildResponse(opening || "Hi — this is Maya. How can I help you today?");
    }

    // ElevenLabs sent conversation but user hasn't spoken yet — wait silently
    if (!lastUserMessage && assistantMessages.length > 0) {
      console.log("[relay] No user message yet, returning brief acknowledgement");
      return buildResponse("...");
    }

    // ── Fetch operator injections from DB ────────────────────────────────
    let operatorInjections: string[] = [];
    try {
      const taskIdMatch = systemMessage.match(/task_id[:\s="']+([a-f0-9-]+)/i);
      if (taskIdMatch) {
        const supabase = getSupabase();
        const { data: task } = await supabase
          .from("agent_tasks")
          .select("result")
          .eq("id", taskIdMatch[1])
          .single();

        const result = task?.result as any;
        if (result?.operatorInjections?.length) {
          operatorInjections = result.operatorInjections;
          // Clear injections after consuming
          await supabase.from("agent_tasks").update({
            result: { ...result, operatorInjections: [] },
          }).eq("id", taskIdMatch[1]);
        }
      }
    } catch (e) {
      console.warn("[relay] Could not fetch operator injections:", e);
    }

    // ── Step 1: DIRECTOR (analysis + strategy in one pass) ───────────────
    // Inject current date/time so Director can validate dates
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" });

    const directorSystem = buildDirectorSystem(systemMessage, operatorInjections, turnNumber);
    const directorInput = `CURRENT DATE/TIME: ${dateStr}, ${timeStr} (Central Time)\n\nCONVERSATION:\n${transcript}\n\nLATEST HUMAN MESSAGE: "${lastUserMessage}"`;

    let directive: string;
    try {
      directive = await llm(directorSystem, directorInput);
    } catch {
      directive = `PHASE: unknown\nINTENT: ${lastUserMessage}\nEMOTION: neutral\nIVR: false\nKEY_INFO: none\nBLOCKER: none\n---\nSTRATEGY: Respond naturally to what the human said.\nKEY_LINE: Address their message.\nTONE: warm`;
    }

    console.log("[relay] Director:", directive.substring(0, 250));

    // Check for END_CALL
    if (directive.includes("END_CALL")) {
      const isSuccess = directive.toLowerCase().includes("objective met");
      const closingLine = isSuccess
        ? await llm(CALLER_SYSTEM, `DIRECTIVE: Wrap up the call positively — the objective has been met. Thank them and say goodbye.\n\nCONVERSATION:\n${transcript}`)
        : await llm(CALLER_SYSTEM, `DIRECTIVE: Politely end the call — the objective cannot be achieved here. Thank them for their time.\n\nCONVERSATION:\n${transcript}`);

      // Log outcome
      try {
        const taskIdMatch = systemMessage.match(/task_id[:\s="']+([a-f0-9-]+)/i);
        if (taskIdMatch) {
          const supabase = getSupabase();
          await supabase.from("agent_tasks").update({
            status: isSuccess ? "completed" : "failed",
            completed_at: new Date().toISOString(),
            result: {
              objective_met: isSuccess,
              final_directive: directive,
            },
          }).eq("id", taskIdMatch[1]);
        }
      } catch (e) {
        console.warn("[relay] Could not update task:", e);
      }

      return buildResponse(closingLine || "Thank you so much for your time. Take care!");
    }

    // ── Step 2: CALLER (Maya) ────────────────────────────────────────────
    const callerInput = `DIRECTIVE FROM DIRECTOR:\n${directive}\n\nCONVERSATION SO FAR:\n${transcript}\n\nRespond as Maya. Say ONLY what you would speak aloud.`;

    let spokenResponse: string;
    try {
      spokenResponse = await llm(CALLER_SYSTEM, callerInput);
    } catch {
      spokenResponse = "I'm sorry, could you repeat that?";
    }

    console.log("[relay] Maya says:", spokenResponse.substring(0, 100));

    return buildResponse(spokenResponse);

  } catch (e) {
    console.error("[relay] Fatal error:", e);
    return buildResponse("I'm sorry — could you say that again?");
  }
});

// ─── Streaming SSE Response Builder ───────────────────────────────────────────
// ElevenLabs Custom LLM requires streaming SSE format for voice to work.
// We simulate streaming by sending the complete text as chunked SSE events.

function buildResponse(content: string): Response {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  // Split content into small chunks for streaming feel
  const words = content.split(" ");
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    chunks.push(words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : ""));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send each chunk as an SSE event
      for (const chunk of chunks) {
        const event = {
          id,
          object: "chat.completion.chunk",
          created,
          model: "maya-director-caller-v2",
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null,
          }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // Send final chunk with finish_reason
      const finalEvent = {
        id,
        object: "chat.completion.chunk",
        created,
        model: "maya-director-caller-v2",
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "stop",
        }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalEvent)}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
