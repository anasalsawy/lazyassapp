import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * convai-llm-relay — Custom LLM endpoint for ElevenLabs Conversational AI
 *
 * ElevenLabs sends the conversation history here on every turn.
 * We run a 3-agent pipeline:
 *   1. ANALYST  — Reads the latest user turn + history. Detects tone, intent,
 *                 IVR/voicemail/gatekeeper, and emotional state.
 *   2. DIRECTOR — Receives the Analyst's report + mission context (injected at
 *                 call start via dynamic_variables). Decides the strategic move:
 *                 what to say, what info to push for, when to pivot, when to end.
 *   3. CALLER   — Maya persona. Takes the Director's instruction and produces
 *                 the actual spoken line, filtered through her 17-section persona
 *                 rules (warmth, brevity, phone etiquette, etc.).
 *
 * The response is returned in OpenAI chat-completion format so ElevenLabs can
 * consume it directly.
 *
 * Operator injections (from the Call Center UI) are pulled from the agent_tasks
 * table and fed into the Director prompt as high-priority instructions.
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
  const res = await fetch("https://ai.gateway.lovable.dev/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

const ANALYST_SYSTEM = `You are the ANALYST in a multi-agent voice calling system.

Your job: Read the latest conversation exchange and produce a concise situational report for the Director.

Detect and report:
- CALL_PHASE: one of greeting | discovery | ivr_menu | voicemail | gatekeeper | hold | negotiation | confirmation | closing | unknown
- HUMAN_INTENT: what the human wants or is saying (1 sentence)
- EMOTIONAL_STATE: calm | confused | impatient | hostile | friendly | neutral
- IVR_DETECTED: true/false — is this an automated system (IVR, voicemail, recording)?
- KEY_INFO_EXTRACTED: any names, dates, prices, confirmation numbers mentioned
- BLOCKER: anything preventing progress (e.g. "on hold", "wrong department", "needs manager")

Output ONLY valid JSON with these fields. No prose, no markdown.`;

function buildDirectorSystem(missionContext: string, operatorInjections: string[]): string {
  const injectionBlock = operatorInjections.length > 0
    ? `\n\n🚨 OPERATOR LIVE INJECTIONS (highest priority — follow these NOW):\n${operatorInjections.map((inj, i) => `${i + 1}. ${inj}`).join("\n")}`
    : "";

  return `You are the DIRECTOR in a multi-agent voice calling system.

You receive:
1. The Analyst's situational report (JSON)
2. The conversation history
3. The mission context (objectives, constraints, allowed actions)

Your job: Decide the STRATEGIC MOVE for this turn.

MISSION CONTEXT:
${missionContext}
${injectionBlock}

OUTPUT FORMAT (plain text, 2-4 lines max):
Line 1: STRATEGY — what the caller should do (e.g., "Introduce yourself and state purpose", "Push for the reservation", "Handle the objection about price")
Line 2: KEY_LINE — the essential content/information to convey (not the exact words — the Caller will phrase it naturally)
Line 3: TONE — suggested emotional register (warm, assertive, empathetic, urgent, casual)
Line 4: (optional) SPECIAL — any special instruction (spell out a name, read back a number, end call, etc.)

If the Analyst reports IVR_DETECTED=true, issue navigation instructions (e.g., "Press 1 for reservations" or "Say 'reservations'").
If the objective is achieved, output: STRATEGY: END_CALL — objective met.
If the call is clearly going nowhere, output: STRATEGY: END_CALL — objective not achievable.

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

    // Extract dynamic variables injected at call start (ElevenLabs sends these in the first system message or as metadata)
    // The system message from ElevenLabs contains our template with injected {{variables}}
    const systemMessage = messages.find((m) => m.role === "system")?.content || "";
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Build conversation transcript for the Analyst
    const recentMessages = conversationMessages.slice(-10); // last 10 turns for context
    const transcript = recentMessages
      .map((m) => `${m.role === "user" ? "HUMAN" : "MAYA"}: ${m.content}`)
      .join("\n");

    const lastUserMessage = conversationMessages.filter((m) => m.role === "user").pop()?.content || "";

    // If no user message yet (first turn), generate opening line
    if (!lastUserMessage && conversationMessages.length === 0) {
      // First turn — let the Caller generate an opening based on the system prompt context
      const openingDirective = "Introduce yourself and state the purpose of the call. Be warm and concise.";
      const opening = await llm(
        CALLER_SYSTEM,
        `SYSTEM CONTEXT:\n${systemMessage}\n\nDIRECTIVE: ${openingDirective}`,
      );

      return buildResponse(opening || "Hi — this is Maya. How can I help you today?");
    }

    // ── Step 1: ANALYST ──────────────────────────────────────────────────
    const analystInput = `CONVERSATION SO FAR:\n${transcript}\n\nLATEST HUMAN MESSAGE: "${lastUserMessage}"`;
    
    let analystReport: string;
    try {
      analystReport = await llm(ANALYST_SYSTEM, analystInput, "google/gemini-2.5-flash-lite");
    } catch {
      // Fallback if Analyst fails — give Director raw info
      analystReport = JSON.stringify({
        CALL_PHASE: "unknown",
        HUMAN_INTENT: lastUserMessage,
        EMOTIONAL_STATE: "neutral",
        IVR_DETECTED: false,
        KEY_INFO_EXTRACTED: {},
        BLOCKER: null,
      });
    }

    console.log("[relay] Analyst report:", analystReport.substring(0, 200));

    // ── Fetch operator injections from DB ────────────────────────────────
    let operatorInjections: string[] = [];
    try {
      // Try to extract task_id from the system message or dynamic variables
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

    // ── Step 2: DIRECTOR ─────────────────────────────────────────────────
    // Mission context comes from the system message (ElevenLabs injects dynamic_variables into it)
    const directorSystem = buildDirectorSystem(systemMessage, operatorInjections);
    const directorInput = `ANALYST REPORT:\n${analystReport}\n\nCONVERSATION:\n${transcript}`;
    
    let directive: string;
    try {
      directive = await llm(directorSystem, directorInput);
    } catch {
      // Fallback — give Caller a generic instruction
      directive = `STRATEGY: Respond naturally to what the human said.\nKEY_LINE: Address their message.\nTONE: warm`;
    }

    console.log("[relay] Director directive:", directive.substring(0, 200));

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
              analyst_report: analystReport,
            },
          }).eq("id", taskIdMatch[1]);
        }
      } catch (e) {
        console.warn("[relay] Could not update task:", e);
      }

      return buildResponse(closingLine || "Thank you so much for your time. Take care!");
    }

    // ── Step 3: CALLER (Maya) ────────────────────────────────────────────
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

// ─── Response Builder ─────────────────────────────────────────────────────────

function buildResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "maya-multi-agent-v1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
