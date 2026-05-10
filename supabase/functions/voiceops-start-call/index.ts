// VoiceOps: start an outbound call via Vapi
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { VOICEOPS_SYSTEM_PROMPT } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VAPI_API_KEY = Deno.env.get("VAPI_API_KEY")!;
const VAPI_PHONE_NUMBER_ID = Deno.env.get("VAPI_PHONE_NUMBER_ID")!;
const VAPI_ASSISTANT_ID = Deno.env.get("VAPI_ASSISTANT_ID") || "";
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const { phone_number, objective, customer_info, max_duration_seconds } = body;
    if (!phone_number || !objective) return json({ error: "phone_number and objective required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Insert call row first so we have an id to track
    const { data: call, error: insertErr } = await admin
      .from("voiceops_calls")
      .insert({
        user_id: user.id,
        phone_number,
        objective,
        customer_info: customer_info ?? {},
        status: "starting",
      })
      .select()
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);

    // Build assistant overrides
    const promptRaw = await Deno.readTextFile(new URL("./prompt.txt", import.meta.url));
    const systemPrompt = transformPromptForVapi(promptRaw);

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

    const vapiBody: Record<string, unknown> = {
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      customer: { number: phone_number },
      maxDurationSeconds: Math.min(Math.max(max_duration_seconds ?? 900, 60), 1800),
      metadata: { voiceops_call_id: call.id, user_id: user.id },
      assistantOverrides: {
        variableValues: flatVars,
        firstMessage,
      },
    };


    if (VAPI_ASSISTANT_ID) {
      vapiBody.assistantId = VAPI_ASSISTANT_ID;
    } else {
      // Inline assistant if no preconfigured assistant in Vapi dashboard
      vapiBody.assistant = {
        name: "VoiceOps Alex",
        firstMessage,
        model: {
          provider: "openai",
          model: "gpt-4o",
          temperature: 0.6,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
          ],
        },
        voice: { provider: "11labs", voiceId: "burt" },
        transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
        recordingEnabled: true,
        endCallFunctionEnabled: true,
        serverUrl: `${SUPABASE_URL}/functions/v1/voiceops-webhook`,
        serverUrlSecret: Deno.env.get("VAPI_WEBHOOK_SECRET") || undefined,
      };
    }

    const vapiRes = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vapiBody),
    });

    const vapiJson = await vapiRes.json();
    if (!vapiRes.ok) {
      await admin
        .from("voiceops_calls")
        .update({ status: "failed", ended_reason: JSON.stringify(vapiJson) })
        .eq("id", call.id);
      return json({ error: "vapi_failed", detail: vapiJson }, 500);
    }

    await admin
      .from("voiceops_calls")
      .update({
        vapi_call_id: vapiJson.id,
        control_url: vapiJson.monitor?.controlUrl ?? vapiJson.controlUrl ?? null,
        status: "ringing",
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
