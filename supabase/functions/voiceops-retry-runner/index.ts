// VoiceOps: pick up due retries and re-dial.
// Invoked by pg_cron every minute. No auth needed (uses service role internally;
// guarded by a shared key to prevent random pokes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUNNER_KEY = Deno.env.get("VOICEOPS_MEMORY_KEY") || ""; // reuse existing shared key

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-runner-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Light guard (pg_cron can send the key as a header)
  if (RUNNER_KEY) {
    const got = req.headers.get("x-runner-key") || req.headers.get("authorization") || "";
    if (!got.includes(RUNNER_KEY)) {
      // Don't 401 — pg_net swallows errors; just no-op.
      console.warn("[voiceops-retry-runner] missing/invalid runner key, continuing in safe mode");
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from("voiceops_calls")
    .select("*")
    .eq("status", "scheduled")
    .lte("next_retry_at", nowIso)
    .limit(20);

  if (error) return json({ error: error.message }, 500);
  if (!due || due.length === 0) return json({ ok: true, processed: 0 });

  const results: Array<Record<string, unknown>> = [];
  for (const row of due) {
    // Claim it so parallel runs don't double-fire
    const { data: claimed } = await admin
      .from("voiceops_calls")
      .update({ status: "retrying" })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select()
      .maybeSingle();
    if (!claimed) continue;

    const brief = (row.retry_brief ?? {}) as Record<string, unknown>;
    const attempt = (row.retry_attempt ?? 0) + 1;

    try {
      const startRes = await fetch(`${SUPABASE_URL}/functions/v1/voiceops-start-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Service-role JWT is accepted by the function's auth.getUser path
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "x-retry-runner": "1",
        },
        body: JSON.stringify({
          phone_number: row.phone_number,
          objective: row.objective,
          customer_info: row.customer_info ?? {},
          system_prompt: row.system_prompt_snapshot || undefined,
          constraints: brief.constraints ?? null,
          offer: brief.offer ?? null,
          max_duration_seconds: brief.max_duration_seconds ?? undefined,
          // Lineage + auto-retry continuation
          parent_call_id: row.parent_call_id || row.id,
          retry_enabled: row.retry_enabled,
          retry_interval_minutes: row.retry_interval_minutes,
          retry_attempt: attempt,
          max_retry_attempts: row.max_retry_attempts,
          user_id_override: row.user_id, // start-call accepts this when called by runner
        }),
      });
      const body = await startRes.json().catch(() => ({}));
      results.push({ id: row.id, ok: startRes.ok, body });

      // Mark this scheduled row as "retried" so it doesn't show as live anymore.
      await admin.from("voiceops_calls")
        .update({
          status: startRes.ok ? "retried" : "failed",
          ended_reason: startRes.ok ? `retried_as=${body.call_id ?? "?"}` : `retry_start_failed: ${JSON.stringify(body).slice(0, 400)}`,
        })
        .eq("id", row.id);
    } catch (e) {
      results.push({ id: row.id, ok: false, error: String(e) });
      await admin.from("voiceops_calls")
        .update({ status: "failed", ended_reason: `retry_runner_error: ${String(e).slice(0, 400)}` })
        .eq("id", row.id);
    }
  }

  return json({ ok: true, processed: results.length, results });
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
