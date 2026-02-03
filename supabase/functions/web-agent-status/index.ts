import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const HYPERBROWSER_API_KEY = Deno.env.get("HYPERBROWSER_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!HYPERBROWSER_API_KEY) {
      throw new Error("HYPERBROWSER_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { sessionId, taskId, applicationId } = await req.json();

    if (!sessionId) {
      throw new Error("Session ID is required");
    }

    console.log(`[WebAgentStatus] Checking status for session: ${sessionId}`);

    // Poll Hyperbrowser for status
    const statusResponse = await fetch(`https://app.hyperbrowser.ai/api/v1/agent/session/${sessionId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${HYPERBROWSER_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error("[WebAgentStatus] Failed to get status:", errorText);
      throw new Error(`Failed to get agent status: ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();
    console.log("[WebAgentStatus] Status data:", JSON.stringify(statusData, null, 2));

    // Parse the status
    const agentStatus = statusData.status || statusData.state || "unknown";
    const isComplete = ["completed", "finished", "success"].includes(agentStatus.toLowerCase());
    const isFailed = ["failed", "error", "timeout"].includes(agentStatus.toLowerCase());
    const isRunning = ["running", "in_progress", "pending"].includes(agentStatus.toLowerCase());

    // Extract relevant info
    const result = {
      sessionId,
      status: isComplete ? "completed" : isFailed ? "failed" : isRunning ? "running" : agentStatus,
      steps: statusData.steps || [],
      screenshots: statusData.screenshots || [],
      finalMessage: statusData.result?.message || statusData.message || null,
      error: statusData.error || null,
      completedAt: statusData.completedAt || null,
    };

    // Update our database records if complete or failed
    if (isComplete || isFailed) {
      // Update task
      if (taskId) {
        await supabase
          .from("agent_tasks")
          .update({
            status: isComplete ? "completed" : "failed",
            result: statusData,
            error_message: isFailed ? (statusData.error || "Agent failed") : null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", taskId);
      }

      // Update application
      if (applicationId) {
        await supabase
          .from("applications")
          .update({
            status: isComplete ? "applied" : "failed",
            notes: isComplete 
              ? `Successfully submitted via AI Web Agent. ${statusData.result?.message || ""}`
              : `AI Web Agent failed: ${statusData.error || "Unknown error"}`,
            applied_at: isComplete ? new Date().toISOString() : undefined,
          })
          .eq("id", applicationId);
      }

      // Log completion
      await supabase.from("agent_logs").insert({
        user_id: user.id,
        agent_name: "web_agent",
        log_level: isComplete ? "info" : "error",
        message: isComplete 
          ? `Application submitted successfully via AI Web Agent`
          : `AI Web Agent failed: ${statusData.error || "Unknown error"}`,
        task_id: taskId,
        metadata: { sessionId, result: statusData },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[WebAgentStatus] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to get status";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
