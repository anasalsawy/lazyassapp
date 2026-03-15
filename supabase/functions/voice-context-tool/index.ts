import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * voice-context-tool — ElevenLabs Server Tool webhook.
 *
 * Called by the ElevenLabs native LLM agent every turn via get_mission_context.
 * Fetches mission context from agent_tasks, runs Planner (Analyst+Director),
 * and returns structured guidance for the agent to follow.
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

// ── Planner Prompt (Analyst + Director combined) ──────────────────────────
const PLANNER_PROMPT = `You are the Planner for a live phone call.
You combine two jobs:
1. Analyst: determine what is happening on the call.
2. Director: decide the next move for the caller agent.

You receive the transcript summary, objective, constraints, and any live operator updates.
Do not roleplay as the caller. Do not explain your reasoning.

Return EXACTLY one JSON object and nothing else:
{
  "is_automated": false,
  "automated_type": "none|ivr_menu|voicemail|hold_message|greeting_recording|transfer_system",
  "tone": "neutral|friendly|hostile|impatient|confused|interested|skeptical|stressed|warm|robotic",
  "intent": "one short sentence",
  "engagement": "low|moderate|high",
  "risks": ["short labels"],
  "opportunities": ["short labels"],
  "action": "CONTINUE|WAIT|END_CALL",
  "instruction": "one concise execution directive for the caller agent",
  "suggested_tone": "warm|professional|empathetic|direct|calm|urgent",
  "should_end": false,
  "priority": "the single highest-priority concern"
}

Rules:
- Operator updates have highest priority after safety.
- If the other side is automated, set is_automated true and choose the best automated_type.
- For hold messages, instruction should usually be WAIT.
- Keep instruction terse, concrete, and immediately executable.
- Set should_end true only when the objective is complete or the call should stop.`;

async function runPlanner(
  objective: string,
  constraints: string,
  transcript: string,
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
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
  });

  const userContent = `TODAY: ${dateStr} (${timeStr} CT)
OBJECTIVE: ${objective}
CONSTRAINTS: ${constraints || "None"}
TURN: ${turnCount}

RECENT TRANSCRIPT:
${transcript || "(no transcript yet)"}
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
    console.error("[voice-context-tool] Planner error:", resp.status, await resp.text());
    return {
      is_automated: false, tone: "neutral", intent: "unknown",
      action: "CONTINUE", instruction: "Continue the conversation naturally.",
      suggested_tone: "professional", should_end: false, priority: "maintain rapport",
    };
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[voice-context-tool] JSON parse error:", e);
  }

  return {
    is_automated: false, tone: "neutral", intent: "unknown",
    action: "CONTINUE", instruction: content || "Continue naturally.",
    suggested_tone: "professional", should_end: false, priority: "continue",
  };
}

// ── Main Handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const taskId = body.task_id || "";
    const transcript = body.transcript || "";

    console.log(`[voice-context-tool] task_id=${taskId}, transcript_len=${transcript.length}`);

    if (!taskId) {
      return new Response(JSON.stringify({
        guidance: "No task context available. Continue the conversation naturally.",
        instruction: "Continue naturally.",
        operator_instruction: "",
        should_end: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabase();

    // Fetch task context
    const { data: task, error: taskError } = await supabase
      .from("agent_tasks")
      .select("id, payload, result, status, mode")
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      console.error("[voice-context-tool] Task not found:", taskId, taskError);
      return new Response(JSON.stringify({
        guidance: "Task context not found. Continue the conversation naturally.",
        instruction: "Continue naturally.",
        operator_instruction: "",
        should_end: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = (task.payload as any) || {};
    const result = (task.result as any) || {};
    const operatorInjections: string[] = result.operatorInjections || [];
    const turnCount = (result.turnCount || 0) + 1;

    // Run Planner (Analyst + Director)
    const directive = await runPlanner(
      config.objective || "Help the caller effectively.",
      config.constraints || "",
      transcript,
      operatorInjections,
      turnCount
    );

    console.log(`[voice-context-tool] Planner result: instruction="${String(directive.instruction).substring(0, 80)}", end=${directive.should_end}`);

    // Persist state: consume injections, update turn count, store directive + transcript
    const injectionHistory = result.operatorInjectionHistory || [];
    const directiveHistory = result.directorDirectiveHistory || [];
    const conversationHistory: Array<{ role: string; content: string }> = result.conversationHistory || [];

    // Append transcript as a user turn if we have content
    if (transcript && transcript.trim()) {
      // Parse transcript to extract latest exchanges
      // The transcript comes as a summary from the Native LLM — store it as-is
      const existingLen = conversationHistory.length;
      // Only append if this looks like new content (avoid duplicates)
      const lastEntry = conversationHistory[conversationHistory.length - 1];
      const trimmedTranscript = transcript.trim();
      if (!lastEntry || lastEntry.content !== trimmedTranscript) {
        // Try to split transcript into user/assistant turns
        const lines = trimmedTranscript.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (lower.startsWith("user:") || lower.startsWith("human:") || lower.startsWith("caller:")) {
            conversationHistory.push({ role: "user", content: line.replace(/^(user|human|caller):\s*/i, "").trim() });
          } else if (lower.startsWith("agent:") || lower.startsWith("assistant:") || lower.startsWith("maya:")) {
            conversationHistory.push({ role: "assistant", content: line.replace(/^(agent|assistant|maya):\s*/i, "").trim() });
          } else if (existingLen === 0 && lines.length === 1) {
            // Single line transcript with no prefix — treat as user speech
            conversationHistory.push({ role: "user", content: line.trim() });
          }
        }
      }
    }

    await supabase.from("agent_tasks").update({
      result: {
        ...result,
        turnCount,
        lastTurnAt: new Date().toISOString(),
        lastDirectorDirective: directive,
        conversationHistory: conversationHistory.slice(-50),
        directorDirectiveHistory: [
          ...directiveHistory.slice(-10),
          { ...directive, turn: turnCount, at: new Date().toISOString() },
        ],
        operatorInjections: [],
        operatorInjectionHistory: [
          ...injectionHistory,
          ...operatorInjections.map((inj: string) => ({
            text: inj,
            consumedAt: new Date().toISOString(),
            turn: turnCount,
          })),
        ],
      },
    }).eq("id", taskId);

    // Build response for the ElevenLabs native LLM
    const response: any = {
      // Core directive for the agent
      instruction: directive.instruction || "Continue the conversation naturally.",
      suggested_tone: directive.suggested_tone || "professional",
      priority: directive.priority || "continue",
      should_end: directive.should_end || false,

      // Mission context (refreshed every turn)
      objective: config.objective || "",
      script: config.script || "",
      constraints: config.constraints || "",
      agent_name: config.agent_name || "Maya",
      company_name: config.company_name || config.caller_name || "",

      // Analyst intelligence
      is_automated: directive.is_automated || false,
      automated_type: directive.automated_type || "none",
      tone_detected: directive.tone || "neutral",
      intent_detected: directive.intent || "",
      engagement: directive.engagement || "moderate",
      risks: directive.risks || [],
      opportunities: directive.opportunities || [],

      // Operator steering
      operator_instruction: operatorInjections.length > 0
        ? operatorInjections.join(". ")
        : "",
      has_operator_update: operatorInjections.length > 0,

      // Action
      action: directive.action || "CONTINUE",

      // Turn info
      turn: turnCount,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[voice-context-tool] Error:", e);
    return new Response(JSON.stringify({
      guidance: "Internal error. Continue the conversation naturally.",
      instruction: "Continue naturally.",
      operator_instruction: "",
      should_end: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
