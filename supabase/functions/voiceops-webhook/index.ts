// VoiceOps: receive Vapi server events
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-vapi-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("VAPI_WEBHOOK_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Secret check is non-blocking: log mismatches but still process events.
    // (Vapi sometimes omits the header; we'd rather have transcripts than 403s.)
    if (WEBHOOK_SECRET) {
      const got = req.headers.get("x-vapi-secret") || req.headers.get("authorization") || "";
      if (!got.includes(WEBHOOK_SECRET)) {
        console.warn("[voiceops-webhook] secret mismatch (processing anyway)", { hasHeader: !!got });
      }
    }

    const payload = await req.json();
    const msg = payload.message ?? payload;
    const type = msg.type;
    const vapiCallId = msg.call?.id ?? payload.call?.id;
    console.log(`[voiceops-webhook] type=${type} vapi_call_id=${vapiCallId}`);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: call } = await admin
      .from("voiceops_calls")
      .select("id, retry_enabled, retry_interval_minutes, retry_attempt, max_retry_attempts, parent_call_id, phone_number, objective, customer_info, system_prompt_snapshot, retry_brief, user_id")
      .eq("vapi_call_id", vapiCallId)
      .maybeSingle();

    if (!call) {
      console.warn(`[voiceops-webhook] no call row for vapi_call_id=${vapiCallId}`);
      return ok();
    }

    const normalizedType = String(type || "").startsWith("transcript") ? "transcript" : type;

    switch (normalizedType) {
      case "transcript": {
        const role = msg.role; // "assistant" | "user"
        const text = msg.transcript ?? "";
        const isFinal = msg.transcriptType === "final";
        if (text) {
          await admin.from("voiceops_transcripts").insert({
            call_id: call.id,
            role,
            text,
            is_final: isFinal,
          });
        }
        break;
      }
      case "conversation-update": {
        const messages = Array.isArray(msg.messages)
          ? msg.messages
          : Array.isArray(msg.artifact?.messages)
            ? msg.artifact.messages
            : [];
        const normalized = messages
          .map((m: { role?: string; message?: string; content?: string; text?: string; transcript?: string }) => ({
            role: normalizeRole(m.role),
            text: String(m.message ?? m.content ?? m.text ?? m.transcript ?? "").trim(),
          }))
          .filter((m: { role: string; text: string }) => m.text && m.role !== "system");

        if (normalized.length) {
          const { data: existing } = await admin
            .from("voiceops_transcripts")
            .select("seq")
            .eq("call_id", call.id)
            .order("seq", { ascending: false })
            .limit(1);
          const maxSeq = existing?.[0]?.seq ?? -1;
          const next = normalized.filter((_: unknown, i: number) => i > maxSeq);
          if (next.length) {
            await admin.from("voiceops_transcripts").insert(next.map((m: { role: string; text: string }, offset: number) => ({
              call_id: call.id,
              role: m.role,
              text: m.text,
              is_final: true,
              seq: maxSeq + offset + 1,
            })));
          }
        }
        break;
      }
      case "status-update": {
        await admin.from("voiceops_calls")
          .update({ status: msg.status ?? "in-progress" })
          .eq("id", call.id);
        break;
      }
      case "end-of-call-report": {
        const endedReason = msg.endedReason ?? null;
        const duration = msg.durationSeconds ?? 0;
        const summary = msg.analysis?.summary ?? null;
        const success = msg.analysis?.successEvaluation;
        const successBool = success === true || success === "true" || success === "success" || success === "pass";

        await admin.from("voiceops_calls").update({
          status: "completed",
          ended_reason: endedReason,
          recording_url: msg.recordingUrl ?? msg.artifact?.recordingUrl ?? null,
          cost_usd: msg.cost ?? null,
          duration_seconds: duration,
          outcome: summary,
          metadata: { analysis: msg.analysis ?? null },
        }).eq("id", call.id);

        // === Auto-redial on failure ===
        if (call.retry_enabled) {
          const failureReasons = [
            "customer-did-not-answer", "customer-busy", "voicemail", "no-answer",
            "silence-timed-out", "assistant-error", "pipeline-error",
            "twilio-failed-to-connect-call", "phone-call-provider-closed-websocket",
            "exceeded-max-duration", "assistant-did-not-receive-customer-audio",
          ];
          const reasonStr = String(endedReason || "").toLowerCase();
          const looksFailed = !successBool && (
            duration < 20 ||
            failureReasons.some((r) => reasonStr.includes(r))
          );

          const nextAttempt = (call.retry_attempt ?? 0) + 1;
          const maxAttempts = call.max_retry_attempts ?? 6;

          if (looksFailed && nextAttempt <= maxAttempts) {
            const intervalMin = call.retry_interval_minutes ?? 15;
            const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
            const { data: scheduled, error: schedErr } = await admin.from("voiceops_calls").insert({
              user_id: call.user_id,
              phone_number: call.phone_number,
              objective: call.objective,
              customer_info: call.customer_info ?? {},
              status: "scheduled",
              retry_enabled: true,
              retry_interval_minutes: intervalMin,
              retry_attempt: nextAttempt,
              max_retry_attempts: maxAttempts,
              next_retry_at: nextAt,
              parent_call_id: call.parent_call_id || call.id,
              system_prompt_snapshot: call.system_prompt_snapshot,
              retry_brief: call.retry_brief ?? {},
              ended_reason: `awaiting_retry attempt=${nextAttempt}/${maxAttempts} prev=${endedReason}`,
            }).select("id").single();
            if (schedErr) console.error("[voiceops-webhook] schedule retry failed", schedErr);
            else console.log(`[voiceops-webhook] scheduled retry ${scheduled?.id} at ${nextAt}`);
          } else if (successBool) {
            console.log(`[voiceops-webhook] call ${call.id} succeeded — retry chain stops`);
          } else {
            console.log(`[voiceops-webhook] retries exhausted for ${call.id} (${nextAttempt}/${maxAttempts})`);
          }
        }
        break;
      }
    }

    return ok();
  } catch (e) {
    console.error("voiceops-webhook error", e);
    return ok(); // never make Vapi retry-storm us
  }
});

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRole(role?: string) {
  const r = String(role || "").toLowerCase();
  if (["assistant", "ai", "bot", "alex"].includes(r)) return "assistant";
  if (["user", "human", "customer", "lead"].includes(r)) return "user";
  return "system";
}
