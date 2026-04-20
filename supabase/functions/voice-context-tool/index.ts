import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * voice-context-tool — Pure blackboard reader.
 *
 * Called by ElevenLabs Native LLM via get_mission_context.
 * Does NO LLM calls. Just reads the current blackboard from agent_tasks.result.blackboard
 * and returns it instantly. The Planner runs independently via voice-planner-loop.
 *
 * Blackboard schema (lean, coded entries — never verbose):
 *   blackboard: {
 *     answers: { [key: string]: string },       // e.g. { "price_q": "$42/mo", "hours_q": "9-5 CT" }
 *     info: { [key: string]: string },           // gathered facts e.g. { "rep_name": "Jake", "dept": "billing" }
 *     directions: string | null,                  // next strategic move e.g. "pivot to cancellation offer"
 *     flags: string[],                            // e.g. ["ivr_detected", "hostile_tone"]
 *     operator: string | null,                    // latest operator injection (consumed after read)
 *     end_call: boolean                           // planner says wrap it up
 *   }
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

type ConversationMessage = { role: "assistant" | "user"; content: string };

function normalizeRole(label: string): ConversationMessage["role"] {
  const value = label.trim().toLowerCase();
  if (["agent", "assistant", "ai", "maya", "bot", "caller"].includes(value)) {
    return "assistant";
  }
  return "user";
}

function pushMessage(target: ConversationMessage[], role: ConversationMessage["role"], content: string) {
  const text = content.trim();
  if (!text) return;

  const prev = target[target.length - 1];
  if (prev && prev.role === role) {
    prev.content = `${prev.content}\n${text}`.trim();
    return;
  }

  target.push({ role, content: text });
}

function parseConversationHistory(
  transcript: string,
  existingHistory: ConversationMessage[] = []
): ConversationMessage[] {
  const raw = String(transcript || "").replace(/\r/g, "").trim();
  if (!raw) return existingHistory;

  const speakerRegex = /(^|\n)\s*([A-Za-z][A-Za-z0-9 _-]{0,30}):\s*/g;
  const matches = Array.from(raw.matchAll(speakerRegex));

  if (matches.length === 0) {
    const trimmed = raw.trim();
    if (!trimmed) return existingHistory;

    const last = existingHistory[existingHistory.length - 1];
    if (last?.content?.trim() === trimmed) return existingHistory;

    return [...existingHistory, { role: "user", content: trimmed }].slice(-50);
  }

  const parsed: ConversationMessage[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const label = match[2] || "user";
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
    const content = raw.slice(start, end).trim();
    pushMessage(parsed, normalizeRole(label), content);
  }

  return parsed.length > 0 ? parsed.slice(-50) : existingHistory;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const taskId = body.task_id || "";
    const transcript = body.transcript || "";

    console.log(`[voice-context-tool] READ task_id=${taskId}, transcript_len=${transcript.length}`);

    if (!taskId) {
      return new Response(JSON.stringify({
        instruction: "No task context. Continue naturally.",
        should_end: false,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = getSupabase();

    // ── Read task + blackboard ──
    const { data: task, error: taskError } = await supabase
      .from("agent_tasks")
      .select("id, payload, result, status")
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      console.error("[voice-context-tool] Task not found:", taskId);
      return new Response(JSON.stringify({
        instruction: "Continue naturally.",
        should_end: false,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const config = (task.payload as any) || {};
    const result = (task.result as any) || {};
    const board = result.blackboard || {};

    // ── Build response from blackboard (zero compute) ──
    const answers = board.answers || {};
    const info = board.info || {};
    const directions = board.directions || null;
    const flags = board.flags || [];
    const operatorMsg = board.operator || null;
    const endCall = board.end_call === true;

    const answerKeys = Object.keys(answers);
    const infoKeys = Object.keys(info);
    const blackboard = {
      answers,
      info,
      directions,
      flags,
      operator: operatorMsg,
      end_call: endCall,
      delivered: board.delivered || [],
    };

    // Build a compact instruction string from blackboard contents
    const parts: string[] = [
      "🎯 YOU ARE THE CALLER. You initiated this call.",
      "🧠 Handle the live moment yourself. Use BLACKBOARD as background memory, not as a script.",
    ];

    if (operatorMsg) {
      parts.push(`⚡ OPERATOR OVERRIDE: ${operatorMsg}`);
    }

    // IVR DTMF handling: extract digit from directions and instruct agent to use keypad tool
    const isIvr = flags.includes("ivr_detected");
    if (isIvr && directions) {
      const dtmfMatch = directions.match(/^DTMF:\s*([0-9*#])$/i);
      if (dtmfMatch) {
        const digit = dtmfMatch[1];
        parts.push(`📞 IVR DETECTED — You MUST immediately use the "keypad_tone" tool with digit="${digit}". Do NOT speak the digit. Do NOT say anything. Just call the tool.`);
      } else if (/DTMF:\s*none/i.test(directions)) {
        parts.push(`📞 IVR DETECTED — The correct menu option is unknown. Listen carefully to the menu options and wait for the planner to provide the correct digit.`);
      } else {
        // Fallback: pass directions as-is
        parts.push(`🧭 STRATEGIC BACKGROUND: ${directions}`);
      }
    } else if (directions) {
      parts.push(`🧭 STRATEGIC BACKGROUND: ${directions}`);
    }

    if (flags.length > 0) {
      parts.push(`🚩 FLAGS: ${flags.join(", ")}`);
    }

    if (infoKeys.length > 0) {
      const infoStr = infoKeys.map(k => `${k}: ${info[k]}`).join(", ");
      parts.push(`ℹ️ FACTS: ${infoStr}`);
    }

    if (answerKeys.length > 0) {
      const answerStr = answerKeys.map(k => `${k}: ${answers[k]}`).join(", ");
      parts.push(`📋 ANSWERS: ${answerStr}`);
    }

    if (endCall) {
      parts.push("🛑 END CALL if objective is complete.");
    }

    const instruction = parts.join(" | ");

    // ── Persist transcript for planner to consume ──
    // Do NOT consume blackboard state here; this tool is a reader.
    const conversationHistory = parseConversationHistory(
      transcript,
      Array.isArray(result.conversationHistory) ? result.conversationHistory : []
    );

    const updates: any = {
      ...result,
      lastTranscript: transcript || result.lastTranscript || "",
      conversationHistory,
      lastToolCallAt: new Date().toISOString(),
      lastTranscriptSyncAt: new Date().toISOString(),
      turnCount: Math.max(result.turnCount || 0, conversationHistory.length),
    };

    await supabase.from("agent_tasks").update({ result: updates }).eq("id", taskId);

    // ── Fire-and-forget: kick planner if new transcript ──
    if (transcript && transcript !== result.lastTranscript) {
      const plannerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-planner-loop`;
      fetch(plannerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ task_id: taskId }),
      }).catch(e => console.error("[voice-context-tool] planner fire-and-forget error:", e));
    }

    console.log(`[voice-context-tool] RESPONSE: ${instruction.substring(0, 100)}`);

    return new Response(JSON.stringify({
      instruction,
      objective: config.objective || "",
      agent_name: config.agent_name || "Maya",
      should_end: endCall,
      flags,
      turn: updates.turnCount,
      blackboard,
      planner: {
        last_planner_at: result.lastPlannerAt || null,
        planner_cycles: result.plannerCycles || 0,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[voice-context-tool] Error:", e);
    return new Response(JSON.stringify({
      instruction: "Continue naturally.",
      should_end: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
