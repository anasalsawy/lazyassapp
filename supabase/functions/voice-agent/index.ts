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

type ConversationMessage = { role: string; content: string };

function normalizeTranscriptItem(item: any): ConversationMessage | null {
  const roleRaw = String(item?.role || item?.speaker || item?.source || "").toLowerCase();
  const role = ["agent", "assistant", "ai", "maya", "bot"].includes(roleRaw) ? "assistant" : "user";
  const content = String(
    item?.message ?? item?.text ?? item?.content ?? item?.transcript ?? ""
  ).trim();

  if (!content) return null;
  return { role, content };
}

function transcriptChanged(next: ConversationMessage[], current: ConversationMessage[]): boolean {
  if (next.length !== current.length) return true;

  return next.some((message, index) => {
    const prev = current[index];
    return message.role !== prev?.role || message.content !== prev?.content;
  });
}

async function fetchElevenLabsTranscript(conversationId: string): Promise<ConversationMessage[]> {
  const ELEVENLABS_API_KEY =
    Deno.env.get("ELEVENLABS_CONVAI_KEY") ||
    Deno.env.get("ELEVENLABS_API_KEY");

  if (!ELEVENLABS_API_KEY) {
    console.error("[voice-agent] fetchTranscript: missing ELEVENLABS_CONVAI_KEY/ELEVENLABS_API_KEY");
    return [];
  }
  if (!conversationId) return [];

  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`[voice-agent] fetchTranscript ${conversationId} failed: ${resp.status} ${errText.slice(0, 200)}`);
      return [];
    }

    const data = await resp.json();
    const transcript = Array.isArray(data?.transcript) ? data.transcript : [];
    console.log(`[voice-agent] fetchTranscript ${conversationId} raw_len=${transcript.length}`);

    const normalized = transcript
      .map(normalizeTranscriptItem)
      .filter((msg: ConversationMessage | null): msg is ConversationMessage => Boolean(msg))
      .slice(-50);
    console.log(`[voice-agent] fetchTranscript ${conversationId} normalized_len=${normalized.length}`);
    return normalized;
  } catch (e) {
    console.error("[voice-agent] fetchTranscript exception:", e);
    return [];
  }
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
        _task_id,
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
        Deno.env.get("ELEVENLABS_AGENT_B_ID") || Deno.env.get("ELEVENLABS_AGENT_A_ID");
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

      let taskId = _task_id as string | undefined;

      if (taskId) {
        // Task was pre-created by agent-chat — just update status to running
        await supabase.from("agent_tasks").update({
          status: "running",
          payload: callConfig,
        }).eq("id", taskId);
      } else {
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
        taskId = task.id;
      }

      // Initialize result state with blackboard
      await supabase.from("agent_tasks").update({
        result: {
          conversationHistory: [],
          operatorInjections: [],
          operatorInjectionHistory: [],
          directorDirectiveHistory: [],
          turnCount: 0,
          config: callConfig,
          blackboard: {
            answers: {},
            info: {},
            directions: null,
            flags: [],
            operator: null,
            end_call: false,
            delivered: [],
          },
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
          conversation_initiation_client_data: {
            dynamic_variables: {
              task_id: taskId,
            },
            conversation_config_override: {
              agent: {
                prompt: {
                  prompt: undefined, // don't override prompt, just pass variables
                },
                first_message: undefined,
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
      const board = result?.blackboard || {};

      // Write to blackboard.operator (consumed by voice-context-tool on next read)
      await supabase.from("agent_tasks").update({
        result: {
          ...result,
          blackboard: { ...board, operator: instruction },
          // Keep legacy field for backwards compat
          operatorInjections: [...(result?.operatorInjections || []), instruction],
        },
      }).eq("id", task_id);

      console.log(`[voice-agent] Operator injection: "${instruction}" → task ${task_id}`);

      // Fire planner immediately so injection is processed ASAP
      const plannerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-planner-loop`;
      fetch(plannerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ task_id }),
      }).catch(e => console.error("[voice-agent] planner kick error:", e));

      return new Response(JSON.stringify({
        success: true,
        message: "Instruction injected. Will be applied on next turn.",
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

      let result = task.result as any;
      const directive = result?.lastDirectorDirective || {};

      let conversationHistory: ConversationMessage[] = result?.conversationHistory || [];
      let conversationId = result?.conversationId || "";

      const ELEVENLABS_API_KEY =
        Deno.env.get("ELEVENLABS_CONVAI_KEY") ||
        Deno.env.get("ELEVENLABS_API_KEY");

      // Discover conversationId if missing (outbound calls may not return it immediately)
      if (!conversationId && task.status === "running" && ELEVENLABS_API_KEY) {
        try {
          const agentId = Deno.env.get("ELEVENLABS_AGENT_B_ID") || Deno.env.get("ELEVENLABS_AGENT_A_ID") || "";
          if (agentId) {
            const listResp = await fetch(
              `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=5`,
              { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
            );
            if (listResp.ok) {
              const listData = await listResp.json();
              const conversations = Array.isArray(listData?.conversations) ? listData.conversations : [];
              // Find the most recent active conversation
              const active = conversations.find((c: any) => 
                c.status === "processing" || c.status === "active" || c.status === "in-progress"
              );
              conversationId = active?.conversation_id || conversations[0]?.conversation_id || "";
              if (conversationId) {
                console.log(`[voice-agent] Discovered conversationId: ${conversationId}`);
                // Persist it
                await supabase.from("agent_tasks").update({
                  result: { ...result, conversationId },
                }).eq("id", taskId);
              }
            }
          }
        } catch (e) {
          console.error("[voice-agent] conversationId discovery error:", e);
        }
      }

      // Always try to sync transcript from ElevenLabs during active calls
      if (task.status === "running" && conversationId) {
        const remoteTranscript = await fetchElevenLabsTranscript(conversationId);
        if (transcriptChanged(remoteTranscript, conversationHistory)) {
          const syncedAt = new Date().toISOString();
          conversationHistory = remoteTranscript;
          result = {
            ...result,
            conversationId,
            conversationHistory,
            turnCount: Math.max(result?.turnCount || 0, remoteTranscript.length),
            lastTranscriptSyncAt: syncedAt,
          };

          await supabase.from("agent_tasks").update({ result }).eq("id", taskId);
        }
      }

      const board = result?.blackboard || {};
      const blackboard = {
        answers: board.answers || {},
        info: board.info || {},
        directions: board.directions || null,
        flags: Array.isArray(board.flags) ? board.flags : [],
        operator: board.operator || null,
        end_call: board.end_call === true,
        delivered: Array.isArray(board.delivered) ? board.delivered : [],
      };

      const plannerMeta = {
        lastPlannerAt: result?.lastPlannerAt || null,
        plannerCycles: result?.plannerCycles || 0,
        lastTranscriptSyncAt: result?.lastTranscriptSyncAt || null,
      };

      const turnCount = Math.max(result?.turnCount || 0, conversationHistory.length);

      return new Response(JSON.stringify({
        taskId: task.id,
        status: task.status,
        mode: task.mode || "FAST",
        callSid: result?.callSid,
        turnCount,
        conversationHistory,
        lastAnalysis: null,
        lastDirective: null,
        blackboard,
        plannerMeta,
        pendingInjections: blackboard.operator ? 1 : (result?.operatorInjections?.length || 0),
        config: task.payload,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: KILL — End an active call
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "kill") {
      const body = await req.json();
      const taskId = body.task_id || "";

      if (!taskId) {
        return new Response(JSON.stringify({ error: "task_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();
      const { data: task } = await supabase.from("agent_tasks").select("result, status").eq("id", taskId).single();

      if (!task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = (task.result as any) || {};

      await supabase.from("agent_tasks").update({
        status: "failed",
        error_message: "Killed by operator",
        completed_at: new Date().toISOString(),
        result: { ...result, killedAt: new Date().toISOString(), killedBy: "operator" },
      }).eq("id", taskId);

      console.log(`[voice-agent] Call killed by operator: task=${taskId}`);

      return new Response(JSON.stringify({ success: true, message: "Call killed." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
