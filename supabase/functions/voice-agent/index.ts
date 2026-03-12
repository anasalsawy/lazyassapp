import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Voice Agent — ElevenLabs + Custom LLM Relay Architecture
 * 
 * ElevenLabs handles voice I/O (STT, TTS, turn-taking).
 * The BRAIN lives in convai-llm-relay (Custom LLM endpoint):
 *   - Analyst: detects tone, intent, IVR, emotional state
 *   - Director: strategic decisions based on mission context + operator injections
 *   - Caller (Maya): produces natural spoken responses
 * 
 * This function handles:
 *   - initiate: Start outbound call via ElevenLabs + Twilio
 *   - inject: Operator injects mid-call context (stored in DB, consumed by Director in relay)
 *   - get-state: Get current call state for UI
 *   - list-calls: List active/recent calls
 *   - initiate-mission: Multi-store retry loop
 *   - status: Twilio status callback (with mission auto-retry)
 *   - recording: Recording callback
 * 
 * Context is injected at call start via conversation_initiation_client_data (dynamic_variables).
 * The relay reads these from the system message on every turn.
 * Operator injections are consumed by the relay from the agent_tasks table.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "initiate";

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: INITIATE — Start outbound call via ElevenLabs ConvAI
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

      const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
      const ELEVENLABS_AGENT_ID = "agent_1801kkj49vz6fx8t8wya5j5rppxx";
      const ELEVENLABS_PHONE_NUMBER_ID = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID") || "";

      if (!ELEVENLABS_API_KEY) {
        return new Response(JSON.stringify({ error: "ELEVENLABS_CONVAI_KEY not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!ELEVENLABS_PHONE_NUMBER_ID) {
        return new Response(JSON.stringify({ error: "ELEVENLABS_PHONE_NUMBER_ID not configured. Import your Twilio number into ElevenLabs first." }), {
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
      };

      // Get user ID from auth
      const authHeader = req.headers.get("Authorization");
      let userId = "system";
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) userId = user.id;
      }

      // Create task record
      const { data: task } = await supabase.from("agent_tasks").insert({
        user_id: userId,
        task_type: "voice_call_elevenlabs",
        status: "running",
        payload: callConfig,
        result: { engine: "elevenlabs-native", config: callConfig },
      }).select("id").single();

      const taskId = task?.id || "unknown";
      const missionId = url.searchParams.get("mission_id") || "";
      const storeIndex = url.searchParams.get("store_index") || "";

      console.log(`[voice-agent] 🎙️ ElevenLabs native call to ${phone_number} | objective: ${objective.substring(0, 60)}`);

      // Build dynamic variables for ElevenLabs agent
      // These get injected into the agent's system prompt template via {{variable_name}}
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

      const elevenLabsRes = await fetch(
        "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agent_id: ELEVENLABS_AGENT_ID,
            agent_phone_number_id: ELEVENLABS_PHONE_NUMBER_ID,
            to_number: phone_number,
            call_recording_enabled: true,
            conversation_initiation_client_data: {
              dynamic_variables: {
                call_objective: callConfig.objective,
                constraints: callConfig.constraints,
                agent_name: callConfig.agent_name,
                agent_role_title: callConfig.agent_role,
                company_name: callConfig.company_name,
                call_type: callConfig.call_type,
                success_criteria: callConfig.success_criteria,
                allowed_actions: callConfig.allowed_actions,
                script: callConfig.script,
                ai_disclosure_policy: callConfig.disclosure_policy,
                current_date: `${dateStr} (${timeStr} CT)`,
                task_id: taskId,
              },
            },
          }),
        }
      );

      if (!elevenLabsRes.ok) {
        const errText = await elevenLabsRes.text().catch(() => "unknown");
        console.error("[voice-agent] ElevenLabs error:", elevenLabsRes.status, errText);
        await supabase.from("agent_tasks").update({ status: "failed", error_message: `ElevenLabs error ${elevenLabsRes.status}: ${errText}` }).eq("id", taskId);
        return new Response(JSON.stringify({ error: `ElevenLabs call failed (${elevenLabsRes.status}): ${errText}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const elData = await elevenLabsRes.json();
      console.log(`[voice-agent] ✅ Call initiated: conversationId=${elData.conversation_id}, callSid=${elData.callSid}`);

      await supabase.from("agent_tasks").update({
        result: {
          callSid: elData.callSid || null,
          conversationId: elData.conversation_id || null,
          config: callConfig,
          engine: "elevenlabs-native",
          missionId: missionId || null,
          storeIndex: storeIndex || null,
        },
      }).eq("id", taskId);

      return new Response(JSON.stringify({
        success: true,
        callSid: elData.callSid,
        conversationId: elData.conversation_id,
        taskId,
        to: phone_number,
        engine: "elevenlabs-native",
        message: `Call initiated to ${phone_number}. ElevenLabs handles voice + conversation natively.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: INJECT — Operator injects live instructions mid-call
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "inject") {
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

      const result = (task.result as any) || {};
      const injections = Array.isArray(result?.operatorInjections)
        ? [...result.operatorInjections]
        : [];
      injections.push(instruction);

      const nowIso = new Date().toISOString();
      const injectionHistory = Array.isArray(result?.operatorInjectionHistory)
        ? [...result.operatorInjectionHistory]
        : [];
      injectionHistory.push({
        instruction,
        createdAt: nowIso,
        source: "operator",
        status: "queued",
      });

      await supabase.from("agent_tasks").update({
        result: {
          ...result,
          operatorInjections: injections,
          operatorInjectionHistory: injectionHistory.slice(-50),
        },
      }).eq("id", task_id);

      console.log(`[voice-agent] Operator injection: "${instruction}" → task ${task_id}`);

      return new Response(JSON.stringify({ 
        success: true, 
        message: "Instruction injected and queued for the Director.",
        pendingInjections: injections.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

      const result = (task.result as any) || {};
      const conversationId = result?.conversationId;
      let conversationHistory: Array<{ role: string; content: string }> = Array.isArray(result?.conversationHistory)
        ? result.conversationHistory
        : [];
      let elStatus: string | null = null;

      // Fetch live transcript from ElevenLabs if we have a conversation ID
      if (conversationId) {
        try {
          const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
          if (ELEVENLABS_API_KEY) {
            const elResp = await fetch(
              `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
              { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
            );
            if (elResp.ok) {
              const elData = await elResp.json();
              elStatus = elData.status; // "in-progress", "processing", "done", "failed"
              conversationHistory = (elData.transcript || []).map((t: any) => ({
                role: t.role === "user" ? "user" : "assistant",
                content: t.message || "",
              }));

              // Auto-resolve stuck "running" tasks when ElevenLabs says done/failed
              if (task.status === "running" && (elStatus === "done" || elStatus === "failed")) {
                const newStatus = elStatus === "done" ? "completed" : "failed";
                await supabase.from("agent_tasks").update({
                  status: newStatus,
                  completed_at: new Date().toISOString(),
                  result: {
                    ...result,
                    conversationHistory,
                    elStatus,
                    callDuration: elData.metadata?.call_duration_secs || null,
                  },
                }).eq("id", taskId);
                
                return new Response(JSON.stringify({
                  taskId: task.id,
                  status: newStatus,
                  callSid: result?.callSid,
                  conversationId,
                  pendingInjections: result?.operatorInjections?.length || 0,
                  operatorInjectionHistory: result?.operatorInjectionHistory || [],
                  lastDirectorDirective: result?.lastDirectorDirective || null,
                  directorDirectiveHistory: result?.directorDirectiveHistory || [],
                  config: task.payload,
                  engine: result?.engine,
                  turnCount: conversationHistory.length,
                  conversationHistory,
                  elStatus,
                }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
              }
            }
          }
        } catch (e) {
          console.warn("[voice-agent] ElevenLabs transcript fetch failed:", e);
        }
      }

      return new Response(JSON.stringify({
        taskId: task.id,
        status: task.status,
        callSid: result?.callSid,
        conversationId,
        pendingInjections: result?.operatorInjections?.length || 0,
        operatorInjectionHistory: result?.operatorInjectionHistory || [],
        lastDirectorDirective: result?.lastDirectorDirective || null,
        directorDirectiveHistory: result?.directorDirectiveHistory || [],
        config: task.payload,
        engine: result?.engine,
        turnCount: conversationHistory.length,
        conversationHistory,
        elStatus,
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
        .select("id, status, created_at, completed_at, payload, result")
        .in("task_type", ["voice_call", "voice_call_multi_agent", "voice_call_elevenlabs"])
        .order("created_at", { ascending: false })
        .limit(20);

      if (userId) query.eq("user_id", userId);

      const { data: tasks } = await query;

      const calls = (tasks || []).map((t: any) => ({
        taskId: t.id,
        status: t.status,
        createdAt: t.created_at,
        completedAt: t.completed_at,
        objective: t.payload?.objective,
        callSid: t.result?.callSid,
        conversationId: t.result?.conversationId,
        engine: t.result?.engine,
      }));

      return new Response(JSON.stringify({ calls }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: END-CALL — Kill/terminate a running call
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "end-call") {
      const body = await req.json();
      const { task_id } = body;
      if (!task_id) {
        return new Response(JSON.stringify({ error: "task_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();
      const { data: task } = await supabase
        .from("agent_tasks")
        .select("result, status")
        .eq("id", task_id)
        .single();

      const callSid = (task?.result as any)?.callSid;
      if (callSid) {
        try {
          const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
          const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
          if (accountSid && authToken) {
            await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Basic ${btoa(`${accountSid}:${authToken}`)}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: "Status=completed",
              }
            );
          }
        } catch (e) {
          console.warn("[voice-agent] Twilio hangup error:", e);
        }
      }

      await supabase.from("agent_tasks").update({
        status: "failed",
        error_message: "Killed by operator",
        completed_at: new Date().toISOString(),
      }).eq("id", task_id);

      return new Response(JSON.stringify({ success: true, message: "Call terminated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: INITIATE-MISSION — Multi-store retry loop
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "initiate-mission") {
      const body = await req.json();
      const { objective, tone, script, caller_name, company_name, agent_name, agent_role,
        success_criteria, allowed_actions, constraints, disclosure_policy, call_type,
        retry_stores, max_attempts } = body;

      if (!objective || !retry_stores?.length) {
        return new Response(JSON.stringify({ error: "objective and retry_stores[] required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = getSupabase();
      const authHeader = req.headers.get("Authorization");
      let userId = "system";
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) userId = user.id;
      }

      const missionPayload = {
        objective, tone, script, caller_name, company_name, agent_name, agent_role,
        success_criteria, allowed_actions, constraints, disclosure_policy, call_type,
      };

      const { data: missionTask } = await supabase.from("agent_tasks").insert({
        user_id: userId,
        task_type: "voice_mission",
        status: "running",
        payload: missionPayload,
        result: {
          retry_stores,
          max_attempts: max_attempts || retry_stores.length,
          attempts: [],
          current_store_index: 0,
          objective_met: false,
          winning_store: null,
        },
      }).select("id").single();

      const missionId = missionTask?.id || "unknown";
      console.log(`[voice-agent] 🎯 MISSION STARTED: ${missionId} — ${retry_stores.length} stores queued`);

      // Kick off first call
      const firstStore = retry_stores[0];
      const callBody = {
        ...missionPayload,
        phone_number: firstStore.phone,
        constraints: `${constraints || ""}\nStore: ${firstStore.name}${firstStore.department_hint ? ` (${firstStore.department_hint})` : ""}`.trim(),
      };

      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const initiateResp = await fetch(
        `${SUPABASE_URL}/functions/v1/voice-agent?action=initiate&mission_id=${missionId}&store_index=0`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader ? { Authorization: authHeader } : {}),
            apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
          },
          body: JSON.stringify(callBody),
        }
      );
      const initiateData = await initiateResp.json();

      await supabase.from("agent_tasks").update({
        result: {
          retry_stores,
          max_attempts: max_attempts || retry_stores.length,
          attempts: [{ store: firstStore, child_task_id: initiateData.taskId, started_at: new Date().toISOString(), status: "calling" }],
          current_store_index: 0,
          objective_met: false,
          winning_store: null,
        },
      }).eq("id", missionId);

      return new Response(JSON.stringify({
        success: true,
        missionId,
        totalStores: retry_stores.length,
        firstCall: initiateData,
        message: `Mission started. Will retry across ${retry_stores.length} stores until objective is met.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: STATUS — Call status callback from Twilio (with mission auto-retry)
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "status") {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      const callStatus = params.get("CallStatus") || "";
      const callDuration = params.get("CallDuration") || "0";
      const taskId = url.searchParams.get("task_id") || "";
      const missionId = url.searchParams.get("mission_id") || "";
      const storeIndexStr = url.searchParams.get("store_index") || "";

      console.log(`[voice-agent] Status — TaskId: ${taskId}, Status: ${callStatus}, Duration: ${callDuration}s`);

      const supabase = getSupabase();

      if (taskId) {
        const { data: task } = await supabase.from("agent_tasks").select("result, status, payload").eq("id", taskId).single();
        const alreadyResolved = task?.status === "completed" || task?.status === "failed";
        const twilioFailed = ["busy", "no-answer", "canceled", "failed"].includes(callStatus);
        const taskResult = task?.result as any || {};

        // For ElevenLabs native calls, we can't easily detect objective_met from here
        // since ElevenLabs handles the conversation internally.
        // Mark as completed if Twilio says completed, failed if Twilio failed.
        let newStatus: string;
        if (alreadyResolved) {
          newStatus = task.status;
        } else if (twilioFailed) {
          newStatus = "failed";
        } else if (callStatus === "completed") {
          // Call ended normally — we don't know if objective was met without ElevenLabs webhook
          newStatus = "completed";
        } else {
          newStatus = task?.status || "running";
        }

        const errorMsg = (newStatus === "failed" && !alreadyResolved)
          ? `Call ${callStatus}`
          : undefined;

        await supabase.from("agent_tasks").update({
          status: newStatus,
          completed_at: new Date().toISOString(),
          ...(errorMsg ? { error_message: errorMsg } : {}),
          result: { ...taskResult, callStatus, callDuration: parseInt(callDuration) },
        }).eq("id", taskId);

        console.log(`[voice-agent] Task ${taskId} → ${newStatus}`);

        // ── MISSION AUTO-RETRY LOGIC ──
        if (missionId && newStatus === "failed") {
          const { data: mission } = await supabase.from("agent_tasks").select("result, payload, status").eq("id", missionId).single();
          if (mission && mission.status === "running") {
            const mResult = mission.result as any;
            const attempts = mResult.attempts || [];
            const storeIndex = parseInt(storeIndexStr) || 0;

            if (attempts[storeIndex]) {
              attempts[storeIndex].status = callStatus;
              attempts[storeIndex].ended_at = new Date().toISOString();
              attempts[storeIndex].call_duration = parseInt(callDuration);
            }

            const nextIndex = storeIndex + 1;
            const maxAttempts = mResult.max_attempts || mResult.retry_stores.length;

            if (nextIndex < mResult.retry_stores.length && nextIndex < maxAttempts) {
              const nextStore = mResult.retry_stores[nextIndex];
              console.log(`[voice-agent] 🔄 MISSION ${missionId} — Trying store ${nextIndex}: ${nextStore.name}`);

              await new Promise(r => setTimeout(r, 2000));

              const mPayload = mission.payload as any;
              const callBody = {
                ...mPayload,
                phone_number: nextStore.phone,
                constraints: `${mPayload.constraints || ""}\nStore: ${nextStore.name}${nextStore.department_hint ? ` (${nextStore.department_hint})` : ""}`.trim(),
              };

              const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
              const nextResp = await fetch(
                `${SUPABASE_URL}/functions/v1/voice-agent?action=initiate&mission_id=${missionId}&store_index=${nextIndex}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
                  },
                  body: JSON.stringify(callBody),
                }
              );
              const nextData = await nextResp.json().catch(() => ({}));

              attempts.push({ store: nextStore, child_task_id: nextData.taskId, started_at: new Date().toISOString(), status: "calling" });

              await supabase.from("agent_tasks").update({
                result: { ...mResult, attempts, current_store_index: nextIndex },
              }).eq("id", missionId);
            } else {
              console.log(`[voice-agent] 💀 MISSION ${missionId} FAILED — all stores exhausted`);
              await supabase.from("agent_tasks").update({
                status: "failed",
                completed_at: new Date().toISOString(),
                error_message: `All ${attempts.length} stores tried. Objective not met.`,
                result: { ...mResult, attempts, objective_met: false },
              }).eq("id", missionId);
            }
          }
        }
      }

      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION: RECORDING — Recording callback from Twilio
    // ═══════════════════════════════════════════════════════════════════════
    if (action === "recording") {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      const recordingUrl = params.get("RecordingUrl") || "";
      const taskId = url.searchParams.get("task_id") || "";

      if (taskId && recordingUrl) {
        const supabase = getSupabase();
        const { data: task } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();
        await supabase.from("agent_tasks").update({
          result: { ...(task?.result as any || {}), recordingUrl },
        }).eq("id", taskId);
      }

      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
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
