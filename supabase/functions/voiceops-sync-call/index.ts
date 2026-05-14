// VoiceOps: backfill/sync transcript from Vapi call artifacts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPI_API_KEY = (Deno.env.get("VAPI_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");

type VapiMessage = {
  role?: string;
  message?: string;
  content?: string;
  text?: string;
  transcript?: string;
  time?: number;
  secondsFromStart?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!VAPI_API_KEY) return json({ error: "vapi_not_configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { call_id } = await req.json();
    if (!call_id) return json({ error: "call_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: call, error: cErr } = await admin
      .from("voiceops_calls")
      .select("id, user_id, vapi_call_id")
      .eq("id", call_id)
      .single();

    if (cErr || !call) return json({ error: "call not found" }, 404);
    if (call.user_id !== user.id) return json({ error: "forbidden" }, 403);
    if (!call.vapi_call_id) return json({ ok: true, inserted: 0, reason: "no_vapi_call_id" });

    const vapiRes = await fetch(`https://api.vapi.ai/call/${call.vapi_call_id}`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    });
    const vapiCall = await vapiRes.json();
    if (!vapiRes.ok) return json({ error: "vapi_get_call_failed", detail: vapiCall }, 502);

    const rawMessages = Array.isArray(vapiCall.artifact?.messages)
      ? vapiCall.artifact.messages
      : Array.isArray(vapiCall.messages)
        ? vapiCall.messages
        : [];

    const messages = normalizeMessages(rawMessages);
    if (!messages.length && typeof vapiCall.artifact?.transcript === "string") {
      messages.push(...parseTranscript(vapiCall.artifact.transcript));
    }
    if (!messages.length && typeof vapiCall.transcript === "string") {
      messages.push(...parseTranscript(vapiCall.transcript));
    }

    const { data: existing } = await admin
      .from("voiceops_transcripts")
      .select("seq")
      .eq("call_id", call.id)
      .order("seq", { ascending: false })
      .limit(1);
    const maxSeq = existing?.[0]?.seq ?? -1;
    const next = messages.filter((_, i) => i > maxSeq);

    if (next.length) {
      const { error: iErr } = await admin.from("voiceops_transcripts").insert(
        next.map((m, offset) => ({
          call_id: call.id,
          role: m.role,
          text: m.text,
          is_final: true,
          seq: maxSeq + offset + 1,
        })),
      );
      if (iErr) return json({ error: iErr.message }, 500);
    }

    return json({ ok: true, inserted: next.length, total: messages.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function normalizeMessages(raw: VapiMessage[]) {
  return raw
    .map((m) => ({
      role: normalizeRole(m.role),
      text: String(m.message ?? m.content ?? m.text ?? m.transcript ?? "").trim(),
    }))
    .filter((m) => m.text && m.role !== "system");
}

function parseTranscript(transcript: string) {
  return transcript
    .split(/\n+/)
    .map((line) => {
      const match = line.match(/^\s*(assistant|ai|alex|bot|user|human|customer|lead)\s*:\s*(.+)$/i);
      if (!match) return null;
      return { role: normalizeRole(match[1]), text: match[2].trim() };
    })
    .filter(Boolean) as Array<{ role: string; text: string }>;
}

function normalizeRole(role?: string) {
  const r = String(role || "").toLowerCase();
  if (["assistant", "ai", "bot", "alex"].includes(r)) return "assistant";
  if (["user", "human", "customer", "lead"].includes(r)) return "user";
  return "system";
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}