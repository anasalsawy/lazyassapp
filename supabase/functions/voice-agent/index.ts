import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Voice Agent — ElevenLabs Native LLM outbound calls.
 *
 * Architecture (Hybrid Pull):
 *   1. initiate: Creates agent_task + triggers ElevenLabs outbound call
 *   2. Native LLM calls get_mission_context (voice-context-tool) every turn
 *   3. voice-context-tool runs Planner (Analyst+Director) and returns guidance
 *   4. Native LLM executes as Maya
 *
 * Actions:
 *   - initiate: Start an outbound call via ElevenLabs
 *   - inject: Operator injects mid-call instructions
 *   - get-state: Get current call state for UI
 *   - list-calls: List recent calls
 *   - set-mode: Toggle FAST/CONTROL mode
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

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "initiate";

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: INITIATE — Create task + start ElevenLabs outbound call
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "initiate") {
      const body = await req.json();
      const {
        phone_number, objective, tone, script, caller_name,
        company_name, agent_name, agent_role, success_criteria,
        allowed_actions, constraints, disclosure_policy, call_type,
      } = body;

      if (!phone_number || !objective) {
        return new Response(JSON.stringify({ error: "phone_number and objective are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const ELEVENLABS_API_KEY =
        Deno.env.get("ELEVENLABS_CONVAI_KEY") ||
        Deno.env.get("ELEVENLABS_API_KEY");
      const ELEVENLABS_AGENT_ID =
        Deno.env.get("ELEVENLABS_AGENT_A_ID") || "agent_1801kkj49vz6fx8t8wya5j5rppxx";
      const ELEVENLABS_PHONE_NUMBER_ID = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID");

      if (!ELEVENLABS_API_KEY) {
        return new Response(JSON.stringify({ error: "ElevenLabs API key not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!ELEVENLABS_PHONE_NUMBER_ID) {
        return new Response(JSON.stringify({ error: "ElevenLabs phone number ID not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();

      const callConfig = {
        objective,
        tone: tone || "professional",
        script: script || "",
        caller_name: caller_name || "",
        company_name: company_name || caller_name || "",
        agent_name: agent_name || "Maya",
        agent_role: agent_role || "AI Assistant",
        success_criteria: success_criteria || "",
        allowed_actions: allowed_actions || "",
        constraints: constraints || "",
        disclosure_policy: disclosure_policy || "disclose_if_asked",
        call_type: call_type || "outbound",
        phone_number,
      };

      // Get user ID from auth
      const authHeader = req.headers.get("Authorization");
      let userId = "system";
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) userId = user.id;
      }

      // Create task record — must succeed before calling
      const { data: task, error: taskError } = await supabase.from("agent_tasks").insert({
        user_id: userId,
        task_type: "voice_call_multi_agent",
        status: "running",
        mode: "FAST",
        payload: callConfig,
      }).select("id").single();

      if (taskError || !task?.id) {
        console.error("[voice-agent] Failed to create agent_task:", taskError);
        return new Response(JSON.stringify({ error: `Failed to create task: ${taskError?.message || "unknown insert error"}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const taskId = task.id;

      // Initialize result state
      await supabase.from("agent_tasks").update({
        result: {
          conversationHistory: [],
          operatorInjections: [],
          operatorInjectionHistory: [],
          directorDirectiveHistory: [],
          turnCount: 0,
          config: callConfig,
        },
      }).eq("id", taskId);

      // Trigger ElevenLabs outbound call with task_id as dynamic variable
      const outboundResp = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: ELEVENLABS_AGENT_ID,
          agent_phone_number_id: ELEVENLABS_PHONE_NUMBER_ID,
          to_number: phone_number,
          overrides: {
            agent: {
              prompt: {
                template_variables: { task_id: taskId },
              },
            },
          },
        }),
      });

      if (!outboundResp.ok) {
        const errText = await outboundResp.text();
        console.error("[voice-agent] ElevenLabs outbound error:", outboundResp.status, errText);
        await supabase.from("agent_tasks").update({
          status: "failed",
          error_message: `ElevenLabs call failed: ${outboundResp.status}`,
        }).eq("id", taskId);
        return new Response(JSON.stringify({ error: `Call failed: ${outboundResp.status} — ${errText}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const callData = await outboundResp.json();
      const callSid = callData.call_sid || callData.callSid || callData.conversation_id || "";

      // Persist call reference
      await supabase.from("agent_tasks").update({
        result: {
          callSid,
          conversationId: callData.conversation_id || "",
          conversationHistory: [],
          operatorInjections: [],
          operatorInjectionHistory: [],
          directorDirectiveHistory: [],
          turnCount: 0,
          config: callConfig,
        },
      }).eq("id", taskId);

      console.log(`[voice-agent] ElevenLabs outbound call initiated: ${callSid} → ${phone_number}, task=${taskId}`);

      return new Response(JSON.stringify({
        success: true,
        callSid,
        taskId,
        status: "running",
        to: phone_number,
        architecture: "ElevenLabs Native LLM + Planner webhook",
        message: `Call initiated to ${phone_number}.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: INJECT — Operator sends live context mid-call
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "inject" || action === "contextual-update") {
      const body = await req.json();
      const { task_id, instruction } = body;

      if (!task_id || !instruction) {
        return new Response(JSON.stringify({ error: "task_id and instruction required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();
      const { data: task } = await supabase.from("agent_tasks").select("result").eq("id", task_id).single();

      if (!task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = task.result as any;
      const injections = result?.operatorInjections || [];
      injections.push(instruction);

      await supabase.from("agent_tasks").update({
        result: { ...result, operatorInjections: injections },
      }).eq("id", task_id);

      console.log(`[voice-agent] Operator injection: "${instruction}" → task ${task_id}`);

      return new Response(JSON.stringify({
        success: true,
        message: "Instruction injected. Will be applied on next turn.",
        pendingInjections: injections.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: SET-MODE — Toggle FAST vs CONTROL for an active call
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "set-mode") {
      const body = await req.json();
      const taskId = body.task_id || "";
      const nextMode = body.mode === "CONTROL" ? "CONTROL" : body.mode === "FAST" ? "FAST" : "";

      if (!taskId || !nextMode) {
        return new Response(JSON.stringify({ error: "task_id and valid mode required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();
      const { data: task } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();

      if (!task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = task.result as any;
      await supabase.from("agent_tasks").update({
        mode: nextMode,
        result: {
          ...result,
          modeSwitchedAt: new Date().toISOString(),
          lastRequestedMode: nextMode,
          controlReason: nextMode === "CONTROL" ? "manual_switch" : null,
        },
      }).eq("id", taskId);

      return new Response(JSON.stringify({ success: true, mode: nextMode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: GET-STATE — Get current call state for operator UI
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "get-state") {
      const taskId = url.searchParams.get("task_id") || "";
      if (!taskId) {
        return new Response(JSON.stringify({ error: "task_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();
      const { data: task } = await supabase.from("agent_tasks").select("*").eq("id", taskId).single();

      if (!task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = task.result as any;
      const directive = result?.lastDirectorDirective || {};

      // Map Planner output → UI-compatible lastAnalysis and lastDirective
      const lastAnalysis = {
        tone: directive.tone || "neutral",
        intent: directive.intent || "",
        engagement: directive.engagement || "moderate",
        cooperation: directive.engagement === "high" ? "cooperative" : "neutral",
        emotional_state: directive.tone || "calm",
        is_automated: directive.is_automated || false,
        automated_type: directive.automated_type || "none",
        risks: directive.risks || [],
        opportunities: directive.opportunities || [],
        key_info_extracted: "",
        recommended_approach: directive.instruction || "",
      };

      const lastDirective = {
        instruction: directive.instruction || "",
        tone: directive.suggested_tone || "professional",
        priority: directive.priority || "continue",
        shouldEnd: directive.should_end || false,
        action: directive.action || "CONTINUE",
        dtmf: "none",
        target: "none",
      };

      return new Response(JSON.stringify({
        taskId: task.id,
        status: task.status,
        mode: task.mode || "FAST",
        callSid: result?.callSid,
        turnCount: result?.turnCount || 0,
        conversationHistory: result?.conversationHistory || [],
        lastAnalysis: result?.turnCount > 0 ? lastAnalysis : null,
        lastDirective: result?.turnCount > 0 ? lastDirective : null,
        pendingInjections: result?.operatorInjections?.length || 0,
        config: task.payload,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: LIST-CALLS — List active/recent voice calls
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "list-calls") {
      const supabase = getSupabase();

      const authHeader = req.headers.get("Authorization");
      let userId = "";
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) userId = user.id;
      }

      const query = supabase
        .from("agent_tasks")
        .select("id, status, mode, created_at, completed_at, payload, result")
        .in("task_type", ["voice_call", "voice_call_multi_agent", "voice_mission"])
        .order("created_at", { ascending: false })
        .limit(20);

      if (userId) query.eq("user_id", userId);

      const { data: tasks } = await query;

      const calls = (tasks || []).map((t: any) => ({
        taskId: t.id,
        status: t.status,
        mode: t.mode || "FAST",
        createdAt: t.created_at,
        completedAt: t.completed_at,
        objective: t.payload?.objective,
        turnCount: t.result?.turnCount || 0,
        callSid: t.result?.callSid,
        lastAnalysis: t.result?.lastDirectorDirective
          ? {
              tone: t.result.lastDirectorDirective.tone || "neutral",
              intent: t.result.lastDirectorDirective.intent || "",
              engagement: t.result.lastDirectorDirective.engagement || "moderate",
            }
          : null,
      }));

      return new Response(JSON.stringify({ calls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[voice-agent] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
