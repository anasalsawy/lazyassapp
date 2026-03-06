import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function nowIso() {
  return new Date().toISOString();
}

function jitter(base: number, max: number, attempt: number) {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
}

function isTerminalStatus(status: string) {
  return ["completed", "failed", "busy", "no-answer", "canceled"].includes((status || "").toLowerCase());
}

async function verifyTwilioSignature(req: Request, fullUrl: string, params: Record<string, string>) {
  const signature = req.headers.get("X-Twilio-Signature") || "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  if (!signature || !authToken) return false;

  const keys = Object.keys(params).sort();
  let data = fullUrl;
  for (const key of keys) data += key + params[key];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return b64 === signature;
}

async function callJson(url: string, payload: unknown) {
  const apikey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Request failed ${resp.status}`);
  return data;
}

async function extractCallResult(conversationHistory: Array<{ role: string; content: string }>, objective: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return {
      objective_met: false,
      confidence: "low",
      summary: "LOVABLE_API_KEY missing for extraction",
      fields: {},
    };
  }

  const transcript = conversationHistory.map((m) => `${m.role}: ${m.content}`).join("\n");
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You extract call outcomes. Return strict JSON only with keys objective_met(boolean), confidence(low|medium|high), summary(string), fields(object).",
        },
        {
          role: "user",
          content: `Objective: ${objective}\n\nConversation:\n${transcript}`,
        },
      ],
      max_tokens: 450,
    }),
  });

  if (!resp.ok) {
    return {
      objective_met: false,
      confidence: "low",
      summary: "extractor failed",
      fields: {},
    };
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const json = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
  const parsed = JSON.parse(json);
  return {
    objective_met: Boolean(parsed.objective_met),
    confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "low",
    summary: String(parsed.summary || "No summary"),
    fields: typeof parsed.fields === "object" && parsed.fields ? parsed.fields : {},
  };
}

async function runStoreCall(args: {
  mission_id: string;
  attempt_index: number;
  store: any;
  objective: string;
  constraints: string | null;
  bearer?: string | null;
}) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/mission-executive?action=status&mission_id=${args.mission_id}&attempt_index=${args.attempt_index}&store_id=${args.store.store_id}`;

  const payload = {
    phone_number: args.store.phone_e164,
    objective: args.objective,
    company_name: args.store.name,
    constraints: `${args.constraints || ""}\nStore: ${args.store.name}`.trim(),
    status_callback_url: statusCallbackUrl,
  };

  const apikey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey };
  if (args.bearer) headers.Authorization = args.bearer;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent?action=initiate`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "voice-agent initiate failed");

  return { child_task_id: data.taskId, call_sid: data.callSid || null, started_at: nowIso() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = getSupabase();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "start";

  try {
    if (action === "start") {
      const body = await req.json().catch(() => ({}));
      const objective = String(body.objective || "").trim();
      const location = body.location ? String(body.location) : null;
      const constraints = body.constraints ? String(body.constraints) : null;

      if (!objective) {
        return new Response(JSON.stringify({ error: "objective required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authHeader = req.headers.get("Authorization") || null;
      let userId = "system";
      if (authHeader) {
        const {
          data: { user },
        } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) userId = user.id;
      }

      const policy = {
        max_attempts: Number(body.max_attempts || 8),
        max_expansion_level: Number(body.max_expansion_level || 2),
        backoff_base_ms: 1500,
        backoff_max_ms: 10000,
      };

      const { data: missionTask, error: missionErr } = await supabase
        .from("agent_tasks")
        .insert({
          user_id: userId,
          task_type: "voice_mission_executive",
          status: "running",
          payload: { objective, location, constraints },
          result: {
            mission_id: crypto.randomUUID(),
            status: "active",
            objective,
            location,
            constraints,
            policy,
            product_intent: null,
            candidate_stores: [],
            stores_attempted: [],
            attempts: [],
            search_expansion_level: 0,
            idempotency_tokens_seen: [],
            created_at: nowIso(),
            updated_at: nowIso(),
            result: null,
          },
        })
        .select("id,payload,result")
        .single();

      if (missionErr || !missionTask) throw new Error(missionErr?.message || "Failed to create mission");

      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const finderResp = await callJson(`${SUPABASE_URL}/functions/v1/product-finder?action=find-candidates`, {
        objective,
        location,
        constraints,
        limit: Number(body.store_limit || 8),
      });

      const finder = finderResp.product_finder_result || {};
      const candidates = (finder.candidates || []).filter((c: any) => c.phone_e164);
      if (!candidates.length) {
        await supabase
          .from("agent_tasks")
          .update({
            status: "failed",
            completed_at: nowIso(),
            error_message: "No callable stores found",
            result: {
              ...(missionTask.result as any),
              status: "failed",
              product_intent: finder.product_intent || null,
              candidate_stores: [],
              updated_at: nowIso(),
              result: { objective_met: false, reason: "No callable stores" },
            },
          })
          .eq("id", missionTask.id);

        return new Response(JSON.stringify({ success: false, missionId: missionTask.id, error: "No callable stores found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const firstStore = candidates[0];
      const firstCall = await runStoreCall({
        mission_id: missionTask.id,
        attempt_index: 0,
        store: firstStore,
        objective,
        constraints,
        bearer: authHeader,
      });

      const updatedResult = {
        ...(missionTask.result as any),
        product_intent: finder.product_intent || null,
        candidate_stores: candidates,
        stores_attempted: [firstStore.store_id],
        attempts: [
          {
            attempt_index: 0,
            store_id: firstStore.store_id,
            child_task_id: firstCall.child_task_id,
            call_sid: firstCall.call_sid,
            started_at: firstCall.started_at,
            ended_at: null,
            status: "calling",
            call_status: null,
            call_duration_s: null,
            call_result: null,
          },
        ],
        updated_at: nowIso(),
      };

      await supabase.from("agent_tasks").update({ result: updatedResult }).eq("id", missionTask.id);

      return new Response(JSON.stringify({ success: true, missionId: missionTask.id, firstCall }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "status") {
      const rawBody = await req.text();
      const params = new URLSearchParams(rawBody);
      const form: Record<string, string> = {};
      for (const [k, v] of params.entries()) form[k] = v;

      const signatureValid = await verifyTwilioSignature(req, url.toString(), form);
      if (!signatureValid) {
        return new Response("<Response/>", { status: 403, headers: { "Content-Type": "text/xml" } });
      }

      const missionId = url.searchParams.get("mission_id") || "";
      const attemptIndex = Number(url.searchParams.get("attempt_index") || 0);
      const childTaskId = url.searchParams.get("child_task_id") || "";
      const callStatus = form.CallStatus || "";
      const callDuration = Number(form.CallDuration || 0);
      const token = req.headers.get("I-Twilio-Idempotency-Token") || crypto.randomUUID();

      const background = async () => {
        const { data: mission } = await supabase.from("agent_tasks").select("*").eq("id", missionId).single();
        if (!mission) return;
        const missionResult = (mission.result as any) || {};

        const seen: string[] = missionResult.idempotency_tokens_seen || [];
        if (seen.includes(token)) return;
        seen.push(token);

        const attempts = [...(missionResult.attempts || [])];
        const idx = attempts.findIndex((a: any) => a.child_task_id === childTaskId || a.attempt_index === attemptIndex);
        if (idx < 0) return;

        attempts[idx] = {
          ...attempts[idx],
          ended_at: nowIso(),
          status: isTerminalStatus(callStatus) ? "completed" : attempts[idx].status,
          call_status: callStatus,
          call_duration_s: Number.isFinite(callDuration) ? callDuration : null,
        };

        let callResult = {
          objective_met: false,
          confidence: "low",
          summary: `Call finished with status ${callStatus}`,
          fields: {},
        };

        if (childTaskId) {
          const { data: child } = await supabase.from("agent_tasks").select("result,payload,status").eq("id", childTaskId).single();
          const history = ((child?.result as any)?.conversationHistory || []) as Array<{ role: string; content: string }>;
          if (history.length) {
            callResult = await extractCallResult(history, mission.payload?.objective || "");
          }
        }

        attempts[idx].call_result = callResult;

        if (callResult.objective_met) {
          await supabase
            .from("agent_tasks")
            .update({
              status: "completed",
              completed_at: nowIso(),
              result: {
                ...missionResult,
                idempotency_tokens_seen: seen,
                attempts,
                status: "completed",
                updated_at: nowIso(),
                result: callResult,
              },
            })
            .eq("id", missionId);
          return;
        }

        const candidates = missionResult.candidate_stores || [];
        const attempted = new Set<string>(missionResult.stores_attempted || []);
        const next = candidates.find((s: any) => !attempted.has(s.store_id));

        if (!next || attempts.length >= (missionResult.policy?.max_attempts || 8)) {
          await supabase
            .from("agent_tasks")
            .update({
              status: "failed",
              completed_at: nowIso(),
              error_message: "Mission exhausted without meeting objective",
              result: {
                ...missionResult,
                idempotency_tokens_seen: seen,
                attempts,
                status: "failed",
                updated_at: nowIso(),
                result: callResult,
              },
            })
            .eq("id", missionId);
          return;
        }

        const waitMs = jitter(
          Number(missionResult.policy?.backoff_base_ms || 1500),
          Number(missionResult.policy?.backoff_max_ms || 10000),
          attempts.length,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));

        const nextCall = await runStoreCall({
          mission_id: missionId,
          attempt_index: attempts.length,
          store: next,
          objective: mission.payload?.objective || "",
          constraints: mission.payload?.constraints || null,
        });

        attempts.push({
          attempt_index: attempts.length,
          store_id: next.store_id,
          child_task_id: nextCall.child_task_id,
          call_sid: nextCall.call_sid,
          started_at: nextCall.started_at,
          ended_at: null,
          status: "calling",
          call_status: null,
          call_duration_s: null,
          call_result: null,
        });

        await supabase
          .from("agent_tasks")
          .update({
            result: {
              ...missionResult,
              idempotency_tokens_seen: seen,
              attempts,
              stores_attempted: [...new Set([...(missionResult.stores_attempted || []), next.store_id])],
              updated_at: nowIso(),
            },
          })
          .eq("id", missionId);
      };

      if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
        (globalThis as any).EdgeRuntime.waitUntil(background());
      } else {
        background().catch((e) => console.error("[mission-executive] status error", e));
      }

      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
    }

    if (action === "get-state") {
      const missionId = url.searchParams.get("mission_id") || "";
      if (!missionId) {
        return new Response(JSON.stringify({ error: "mission_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: mission } = await supabase.from("agent_tasks").select("*").eq("id", missionId).single();
      if (!mission) {
        return new Response(JSON.stringify({ error: "Mission not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          missionId: mission.id,
          status: mission.status,
          payload: mission.payload,
          result: mission.result,
          error: mission.error_message,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[mission-executive]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
