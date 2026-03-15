import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * voice-context-tool — ElevenLabs Server Tool webhook.
 *
 * Called by the ElevenLabs native LLM agent via get_mission_context.
 * Fetches mission context from agent_tasks, runs Planner (Analyst+Director),
 * and returns structured guidance for the agent to follow.
 *
 * If the LLM doesn't pass transcript, we self-fetch from ElevenLabs API.
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

function getElevenLabsKey(): string {
  return Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY") || "";
}

// ── Fetch transcript from ElevenLabs REST API ─────────────────────────────
async function fetchTranscriptFromElevenLabs(conversationId: string): Promise<string> {
  const apiKey = getElevenLabsKey();
  if (!apiKey || !conversationId) return "";

  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
      { headers: { "xi-api-key": apiKey, "Content-Type": "application/json" } }
    );
    if (!resp.ok) {
      console.log(`[voice-context-tool] ElevenLabs transcript fetch failed: ${resp.status}`);
      return "";
    }
    const data = await resp.json();
    const transcript = Array.isArray(data?.transcript) ? data.transcript : [];
    
    return transcript
      .map((item: any) => {
        const roleRaw = String(item?.role || item?.speaker || item?.source || "").toLowerCase();
        const role = ["agent", "assistant", "ai", "maya", "bot"].includes(roleRaw) ? "Maya" : "Customer";
        const content = String(item?.message ?? item?.text ?? item?.content ?? item?.transcript ?? "").trim();
        return content ? `${role}: ${content}` : "";
      })
      .filter(Boolean)
      .join("\n");
  } catch (e) {
    console.error("[voice-context-tool] transcript fetch error:", e);
    return "";
  }
}

// ── Discover conversationId from ElevenLabs conversations list ────────────
async function discoverConversationId(agentId: string): Promise<string> {
  const apiKey = getElevenLabsKey();
  if (!apiKey || !agentId) return "";

  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=5`,
      { headers: { "xi-api-key": apiKey } }
    );
    if (!resp.ok) return "";
    const data = await resp.json();
    const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
    // Return the most recent active conversation
    const active = conversations.find((c: any) => c.status === "processing" || c.status === "active");
    return active?.conversation_id || conversations[0]?.conversation_id || "";
  } catch {
    return "";
  }
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
    let transcript = body.transcript || "";

    console.log(`[voice-context-tool] INVOKED task_id=${taskId}, transcript_len=${transcript.length}, keys=${Object.keys(body).join(",")}`);

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

    // ── Self-fetch transcript if not provided ──
    // ElevenLabs may not pass transcript as a tool parameter.
    // Fall back to: 1) ElevenLabs REST API, 2) DB conversationHistory
    if (!transcript || transcript.trim().length === 0) {
      console.log("[voice-context-tool] No transcript from LLM, attempting self-fetch...");
      
      let conversationId = result.conversationId || "";
      
      // Discover conversationId if missing
      if (!conversationId) {
        const agentId = Deno.env.get("ELEVENLABS_AGENT_B_ID") || Deno.env.get("ELEVENLABS_AGENT_A_ID") || "";
        if (agentId) {
          conversationId = await discoverConversationId(agentId);
          if (conversationId) {
            console.log(`[voice-context-tool] Discovered conversationId: ${conversationId}`);
          }
        }
      }
      
      if (conversationId) {
        transcript = await fetchTranscriptFromElevenLabs(conversationId);
        console.log(`[voice-context-tool] Self-fetched transcript: ${transcript.length} chars`);
        
        // Persist conversationId if we discovered it
        if (!result.conversationId && conversationId) {
          result.conversationId = conversationId;
        }
      }
      
      // Last fallback: reconstruct from DB history
      if (!transcript && result.conversationHistory?.length > 0) {
        transcript = result.conversationHistory
          .map((m: any) => `${m.role === "assistant" ? "Maya" : "Customer"}: ${m.content}`)
          .join("\n");
        console.log(`[voice-context-tool] Used DB history: ${transcript.length} chars`);
      }
    }

    // Run Planner (Analyst + Director)
    const directive = await runPlanner(
      config.objective || "Help the caller effectively.",
      config.constraints || "",
      transcript,
      operatorInjections,
      turnCount
    );

    console.log(`[voice-context-tool] Planner result: instruction="${String(directive.instruction).substring(0, 80)}", end=${directive.should_end}, turn=${turnCount}`);

    // Persist state: consume injections, update turn count, store directive + transcript
    const injectionHistory = result.operatorInjectionHistory || [];
    const directiveHistory = result.directorDirectiveHistory || [];
    let conversationHistory: Array<{ role: string; content: string }> = result.conversationHistory || [];

    // Parse transcript into structured history
    if (transcript && transcript.trim()) {
      const trimmedTranscript = transcript.trim();
      const lines = trimmedTranscript.split("\n").filter((l: string) => l.trim());
      
      const parsed: Array<{ role: string; content: string }> = [];
      const rolePrefixRegex = /^(user|human|caller|customer|recipient|agent|assistant|maya|ai|bot):\s*/i;
      
      let hasPrefixes = false;
      for (const line of lines) {
        if (rolePrefixRegex.test(line.trim())) { hasPrefixes = true; break; }
      }
      
      if (hasPrefixes) {
        let currentRole = "";
        let currentContent = "";
        for (const line of lines) {
          const match = line.trim().match(rolePrefixRegex);
          if (match) {
            if (currentRole && currentContent.trim()) {
              parsed.push({ role: currentRole, content: currentContent.trim() });
            }
            const prefix = match[1].toLowerCase();
            currentRole = ["agent", "assistant", "maya", "ai", "bot"].includes(prefix) ? "assistant" : "user";
            currentContent = line.substring(match[0].length).trim();
          } else {
            currentContent += " " + line.trim();
          }
        }
        if (currentRole && currentContent.trim()) {
          parsed.push({ role: currentRole, content: currentContent.trim() });
        }
      } else {
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const lastRole = parsed[parsed.length - 1]?.role;
          parsed.push({ role: lastRole === "user" ? "assistant" : "user", content: trimmed });
        }
      }
      
      if (parsed.length > 0 && parsed.length >= conversationHistory.length) {
        conversationHistory = parsed;
      }
      
      result.lastRawTranscript = trimmedTranscript;
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
      instruction: directive.instruction || "Continue the conversation naturally.",
      suggested_tone: directive.suggested_tone || "professional",
      priority: directive.priority || "continue",
      should_end: directive.should_end || false,
      objective: config.objective || "",
      script: config.script || "",
      constraints: config.constraints || "",
      agent_name: config.agent_name || "Maya",
      company_name: config.company_name || config.caller_name || "",
      is_automated: directive.is_automated || false,
      automated_type: directive.automated_type || "none",
      tone_detected: directive.tone || "neutral",
      intent_detected: directive.intent || "",
      engagement: directive.engagement || "moderate",
      risks: directive.risks || [],
      opportunities: directive.opportunities || [],
      operator_instruction: operatorInjections.length > 0
        ? operatorInjections.join(". ")
        : "",
      has_operator_update: operatorInjections.length > 0,
      action: directive.action || "CONTINUE",
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