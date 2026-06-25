// Vapi tool endpoint: Alex calls this to fetch any reply the human operator
// has typed in the live console (UI writes to voiceops_calls.operator_reply).
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
    const msg = payload.message ?? payload;
    const vapiCallId = msg.call?.id ?? payload.call?.id;
    const toolCalls = msg.toolCallList ?? msg.toolCalls ?? [];

    if (!vapiCallId) return json({ results: [{ result: "missing call id" }] });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: call } = await admin
      .from("voiceops_calls")
      .select("id, operator_reply, operator_reply_at")
      .eq("vapi_call_id", vapiCallId)
      .maybeSingle();

    const reply = call?.operator_reply?.trim() || "";
    const replyText = reply
      ? `Operator says: "${reply}"`
      : "No reply from operator yet. Keep the caller engaged and try again in a few seconds, or proceed on your own judgment.";

    const results = toolCalls.length
      ? toolCalls.map((tc: { id: string }) => ({ toolCallId: tc.id, result: replyText }))
      : [{ result: replyText }];

    return json({ results });
  } catch (e) {
    console.error("voiceops-get-operator-reply error", e);
    return json({ results: [{ result: `error: ${String(e)}` }] });
  }
});

function json(b: unknown) {
  return new Response(JSON.stringify(b), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
