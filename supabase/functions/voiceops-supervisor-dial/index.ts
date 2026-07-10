// VoiceOps Supervisor Dial — calls the supervisor's phone via Twilio and joins
// them to a live PCM stream of the Vapi call via Twilio Media Streams.
// Monitor-only: supervisor hears the call, but their mic is not routed anywhere.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = (Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
const TWILIO_AUTH_TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();
const TWILIO_VOICE_NUMBER = (Deno.env.get("TWILIO_VOICE_NUMBER") || "").trim();
const SUPERVISOR_PHONE = (Deno.env.get("SUPERVISOR_PHONE") || "").trim();
const SUPERVISOR_BRIDGE_URL = (Deno.env.get("SUPERVISOR_BRIDGE_URL") || "").trim();
// e.g. wss://voiceops-bridge.onrender.com/twilio

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const missing: string[] = [];
    if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
    if (!TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
    if (!TWILIO_VOICE_NUMBER) missing.push("TWILIO_VOICE_NUMBER");
    if (!SUPERVISOR_PHONE) missing.push("SUPERVISOR_PHONE");
    if (!SUPERVISOR_BRIDGE_URL) missing.push("SUPERVISOR_BRIDGE_URL");
    if (missing.length) {
      return json({ error: "supervisor_not_configured", missing }, 200);
    }

    const { call_id, listen_url } = await req.json();
    if (!call_id || !listen_url) return json({ error: "call_id and listen_url required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // TwiML: <Connect><Stream> gives Twilio ↔ worker a bidirectional websocket.
    // We pass listen_url as a custom parameter so the worker knows which Vapi
    // stream to bridge for this supervisor leg.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting you to the live call. Your microphone is muted.</Say>
  <Connect>
    <Stream url="${escapeXml(SUPERVISOR_BRIDGE_URL)}">
      <Parameter name="vapi_listen_url" value="${escapeXml(listen_url)}" />
      <Parameter name="call_id" value="${escapeXml(call_id)}" />
    </Stream>
  </Connect>
</Response>`;

    const form = new URLSearchParams({
      To: SUPERVISOR_PHONE,
      From: TWILIO_VOICE_NUMBER,
      Twiml: twiml,
    });

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );
    const twilioJson = await twilioRes.json();
    if (!twilioRes.ok) {
      console.error("[voiceops-supervisor-dial] twilio error", twilioJson);
      await admin.from("voiceops_calls")
        .update({ supervisor_status: "failed" })
        .eq("id", call_id);
      return json({ error: "twilio_failed", detail: twilioJson }, 502);
    }

    await admin.from("voiceops_calls").update({
      supervisor_call_sid: twilioJson.sid,
      supervisor_status: "dialing",
      supervisor_phone: SUPERVISOR_PHONE,
    }).eq("id", call_id);

    return json({ ok: true, sid: twilioJson.sid });
  } catch (e) {
    console.error("[voiceops-supervisor-dial]", e);
    return json({ error: String(e) }, 500);
  }
});

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
