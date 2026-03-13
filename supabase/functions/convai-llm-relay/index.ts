import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * convai-llm-relay — OpenAI-compatible Custom LLM endpoint for ElevenLabs ConvAI.
 * 
 * Architecture:
 *   ElevenLabs sends conversation transcript → Relay runs Planner (Analyst+Director) → 
 *   Builds Executor (Maya) prompt → Streams response back via SSE.
 * 
 * Key features:
 *   - Server Tool: `get_director_instructions` — Maya pulls live operator injections
 *   - Fast-path: Simple operator injections skip full Planner reasoning
 *   - Turn tracking: Suppresses redundant greetings after turn 0
 *   - SSE streaming: Real-time text-to-speech compatibility
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// ── Context Resolver ──────────────────────────────────────────────────────
// Extracts taskId from ElevenLabs request body (system message contains "Task ID: xxx")
// Falls back to querying for the most recent running voice task.
interface RelayContext {
  taskId: string;
  callSid: string;
  conversationId: string;
  config: any;
  result: any;
  turnCount: number;
  operatorInjections: string[];
}

async function resolveRelayContext(
  messages: any[],
  supabase: any
): Promise<RelayContext | null> {
  // Try to extract task_id from system message
  let taskId = "";
  for (const msg of messages) {
    if (msg.role === "system" && typeof msg.content === "string") {
      const match = msg.content.match(/Task ID:\s*([a-f0-9-]+)/i);
      if (match) {
        taskId = match[1];
        break;
      }
    }
  }

  // Fallback: find most recent running voice task
  if (!taskId) {
    const { data: tasks } = await supabase
      .from("agent_tasks")
      .select("id")
      .in("task_type", ["voice_call_multi_agent", "voice_mission"])
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1);

    if (tasks?.[0]) taskId = tasks[0].id;
  }

  if (!taskId) return null;

  const { data: task } = await supabase
    .from("agent_tasks")
    .select("id, payload, result, status")
    .eq("id", taskId)
    .single();

  if (!task) return null;

  const result = task.result as any || {};
  return {
    taskId: task.id,
    callSid: result.callSid || "",
    conversationId: result.conversationId || "",
    config: task.payload as any || {},
    result,
    turnCount: result.turnCount || 0,
    operatorInjections: result.operatorInjections || [],
  };
}

// ── Planner (Analyst + Director combined) ─────────────────────────────────
const PLANNER_PROMPT = `You are the Planner brain for a live phone call. You combine the roles of Analyst (evaluating what's happening) and Director (deciding strategy).

You receive the conversation transcript, the call objective, and any live operator injections.

Output EXACTLY this JSON (nothing else):
{
  "is_automated": false,
  "automated_type": "none",
  "tone": "neutral|friendly|hostile|impatient|confused|interested|skeptical",
  "intent": "brief description",
  "engagement": "low|moderate|high",
  "risks": [],
  "opportunities": [],
  "instruction": "What Maya should say/do next — be specific and actionable",
  "suggested_tone": "warm|professional|empathetic|direct|casual",
  "dtmf": "digit to press or 'none'",
  "should_end": false,
  "priority": "what matters most right now"
}

RULES:
- If operator injections are present, they are HIGHEST PRIORITY — incorporate them into your instruction
- For IVR/automated systems: set is_automated=true and provide dtmf digit
- For hold messages: instruction should be "WAIT"
- Keep instructions concise and actionable
- If the objective is achieved, set should_end=true`;

async function runPlanner(
  objective: string,
  constraints: string,
  transcript: Array<{ role: string; content: string }>,
  operatorInjections: string[],
  turnCount: number
): Promise<any> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const injectionText = operatorInjections.length > 0
    ? `\n\n⚡ LIVE OPERATOR INJECTIONS (HIGHEST PRIORITY):\n${operatorInjections.map((inj, i) => `${i + 1}. ${inj}`).join("\n")}`
    : "";

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/Chicago",
  });

  const userContent = `TODAY: ${dateStr}
OBJECTIVE: ${objective}
CONSTRAINTS: ${constraints || "None"}
TURN: ${turnCount}

CONVERSATION (last 8 turns):
${transcript.slice(-16).map((t) => `${t.role}: ${t.content}`).join("\n")}
${injectionText}

Analyze and provide your directive.`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: PLANNER_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 400,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    console.error("[relay-planner] Error:", resp.status, await resp.text());
    return {
      is_automated: false, tone: "neutral", intent: "unknown",
      instruction: "Continue the conversation naturally",
      suggested_tone: "professional", dtmf: "none", should_end: false,
      priority: "maintain rapport",
    };
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[relay-planner] JSON parse error:", e);
  }

  return {
    is_automated: false, tone: "neutral", intent: "unknown",
    instruction: content || "Continue naturally",
    suggested_tone: "professional", dtmf: "none", should_end: false,
    priority: "continue",
  };
}

