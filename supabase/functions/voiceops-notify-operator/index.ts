// Vapi tool endpoint: Alex calls this when he needs to "put caller on hold" and
// flag the operator (human supervisor). We just persist the request onto the
// voiceops_calls row — the UI polls and surfaces it. Alex then says a hold
// phrase and continues once the operator_reply field is populated.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-vapi-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json();
    // Vapi tool-call shape: { message: { toolCallList: [...], call: {...} } }
    const msg = payload.message ?? payload;
    const vapiCallId = msg.call?.id ?? payload.call?.id;
    const toolCalls = msg.toolCallList ?? msg.toolCalls ?? [];

    if (!vapiCallId) return json({ results: [{ result: "missing call id" }] });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: call } = await admin
      .from("voiceops_calls")
      .select("id, operator_reply")
      .eq("vapi_call_id", vapiCallId)
      .maybeSingle();

    if (!call) return json({ results: [{ result: "call not found" }] });

    const results = [];
    for (const tc of toolCalls) {
      const args = tc.function?.arguments ?? tc.arguments ?? {};
      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      const message = String(parsed.message ?? "").trim();
      const urgency = String(parsed.urgency ?? "normal").trim();

      await admin
        .from("voiceops_calls")
        .update({
          operator_request: message || "(no message)",
          metadata: { operator_urgency: urgency, operator_requested_at: new Date().toISOString() },
        })
        .eq("id", call.id);

      console.log(`[voiceops-notify-operator] call=${call.id} urgency=${urgency} msg="${message}"`);

      results.push({
        toolCallId: tc.id,
        result:
          "Operator has been alerted via the live console. Tell the caller you are checking on it and place them on a brief hold. Wait for the operator_reply by calling get_operator_reply, or proceed using your best judgment if no reply arrives within ~30 seconds.",
      });
    }

    return json({ results });
  } catch (e) {
    console.error("voiceops-notify-operator error", e);
    return json({ results: [{ result: `error: ${String(e)}` }] });
  }
});

function json(b: unknown) {
  return new Response(JSON.stringify(b), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
