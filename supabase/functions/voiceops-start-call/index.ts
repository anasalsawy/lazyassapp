// VoiceOps: start an outbound call via Vapi
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { VOICEOPS_SYSTEM_PROMPT } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VAPI_API_KEY = (Deno.env.get("VAPI_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");
// Supports comma-separated list in VAPI_PHONE_NUMBER_ID for auto-fallback when one number is rate-limited
const VAPI_PHONE_NUMBER_IDS = (Deno.env.get("VAPI_PHONE_NUMBER_ID") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const VAPI_PHONE_NUMBER_ID = VAPI_PHONE_NUMBER_IDS[0] || "";
const VAPI_ASSISTANT_ID = (Deno.env.get("VAPI_ASSISTANT_ID") || "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Strip runtime-only template lines (Vapi auto-manages transcript + injection)
function transformPromptForVapi(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => !/\{\{\s*TRANSCRIPT\s*\}\}/i.test(l))
    .filter((l) => !/\{\{\s*INJECTION\s*\}\}/i.test(l))
    .join("\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID) {
      return json({ error: "voiceops_not_configured", detail: "Missing VAPI_API_KEY or VAPI_PHONE_NUMBER_ID" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const {
      phone_number: rawPhone,
      objective,
      customer_info,
      max_duration_seconds,
      system_prompt: customPrompt,
      // Retry orchestration (set by user on first call, propagated by retry-runner)
      retry_enabled,
      retry_interval_minutes,
      retry_attempt,
      max_retry_attempts,
      parent_call_id,
      user_id_override, // only honored when called with service role (retry runner)
    } = body;

    // Service-role bypass for the retry runner; otherwise resolve user from JWT.
    let userId: string | null = null;
    const isServiceRole = authHeader.includes(SERVICE_ROLE);
    if (isServiceRole && user_id_override) {
      userId = String(user_id_override);
    } else {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }

    if (!rawPhone || !objective) return json({ error: "phone_number and objective required" }, 400);

    // Normalize to E.164. Strip everything except digits and a leading +.
    let phone_number = String(rawPhone).trim().replace(/[^\d+]/g, "");
    if (!phone_number.startsWith("+")) {
      // 10 digits → assume US (+1). 11 digits starting with 1 → prepend +.
      if (/^\d{10}$/.test(phone_number)) phone_number = `+1${phone_number}`;
      else if (/^1\d{10}$/.test(phone_number)) phone_number = `+${phone_number}`;
      else phone_number = `+${phone_number}`;
    }
    if (!/^\+[1-9]\d{6,14}$/.test(phone_number)) {
      return json({ error: "invalid_phone", detail: `Phone must be E.164 (e.g. +15089198327). Got: ${rawPhone}` }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Insert call row first so we have an id to track
    const { data: call, error: insertErr } = await admin
      .from("voiceops_calls")
      .insert({
        user_id: userId,
        phone_number,
        objective,
        customer_info: customer_info ?? {},
        status: "starting",
        retry_enabled: !!retry_enabled,
        retry_interval_minutes: Math.min(Math.max(Number(retry_interval_minutes ?? 15), 1), 1440),
        retry_attempt: Number(retry_attempt ?? 0),
        max_retry_attempts: Math.min(Math.max(Number(max_retry_attempts ?? 6), 1), 50),
        parent_call_id: parent_call_id ?? null,
        retry_brief: {
          constraints: body.constraints ?? null,
          offer: body.offer ?? null,
          max_duration_seconds: max_duration_seconds ?? null,
        },
      })
      .select()
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);


    // Generate a custom system prompt — either use caller-supplied prompt, or fall back to OpenAI Assistants API.
    const OPENAI_API_KEY = (Deno.env.get("OPENAI_API_KEY") || "").trim();
    const OPENAI_PROMPT_ASSISTANT_ID = (Deno.env.get("OPENAI_PROMPT_ASSISTANT_ID") || "asst_aG8wdr2PnItqiNay5MTn8DSj").trim();
    const hasCustomPrompt = typeof customPrompt === "string" && customPrompt.trim().length > 0;
    if (!hasCustomPrompt && !OPENAI_API_KEY) {
      await admin.from("voiceops_calls").update({ status: "failed", ended_reason: "missing OPENAI_API_KEY" }).eq("id", call.id);
      return json({ error: "openai_not_configured", detail: "OPENAI_API_KEY required for prompt generation" }, 500);
    }

    let systemPrompt = "";
    if (hasCustomPrompt) {
      systemPrompt = customPrompt.trim();
      console.log(`[voiceops-start-call] Using caller-supplied system prompt (${systemPrompt.length} chars)`);
    } else try {
      const briefPayload = {
        objective,
        customer_info: customer_info ?? {},
        constraints: body.constraints ?? null,
        offer: body.offer ?? null,
        phone_number,
      };
      const briefText = `Generate the call agent system prompt for this outbound mission.\n\n${JSON.stringify(briefPayload, null, 2)}`;

      const oaHeaders = {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      };

      // 1) Create thread with the brief
      const threadRes = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: oaHeaders,
        body: JSON.stringify({ messages: [{ role: "user", content: briefText }] }),
      });
      const thread = await threadRes.json();
      if (!threadRes.ok) throw new Error(`thread_create_failed: ${JSON.stringify(thread)}`);

      // 2) Create run
      const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
        method: "POST",
        headers: oaHeaders,
        body: JSON.stringify({ assistant_id: OPENAI_PROMPT_ASSISTANT_ID }),
      });
      let run = await runRes.json();
      if (!runRes.ok) throw new Error(`run_create_failed: ${JSON.stringify(run)}`);

      // 3) Poll until complete (max ~30s)
      const start = Date.now();
      while (["queued", "in_progress", "cancelling"].includes(run.status)) {
        if (Date.now() - start > 90_000) throw new Error("run_timeout");
        await new Promise((r) => setTimeout(r, 1500));
        const pollRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, { headers: oaHeaders });
        run = await pollRes.json();
      }
      if (run.status !== "completed") throw new Error(`run_status=${run.status}: ${JSON.stringify(run.last_error || run)}`);

      // 4) Read assistant reply
      const msgRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages?order=desc&limit=10`, { headers: oaHeaders });
      const msgs = await msgRes.json();
      const firstAssistant = (msgs.data || []).find((m: { role: string }) => m.role === "assistant");
      const generated = firstAssistant?.content
        ?.filter((c: { type: string }) => c.type === "text")
        ?.map((c: { text: { value: string } }) => c.text.value)
        ?.join("\n\n")
        ?.trim();
      if (!generated || generated.length < 50) throw new Error("empty_assistant_output");

      systemPrompt = generated;
      console.log(`[voiceops-start-call] Generated prompt via OpenAI assistant (${systemPrompt.length} chars)`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[voiceops-start-call] prompt generation failed:", detail);
      await admin.from("voiceops_calls").update({ status: "failed", ended_reason: `prompt_generation_failed: ${detail}` }).eq("id", call.id);
      return json({ error: "prompt_generation_failed", detail }, 502);
    }

    // Flat variable set (Vapi templating doesn't truly nest — flat keys are reliable)
    const ci = (customer_info ?? {}) as Record<string, unknown>;
    const flatVars: Record<string, string> = {
      // Lead
      firstName: String(ci.firstName ?? ci.first_name ?? ci.name ?? ""),
      lastName: String(ci.lastName ?? ci.last_name ?? ""),
      company: String(ci.company ?? ""),
      title: String(ci.title ?? ci.role ?? ""),
      timezone: String(ci.timezone ?? ci.tz ?? ""),
      // Task
      taskObjective: objective,
      constraints: String(ci.constraints ?? body.constraints ?? ""),
      offer: String(ci.offer ?? body.offer ?? ""),
      // Ops (mid-call injections arrive as system messages, but seed empty)
      injection: "",
    };

    const greetingName = flatVars.firstName ? ` ${flatVars.firstName}` : "";
    const firstMessage = `Hi${greetingName}, this is Alex calling from VoiceOps. This call may be recorded for quality. Do you have a quick minute?`;

    const webhookUrl = `${SUPABASE_URL}/functions/v1/voiceops-webhook`;

    const vapiBody: Record<string, unknown> = {
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      customer: { number: phone_number },
      maxDurationSeconds: Math.min(Math.max(max_duration_seconds ?? 900, 60), 1800),
      metadata: { voiceops_call_id: call.id, user_id: userId },
      assistantOverrides: {
        variableValues: flatVars,
        firstMessage,
      },
    };


    // Call-control toolbox — Vapi-native predefined tools + dynamic transfer destinations + operator bridge.
    const notifyOperatorUrl = `${SUPABASE_URL}/functions/v1/voiceops-notify-operator`;
    const getOperatorReplyUrl = `${SUPABASE_URL}/functions/v1/voiceops-get-operator-reply`;
    const transferDestinations = Array.isArray(body.transfer_destinations) ? body.transfer_destinations : [];
    const callTools: Array<Record<string, unknown>> = [
      // Hang up
      { type: "endCall" },
      // DTMF keypad — press digits for IVR navigation, menu selection, etc.
      { type: "dtmf" },
      // Notify the human operator (writes voiceops_calls.operator_request; UI shows it live)
      {
        type: "function",
        async: false,
        server: { url: notifyOperatorUrl },
        function: {
          name: "notify_operator",
          description:
            "Alert the human operator (your supervisor) on the live console while the caller is on the line. Use when you need a decision, missing info, or approval before continuing. Right after calling this, tell the caller to please hold for a brief moment.",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string", description: "Concise question/message for the operator. Include enough context to answer without listening to the call." },
              urgency: { type: "string", enum: ["low", "normal", "high"], description: "How urgent the request is" },
            },
            required: ["message"],
          },
        },
      },
      // Poll for the operator's reply
      {
        type: "function",
        async: false,
        server: { url: getOperatorReplyUrl },
        function: {
          name: "get_operator_reply",
          description:
            "Check whether the human operator has replied to your last notify_operator request. Call after a brief small-talk hold (5–15s). Returns the operator's typed reply or 'no reply yet'.",
          parameters: { type: "object", properties: {} },
        },
      },
      // Transfer the call. If destinations were provided, scope them; otherwise let the model pass a number.
      transferDestinations.length > 0
        ? { type: "transferCall", destinations: transferDestinations }
        : {
            type: "transferCall",
            destinations: [],
            function: {
              name: "transferCall",
              description: "Transfer the live call to another phone number (warm or cold). Use for escalation, connecting to a human, or routing to a specialist.",
              parameters: {
                type: "object",
                properties: {
                  destination: { type: "string", description: "E.164 phone number to transfer to, e.g. +15551234567" },
                  message: { type: "string", description: "Optional message to say to the callee before connecting (warm transfer)" },
                },
                required: ["destination"],
              },
            },
          },
    ];

    // Always use inline assistant so the OpenAI-generated prompt is applied per-call.
    vapiBody.assistant = {
      name: "VoiceOps Alex",
      firstMessage,
      model: {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.6,
        messages: [{ role: "system", content: systemPrompt }],
        tools: callTools,
      },
      voice: { provider: "11labs", voiceId: "burt" },
      transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      recordingEnabled: true,
      endCallFunctionEnabled: true,
      server: { url: webhookUrl },
      serverMessages: ["status-update", "transcript", "end-of-call-report", "conversation-update", "tool-calls"],
    };

    // Try each configured Vapi phone number until one succeeds (skip rate-limit / daily-cap errors)
    let vapiRes: Response | null = null;
    let vapiJson: Record<string, unknown> = {};
    let usedNumberId = "";
    const attempts: Array<{ id: string; status: number; body: unknown }> = [];

    for (const numId of VAPI_PHONE_NUMBER_IDS) {
      vapiBody.phoneNumberId = numId;
      const r = await fetch("https://api.vapi.ai/call", {
        method: "POST",
        headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(vapiBody),
      });
      const j = await r.json();
      attempts.push({ id: numId, status: r.status, body: j });
      if (r.ok) { vapiRes = r; vapiJson = j; usedNumberId = numId; break; }
      const msg = JSON.stringify(j).toLowerCase();
      const rateLimited = /daily.*limit|outbound call limit|rate.?limit|too many/i.test(msg);
      console.warn(`[voiceops-start-call] number ${numId} failed (status ${r.status}, rateLimited=${rateLimited})`);
      if (!rateLimited) { vapiRes = r; vapiJson = j; break; } // hard error, don't retry other numbers
    }

    if (!vapiRes || !vapiRes.ok) {
      const status = vapiRes?.status ?? 502;
      const isInvalidKey = status === 401 || /invalid key|unauthorized/i.test(JSON.stringify(vapiJson));
      await admin
        .from("voiceops_calls")
        .update({ status: "failed", ended_reason: JSON.stringify({ attempts }) })
        .eq("id", call.id);
      return json({
        error: isInvalidKey ? "vapi_api_key_invalid" : "vapi_failed",
        detail: isInvalidKey
          ? "Vapi rejected the stored server API key."
          : { message: "All configured Vapi numbers failed", attempts },
      }, isInvalidKey ? 401 : 502);
    }
    console.log(`[voiceops-start-call] call placed via number ${usedNumberId}`);

    await admin
      .from("voiceops_calls")
      .update({
        vapi_call_id: vapiJson.id,
        control_url: vapiJson.monitor?.controlUrl ?? vapiJson.controlUrl ?? null,
        status: "ringing",
        system_prompt_snapshot: systemPrompt,
      })
      .eq("id", call.id);

    return json({ ok: true, call_id: call.id, vapi_call_id: vapiJson.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
