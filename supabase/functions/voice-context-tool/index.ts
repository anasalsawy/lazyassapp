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

    // Build a compact instruction string from blackboard contents
    const parts: string[] = [];

    // Operator injection — highest priority
    if (operatorMsg) {
      parts.push(`⚡ OPERATOR: ${operatorMsg}`);
    }

    // Directions from planner
    if (directions) {
      parts.push(`→ ${directions}`);
    }

    // Pending answers to deliver
    const answerKeys = Object.keys(answers);
    if (answerKeys.length > 0) {
      const answerStr = answerKeys.map(k => `${k}: ${answers[k]}`).join(", ");
      parts.push(`📋 ANSWERS: ${answerStr}`);
    }

    // Gathered info
    const infoKeys = Object.keys(info);
    if (infoKeys.length > 0) {
      const infoStr = infoKeys.map(k => `${k}: ${info[k]}`).join(", ");
      parts.push(`ℹ️ INFO: ${infoStr}`);
    }

    // Flags with IVR-specific guidance
    if (flags.length > 0) {
      parts.push(`🚩 ${flags.join(", ")}`);
      if (flags.includes("ivr_detected")) {
        parts.push("📞 IVR: You CANNOT press buttons. You must SAY the option number or name out loud (e.g. say 'five' or 'customer service'). Speak clearly and wait.");
      }
    }

    if (endCall) {
      parts.push("🛑 END CALL");
    }

    // Always anchor role identity
    parts.unshift("🎯 YOU ARE THE CALLER. You initiated this call. Never act as a service rep.");

    const instruction = parts.length > 1
      ? parts.join(" | ")
      : "Continue naturally.";

    // ── Persist transcript for planner to consume ──
    // Also consume operator injection after reading it
    const updates: any = {
      ...result,
      lastTranscript: transcript || result.lastTranscript || "",
      lastToolCallAt: new Date().toISOString(),
      turnCount: (result.turnCount || 0) + 1,
    };

    // Consume operator after delivery
    if (operatorMsg && result.blackboard) {
      updates.blackboard = { ...board, operator: null };
    }

    // Consume answers after delivery (agent got them)
    if (answerKeys.length > 0 && result.blackboard) {
      updates.blackboard = {
        ...(updates.blackboard || board),
        answers: {},
        // Move delivered answers to history
        delivered: [
          ...(board.delivered || []).slice(-20),
          ...answerKeys.map(k => ({ k, v: answers[k], at: new Date().toISOString() })),
        ],
      };
    }

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