// ── Sanitize prompt lines ─────────────────────────────────────────────────
function sanitizePrompt(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("/*") && !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

// ── Build Executor (Maya) system prompt ───────────────────────────────────
function buildExecutorPrompt(config: any, directive: any, turnCount: number): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/Chicago",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
  });

  const missionContext = `## MISSION CONTEXT
You are ${config.agent_name || "Maya"}, ${config.agent_role || "an AI assistant"}.
You are making an OUTBOUND call on behalf of ${config.company_name || config.caller_name || "the organization"}.
TODAY: ${dateStr} (${timeStr} CT)
OBJECTIVE: ${config.objective}
${config.script ? `SCRIPT/NOTES: ${config.script}` : ""}
${config.constraints ? `CONSTRAINTS: ${config.constraints}` : ""}`;

  const directorBlock = directive
    ? `\n\n[DIRECTOR INSTRUCTION]: ${directive.instruction}\n[TONE]: ${directive.suggested_tone || "professional"}\n[PRIORITY]: ${directive.priority || "continue"}`
    : "";

  // Suppress greeting after turn 0
  const greetingSuppression = turnCount > 0
    ? "\n\nCRITICAL: Do NOT re-introduce yourself or greet again. The call is already in progress. Continue naturally from where the conversation left off."
    : "";

  return sanitizePrompt(`${CALLER_PRODUCTION_PROMPT}

${missionContext}
${directorBlock}
${greetingSuppression}

RESPONSE RULES:
- Output ONLY what you would SAY on the phone
- 1-3 sentences MAX
- Sound natural and human
- If ending the call, include [END_CALL] at the very end`);
}

// ── SSE Stream Helper ─────────────────────────────────────────────────────
function createSSEStream(
  text: string,
  onComplete?: () => void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      // Stream text in chunks to simulate streaming
      const words = text.split(" ");
      let i = 0;

      function pushChunk() {
        if (i >= words.length) {
          // Send [DONE]
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          onComplete?.();
          return;
        }

        const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
        const sseData = {
          id: `chatcmpl-relay-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "convai-llm-relay",
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null,
          }],
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseData)}\n\n`));
        i += 3;
        // Small delay for natural streaming feel
        setTimeout(pushChunk, 20);
      }

      pushChunk();
    },
  });
}

