// VoiceOps: mid-call operator injection (say-now or context)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { call_id, text, mode } = await req.json();
    if (!call_id || !text) return json({ error: "call_id and text required" }, 400);

    const m =
      mode === "say-now" ? "say-now"
      : mode === "end-call" ? "end-call"
      : mode === "operator-reply" ? "operator-reply"
      : "context";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: call, error: cErr } = await admin
      .from("voiceops_calls")
      .select("id, control_url, user_id")
      .eq("id", call_id)
      .single();
    if (cErr || !call) return json({ error: "call not found" }, 404);
    if (!call.control_url) return json({ error: "no control_url for call" }, 400);

    const { data: inj, error: iErr } = await admin.from("voiceops_injections").insert({
      call_id: call.id,
      user_id: user.id,
      text,
      mode: m,
      status: "pending",
    }).select().single();
    if (iErr) return json({ error: iErr.message }, 500);

    // For operator-reply, also persist on the call row so Alex's get_operator_reply tool returns it.
    if (m === "operator-reply") {
      await admin
        .from("voiceops_calls")
        .update({ operator_reply: text, operator_reply_at: new Date().toISOString() })
        .eq("id", call.id);
    }

    let vapiBody: Record<string, unknown>;
    if (m === "say-now") {
      vapiBody = { type: "say", message: text, endCallAfterSpoken: false };
    } else if (m === "end-call") {
      vapiBody = { type: "end-call" };
    } else if (m === "operator-reply") {
      vapiBody = { type: "add-message", message: { role: "system", content: `OPERATOR REPLY: ${text}` } };
    } else {
      vapiBody = { type: "add-message", message: { role: "system", content: `OPERATOR DIRECTIVE: ${text}` } };
    }

    const r = await fetch(call.control_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vapiBody),
    });

    if (!r.ok) {
      const errText = await r.text();
      await admin.from("voiceops_injections")
        .update({ status: "failed", error: errText })
        .eq("id", inj.id);
      return json({ error: "vapi_control_failed", detail: errText }, 502);
    }

    await admin.from("voiceops_injections")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", inj.id);

    return json({ ok: true });
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
