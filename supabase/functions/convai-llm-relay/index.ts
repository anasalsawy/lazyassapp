import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Custom LLM Relay for ElevenLabs Conversational AI.
 * 
 * ElevenLabs sends OpenAI-compatible /v1/chat/completions requests here.
 * We route them through our Director → Analyst → Caller multi-agent pipeline
 * and return the response in OpenAI format so ElevenLabs speaks it.
 * 
 * ElevenLabs = voice I/O (mic + speaker + turn-taking)
 * This function = the brain (strategy + reasoning)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
    console.error("[convai-llm-relay] AI error:", resp.status, errText);
    throw new Error(`AI error: ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── ANALYST ───────────────────────────────────────────────────────────────
const ANALYST_PROMPT = `You are the Analyst in a multi-agent voice system. Analyze the user's latest speech and output ONLY JSON:
{
  "tone": "neutral|friendly|hostile|confused|interested|skeptical",
  "intent": "brief description",
  "engagement": "low|moderate|high",
  "risks": [],
  "opportunities": [],
  "key_info": "any important facts mentioned",
  "approach": "brief tactical suggestion"
}
No explanations. Just JSON.`;

// ── DIRECTOR ──────────────────────────────────────────────────────────────
const DIRECTOR_PROMPT = `You are the Director in a multi-agent voice system. You receive the Analyst's report and conversation history.

Your job: decide what the Caller should say next.

Rules:
- Keep responses SHORT (1-3 sentences max for phone conversation)
- Be natural, warm, human-sounding
- Account for emotional state
- If the user is asking something, answer helpfully
- If the user wants to end the conversation, wrap up gracefully

Output ONLY the text the Caller should speak. Nothing else. No labels, no prefixes.`;

// ── Per-session state (in-memory, keyed by conversation) ──────────────────
const sessionContexts = new Map<string, string[]>();

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages, model, stream } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract the latest user message
    const userMessages = messages.filter((m: any) => m.role === "user");
    const latestUserMsg = userMessages[userMessages.length - 1]?.content || "";
    
    // Check for contextual updates (sent via sendContextualUpdate from Director)
    // These come as system messages injected by the client
    const systemMessages = messages.filter((m: any) => m.role === "system");
    const contextUpdates = systemMessages
      .map((m: any) => m.content)
      .filter((c: string) => c.includes("[DIRECTOR_CONTEXT]"));

    // Step 1: Run Analyst on latest speech
    const analystInput = `Conversation:\n${messages.map((m: any) => `${m.role}: ${m.content}`).join("\n")}\n\nLatest user speech: "${latestUserMsg}"`;
    
    let analystReport: any;
    try {
      const analystResult = await callAI(ANALYST_PROMPT, [{ role: "user", content: analystInput }], 200);
      const jsonMatch = analystResult.match(/\{[\s\S]*\}/);
      analystReport = jsonMatch ? JSON.parse(jsonMatch[0]) : { tone: "neutral", intent: "unknown", approach: "respond helpfully" };
    } catch {
      analystReport = { tone: "neutral", intent: "unknown", approach: "respond helpfully" };
    }

    // Step 2: Director decides response strategy
    const directorInput = `ANALYST REPORT:\n${JSON.stringify(analystReport)}\n\n${
      contextUpdates.length > 0 ? `LIVE CONTEXT UPDATES:\n${contextUpdates.join("\n")}\n\n` : ""
    }CONVERSATION (last 8 turns):\n${messages.slice(-8).map((m: any) => `${m.role}: ${m.content}`).join("\n")}\n\nWhat should the Caller say next?`;

    const callerResponse = await callAI(DIRECTOR_PROMPT, [{ role: "user", content: directorInput }], 150);

    // Return in OpenAI-compatible format
    if (stream) {
      // Streaming response (SSE format)
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        start(controller) {
          // Send the full response as a single chunk for simplicity
          const chunk = JSON.stringify({
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "convai-relay",
            choices: [{
              index: 0,
              delta: { content: callerResponse },
              finish_reason: null,
            }],
          });
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));

          // Send done
          const doneChunk = JSON.stringify({
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "convai-relay",
            choices: [{
              index: 0,
              delta: {},
              finish_reason: "stop",
            }],
          });
          controller.enqueue(encoder.encode(`data: ${doneChunk}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming response
    return new Response(JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "convai-relay",
      choices: [{
        index: 0,
        message: { role: "assistant", content: callerResponse },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[convai-llm-relay] Error:", e);
    return new Response(JSON.stringify({
      id: `chatcmpl-error`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "convai-relay",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "I'm sorry, could you repeat that?" },
        finish_reason: "stop",
      }],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
