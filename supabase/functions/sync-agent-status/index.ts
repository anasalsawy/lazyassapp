import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// =============================================
// AGENT STATUS SYNC
// =============================================
// Polls Skyvern API for task statuses and updates
// the applications table accordingly.
// Also syncs agent_runs statuses.
// Can be triggered manually or via cron.
// =============================================

const SKYVERN_API_BASE = "https://api.skyvern.com/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY");

    if (!SKYVERN_API_KEY) throw new Error("SKYVERN_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth - support both user-triggered and cron/service calls
    let userId: string | null = null;
    const body = await req.json().catch(() => ({}));

    if (body.userId) {
      userId = body.userId;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        userId = user?.id || null;
      }
    }

    console.log(`[SyncAgentStatus] Starting sync${userId ? ` for user: ${userId}` : " for all users"}`);

    // ---- Find applications with Skyvern run IDs that are still "applying" ----
    let query = supabase
      .from("applications")
      .select("id, user_id, status, extra_metadata, job_title, company_name")
      .eq("status", "applying")
      .not("extra_metadata", "is", null);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data: pendingApps, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    const results = {
      checked: 0,
      updated: 0,
      completed: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const app of pendingApps || []) {
      const metadata = app.extra_metadata as Record<string, unknown>;
      const skyvernRunId = metadata?.skyvern_run_id as string;
      if (!skyvernRunId) continue;

      results.checked++;

      try {
        // Poll Skyvern for workflow run status
        // Try workflow endpoint first, fall back to task endpoint
        let statusResponse = await fetch(
          `${SKYVERN_API_BASE}/run/workflows/${skyvernRunId}`,
          {
            headers: {
              "x-api-key": SKYVERN_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        // If workflow endpoint 404s, try the task endpoint as fallback
        if (statusResponse.status === 404) {
          statusResponse = await fetch(
            `${SKYVERN_API_BASE}/run/tasks/${skyvernRunId}`,
            {
              headers: {
                "x-api-key": SKYVERN_API_KEY,
                "Content-Type": "application/json",
              },
            }
          );
        }

        if (!statusResponse.ok) {
          console.error(`[SyncAgentStatus] Skyvern API error for ${skyvernRunId}: ${statusResponse.status}`);
          results.errors.push(`${app.id}: Skyvern API ${statusResponse.status}`);
          continue;
        }

        const taskData = await statusResponse.json();
        const skyvernStatus = (taskData.status || taskData.state || "unknown").toLowerCase();

        let newStatus: string | null = null;
        let statusMessage: string | null = null;

        // Map Skyvern statuses to our application statuses
        switch (skyvernStatus) {
          case "completed":
          case "success":
          case "finished":
            newStatus = "applied";
            statusMessage = "Successfully applied via Skyvern";
            results.completed++;
            break;
          case "failed":
          case "terminated":
          case "error":
          case "timed_out":
          case "canceled":
            newStatus = "error";
            statusMessage = `Skyvern task ${skyvernStatus}: ${taskData.error || taskData.failure_reason || "Unknown error"}`;
            results.failed++;
            break;
          case "running":
          case "queued":
          case "pending":
          case "created":
            // Still in progress, don't update
            break;
          default:
            console.log(`[SyncAgentStatus] Unknown Skyvern status: ${skyvernStatus}`);
        }

        if (newStatus) {
          const { error: updateError } = await supabase
            .from("applications")
            .update({
              status: newStatus,
              status_message: statusMessage,
              status_source: "skyvern_sync",
              extra_metadata: {
                ...metadata,
                skyvern_status: skyvernStatus,
                skyvern_synced_at: new Date().toISOString(),
                skyvern_output: taskData.output?.substring(0, 500) || null,
              },
            })
            .eq("id", app.id);

          if (updateError) {
            console.error(`[SyncAgentStatus] Update error for ${app.id}:`, updateError);
          } else {
            results.updated++;
            console.log(`[SyncAgentStatus] Updated ${app.id} (${app.job_title}): ${newStatus}`);
          }
        }
      } catch (e) {
        console.error(`[SyncAgentStatus] Error processing ${app.id}:`, e);
        results.errors.push(`${app.id}: ${String(e)}`);
      }
    }

    // ---- Also sync agent_runs that are still "running" ----
    let runsQuery = supabase
      .from("agent_runs")
      .select("*")
      .eq("status", "running");

    if (userId) {
      runsQuery = runsQuery.eq("user_id", userId);
    }

    const { data: runningRuns } = await runsQuery;

    // Check for stale runs (running > 30 mins with no update)
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    for (const run of runningRuns || []) {
      if (run.started_at && run.started_at < staleThreshold) {
        await supabase
          .from("agent_runs")
          .update({
            status: "stale",
            error_message: "Run exceeded 30-minute timeout without completion",
            ended_at: new Date().toISOString(),
          })
          .eq("id", run.id);
        console.log(`[SyncAgentStatus] Marked stale run: ${run.id}`);
      }
    }

    console.log(`[SyncAgentStatus] Sync complete:`, results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[SyncAgentStatus] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
