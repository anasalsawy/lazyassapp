import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * voice-planner-loop — Independent async Planner.
 *
 * Runs on its own schedule (called externally or by cron).
 * Reads latest transcript from agent_tasks.result.lastTranscript,
 * runs lean LLM analysis, and writes CODED entries to blackboard.
 *
 * Blackboard rules:
 * - answers: keyed by question slug, REPLACED when updated (not appended)
 * - info: keyed by fact slug, REPLACED when updated
 * - directions: single string, overwritten each cycle
 * - flags: array, refreshed each cycle
 * - operator: injected externally, never touched by planner
 * - end_call: boolean
 *
 * Entries are SHORT. Max ~10 words per value. No prose. No reasoning.
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

const PLANNER_PROMPT = `You are a lean call analyst. You read a phone call transcript and produce ONLY a compact JSON blackboard update.

Rules:
- Every value must be under 10 words. No sentences. No explanations.
- "answers" = answers to questions the agent asked during the call. Key = short slug of the question. Value = the answer found in transcript. Only include questions that HAVE been answered.
- "info" = facts gathered from the conversation. Key = short slug. Value = the fact. Only meaningful facts (names, prices, dates, reference numbers).
- "directions" = ONE short tactical directive for what the agent should do next. Null if no change needed.
- "flags" = array of short alert labels. Only include if actively relevant RIGHT NOW. Options: ivr_detected, voicemail, hold, hostile, confused, objective_met, off_track, stalling.
- "end_call" = true ONLY if the objective is clearly completed or impossible to continue.
- Do NOT repeat info already in existing_board unless updating it.
- If nothing new to add, return {"no_update": true}

Return ONLY valid JSON, nothing else:
{
  "answers": {},
  "info": {},
  "directions": "string or null",
  "flags": [],
  "end_call": false
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const taskId = body.task_id || "";
    const forceRun = body.force === true;

    if (!taskId) {
      return new Response(JSON.stringify({ error: "task_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabase();

    const { data: task, error: taskError } = await supabase
      .from("agent_tasks")
      .select("id, payload, result, status")
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      return new Response(JSON.stringify({ error: "task not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = (task.payload as any) || {};
    const result = (task.result as any) || {};
    const board = result.blackboard || {};
    const transcript = result.lastTranscript || "";
    const lastPlannerTranscript = result.lastPlannerTranscript || "";

    // Check for pending operator injection
    const hasOperatorInjection = !!board.operator;

    // Skip if transcript hasn't changed AND no operator injection pending
    if (transcript === lastPlannerTranscript && transcript.length > 0 && !hasOperatorInjection && !forceRun) {
      console.log(`[voice-planner-loop] No new transcript or injection, skipping.`);
      return new Response(JSON.stringify({ status: "skipped", reason: "no_change" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if no transcript at all
    if (!transcript || transcript.trim().length === 0) {
      console.log(`[voice-planner-loop] Empty transcript, skipping.`);
      return new Response(JSON.stringify({ status: "skipped", reason: "empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Run lean LLM ──
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
      timeZone: "America/Chicago",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
    });

    const existingBoard = {
      answers: board.answers || {},
      info: board.info || {},
      directions: board.directions || null,
      flags: board.flags || [],
    };

    const operatorNote = hasOperatorInjection ? `\nOPERATOR INJECTION (PRIORITY — incorporate into directions): ${board.operator}` : "";

    const userContent = `DATE: ${dateStr} ${timeStr} CT
OBJECTIVE: ${config.objective || "Help caller effectively"}
CONSTRAINTS: ${config.constraints || "None"}${operatorNote}

EXISTING BOARD:
${JSON.stringify(existingBoard)}

TRANSCRIPT:
${transcript.slice(-3000)}

Analyze and return blackboard update.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        messages: [
          { role: "system", content: PLANNER_PROMPT },
          { role: "user", content: userContent },
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!resp.ok) {
      console.error("[voice-planner-loop] LLM error:", resp.status);
      return new Response(JSON.stringify({ error: "llm_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";

    let update: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      update = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      console.error("[voice-planner-loop] JSON parse failed:", content);
      update = null;
    }

    if (!update || update.no_update) {
      console.log(`[voice-planner-loop] No update needed.`);
      await supabase.from("agent_tasks").update({
        result: { ...result, lastPlannerTranscript: transcript, lastPlannerAt: now.toISOString() },
      }).eq("id", taskId);

      return new Response(JSON.stringify({ status: "no_update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Merge into blackboard (replace keys, don't bloat) ──
    const newBoard = {
      ...board,
      answers: { ...(board.answers || {}), ...(update.answers || {}) },
      info: { ...(board.info || {}), ...(update.info || {}) },
      directions: update.directions !== undefined ? update.directions : board.directions,
      flags: Array.isArray(update.flags) ? update.flags : (board.flags || []),
      end_call: update.end_call === true ? true : (board.end_call || false),
      operator: board.operator, // never touch operator — that's human-only
      delivered: board.delivered || [],
    };

    await supabase.from("agent_tasks").update({
      result: {
        ...result,
        blackboard: newBoard,
        lastPlannerTranscript: transcript,
        lastPlannerAt: now.toISOString(),
        plannerCycles: (result.plannerCycles || 0) + 1,
      },
    }).eq("id", taskId);

    console.log(`[voice-planner-loop] Board updated: answers=${Object.keys(update.answers || {}).length}, info=${Object.keys(update.info || {}).length}, flags=${(update.flags || []).length}, end=${update.end_call}`);

    return new Response(JSON.stringify({ status: "updated", blackboard: newBoard }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[voice-planner-loop] Error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