// ── Main Handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── Server Tool endpoint: get_director_instructions ──
  // ElevenLabs can call this as a Server Tool so Maya pulls instructions
  if (action === "get-instructions") {
    const body = await req.json();
    const taskId = body.task_id || url.searchParams.get("task_id") || "";

    if (!taskId) {
      return new Response(JSON.stringify({ instructions: [], message: "No task_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabase();
    const { data: task } = await supabase
      .from("agent_tasks")
      .select("result")
      .eq("id", taskId)
      .single();

    const result = task?.result as any;
    const injections = result?.operatorInjections || [];

    // Consume injections — move to history
    if (injections.length > 0) {
      const injectionHistory = result?.operatorInjectionHistory || [];
      await supabase.from("agent_tasks").update({
        result: {
          ...result,
          operatorInjections: [],
          operatorInjectionHistory: [
            ...injectionHistory,
            ...injections.map((inj: string) => ({
              text: inj,
              consumedAt: new Date().toISOString(),
            })),
          ],
        },
      }).eq("id", taskId);
    }

    return new Response(JSON.stringify({
      instructions: injections,
      has_instructions: injections.length > 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Main relay: OpenAI-compatible chat completions endpoint ──
  try {
    const body = await req.json();
    const messages: any[] = body.messages || [];
    const stream = body.stream !== false; // Default to streaming

    console.log(`[relay] Received ${messages.length} messages, stream=${stream}`);

    const supabase = getSupabase();
    const ctx = await resolveRelayContext(messages, supabase);

    if (!ctx) {
      console.error("[relay] Could not resolve relay context");
      const fallback = "I apologize, I'm having a technical issue. Could you give me just a moment?";
      if (stream) {
        return new Response(createSSEStream(fallback), {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: fallback } }],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build conversation transcript from ElevenLabs messages
    const transcript: Array<{ role: string; content: string }> = [];
    for (const msg of messages) {
      if (msg.role === "system") continue; // Skip system messages
      transcript.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      });
    }

    const turnCount = ctx.turnCount + 1;
    const operatorInjections = ctx.operatorInjections;

    // ── Fast-path: Simple operator injections skip full Planner ──
    // If the only new thing is a simple injection (no complex speech to analyze),
    // skip the Planner and inject directly into Executor prompt.
    const latestUserMsg = transcript.filter(t => t.role === "user").pop()?.content || "";
    const isSimpleInjectionOnly = operatorInjections.length > 0 &&
      (!latestUserMsg || latestUserMsg.length < 5);

    let directive: any;

    if (isSimpleInjectionOnly) {
      console.log(`[relay] ⚡ FAST-PATH: Simple injection, skipping Planner`);
      directive = {
        instruction: operatorInjections.join(". "),
        suggested_tone: "natural",
        dtmf: "none",
        should_end: false,
        priority: "operator instruction",
        fast_path: true,
      };
    } else {
      // ── Full Planner reasoning ──
      console.log(`[relay] Running Planner (turn ${turnCount})...`);
      directive = await runPlanner(
        ctx.config.objective || "",
        ctx.config.constraints || "",
        transcript,
        operatorInjections,
        turnCount
      );
      console.log(`[relay] Planner: instruction="${String(directive.instruction).substring(0, 80)}...", dtmf=${directive.dtmf}, end=${directive.should_end}`);
    }

    // ── Handle DTMF (IVR) — send via Twilio REST API ──
    if (directive.dtmf && directive.dtmf !== "none" && ctx.callSid) {
      // Check duplicate with 8-second cooldown
      const lastDtmf = ctx.result?.lastDtmfAt ? new Date(ctx.result.lastDtmfAt).getTime() : 0;
      const now = Date.now();

      if (now - lastDtmf > 8000) {
        console.log(`[relay] 📱 Injecting DTMF: ${directive.dtmf}`);

        const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
        const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

        if (TWILIO_SID && TWILIO_TOKEN) {
          try {
            const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Play digits="${directive.dtmf}"/><Pause length="2"/></Response>`;
            await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls/${ctx.callSid}.json`,
              {
                method: "POST",
                headers: {
                  Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ Twiml: twiml }).toString(),
              }
            );

            await supabase.from("agent_tasks").update({
              result: { ...ctx.result, lastDtmfAt: new Date().toISOString(), lastDtmfDigit: directive.dtmf },
            }).eq("id", ctx.taskId);
          } catch (e) {
            console.error("[relay] DTMF injection failed:", e);
          }
        }
      } else {
        console.log(`[relay] DTMF cooldown active, skipping duplicate`);
      }
    }

    // ── Generate Executor (Maya) response ──
    const executorPrompt = buildExecutorPrompt(ctx.config, directive, turnCount);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const executorMessages = [
      { role: "system", content: executorPrompt },
      ...transcript.slice(-10),
    ];

    if (stream) {
      // Stream response from OpenAI directly through to ElevenLabs
      const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: executorMessages,
          max_tokens: 200,
          temperature: 0.7,
          stream: true,
        }),
      });

      if (!openaiResp.ok || !openaiResp.body) {
        console.error("[relay-executor] OpenAI error:", openaiResp.status);
        return new Response(createSSEStream("I'm sorry, could you repeat that?"), {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      // Persist state in background
      const persistState = async (fullResponse: string) => {
        const conversationHistory = ctx.result?.conversationHistory || [];
        if (latestUserMsg) {
          conversationHistory.push({ role: "user", content: latestUserMsg });
        }
        conversationHistory.push({ role: "assistant", content: fullResponse });

        const consumedInjections = [...operatorInjections];
        const injectionHistory = ctx.result?.operatorInjectionHistory || [];

        await supabase.from("agent_tasks").update({
          result: {
            ...ctx.result,
            conversationHistory: conversationHistory.slice(-30),
            turnCount,
            lastTurnAt: new Date().toISOString(),
            lastDirectorDirective: directive,
            directorDirectiveHistory: [
              ...(ctx.result?.directorDirectiveHistory || []).slice(-10),
              { ...directive, turn: turnCount, at: new Date().toISOString() },
            ],
            operatorInjections: [],
            operatorInjectionHistory: [
              ...injectionHistory,
              ...consumedInjections.map((inj: string) => ({
                text: inj,
                consumedAt: new Date().toISOString(),
                turn: turnCount,
              })),
            ],
          },
        }).eq("id", ctx.taskId);
      };

      // Pipe OpenAI's SSE stream through, collecting full response
      const reader = openaiResp.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      const passthrough = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            // Persist in background
            (globalThis as any).EdgeRuntime?.waitUntil?.(persistState(fullResponse));
            return;
          }

          // Parse chunks to collect full response
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n")) {
            if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) fullResponse += content;
            } catch { /* ignore partial chunks */ }
          }

          controller.enqueue(value);
        },
      });

      return new Response(passthrough, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming fallback
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: executorMessages,
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    const openaiData = await openaiResp.json();
    const responseContent = openaiData.choices?.[0]?.message?.content || "Could you repeat that?";

    // Persist state
    const conversationHistory = ctx.result?.conversationHistory || [];
    if (latestUserMsg) conversationHistory.push({ role: "user", content: latestUserMsg });
    conversationHistory.push({ role: "assistant", content: responseContent });

    await supabase.from("agent_tasks").update({
      result: {
        ...ctx.result,
        conversationHistory: conversationHistory.slice(-30),
        turnCount,
        lastTurnAt: new Date().toISOString(),
        lastDirectorDirective: directive,
        operatorInjections: [],
      },
    }).eq("id", ctx.taskId);

    return new Response(JSON.stringify({
      id: `chatcmpl-relay-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "convai-llm-relay",
      choices: [{
        index: 0,
        message: { role: "assistant", content: responseContent },
        finish_reason: "stop",
      }],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[relay] Error:", e);
    const errorMsg = "I'm sorry, I'm having a technical issue. Could you hold for just a moment?";

    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: errorMsg } }],
    }), {
      status: 200, // Return 200 so ElevenLabs doesn't retry
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION CALLER SYSTEM PROMPT (Maya persona)
// ═══════════════════════════════════════════════════════════════════════════
const CALLER_PRODUCTION_PROMPT = `Operating identity and persona
Identity of the AI caller
You are a real-time voice calling assistant that speaks with humans over the phone and completes practical tasks end-to-end (inbound and outbound). You represent the organization configured by the runtime.
Use and obey the runtime-provided call context (if present). Treat it as authoritative.

Disclosure policy: Default to disclose_if_asked when unspecified.
Non-deception rule (always):
Never claim to be a human if asked directly.
Never invent a personal history, job tenure, or "I'm calling from my desk" details.
If asked whether you are AI/automated, answer clearly and briefly, then continue the task.

Personality and speaking style
Sound like a highly skilled, calm, efficient human caller. Your "human-ness" comes from timing, brevity, empathy, and flexibility—not from pretending to be a person with a body.
Required style attributes:
Warm, competent, unhurried.
Respectful and confident; never clingy; never submissive to hostility.
Uses contractions ("I'm," "we'll," "that's").
Uses light, occasional conversational fillers when appropriate: "mm-hm," "okay," "got it," "one sec," "right," "thanks." Do not overuse.
Avoids scripts that sound "customer-service robotic." Vary phrasing while preserving meaning.
Speaks in short, phone-friendly sentences. Prefer 5–14 words per sentence.
If a list is needed, cap it at 3 items, then pause for confirmation.

Voice conversation rules
Your outputs are spoken audio. Write what you would say (not stage directions). Do not output markdown, emojis, or system commentary.
Core voice rules:
Keep each turn brief: typically 1–2 sentences, then yield.
Ask one question at a time.
Confirm critical details using readbacks (names, numbers, dates, money, addresses).
Avoid long monologues; chunk information and check understanding.
Never say "As an AI language model."

Conversation mechanics and etiquette
Opening etiquette (especially outbound):
Introduce yourself and your purpose. Ask if it's a good time. If not, schedule a callback.
During-call etiquette:
Be prepared and concise; keep your "agenda" in mind.

Turn-taking and interruption handling
If the human starts speaking, stop your current thought immediately and yield.
When they finish, acknowledge the interruption neutrally.

Handling speech-to-text errors
For names: "Can you spell that?" then confirm spelling.
For phone numbers: read back in 3-3-4 format.

Billing and payment details over the phone:
You ARE authorized to share billing details when the call objective involves making a booking, reservation, purchase, or payment and the details were provided in the call script.
Provide these details naturally. Read card numbers in groups of four, confirm via readback.

Call closing protocol
State the completed outcome. Read back critical details once. State next steps.
End politely: "Alright—thanks for your time. Take care."

Fail-safe: Step down in complexity if stuck. Summarize what you have and offer the best safe next action.`;
