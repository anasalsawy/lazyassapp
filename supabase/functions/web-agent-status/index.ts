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
    const BROWSER_USE_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!BROWSER_USE_API_KEY) {
      throw new Error("BROWSER_USE_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { taskId, internalTaskId, applicationId } = await req.json();

    if (!taskId) {
      throw new Error("Task ID is required");
    }

    console.log(`[WebAgentStatus] Checking status for task: ${taskId}`);

    // Poll Browser Use Cloud API v2 for status
    const statusResponse = await fetch(`https://api.browser-use.com/api/v2/tasks/${taskId}`, {
      method: "GET",
      headers: {
        "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
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

    // Parse Browser Use status
    const agentStatus = statusData.status || statusData.state || "unknown";
    const finalMessage = statusData.output || statusData.result?.message || statusData.message || "";
    
    // Check if the agent completed but was actually blocked
    const isBlocked = /blocked|cannot|unable to|verification required|could not complete/i.test(finalMessage);
    const isSuccessMessage = /success|submitted|application complete|thank you for applying/i.test(finalMessage);
    
    const rawComplete = ["completed", "finished", "success", "done"].includes(agentStatus.toLowerCase());
    const isFailed = ["failed", "error", "timeout", "cancelled", "stopped"].includes(agentStatus.toLowerCase());
    const isRunning = ["running", "in_progress", "pending", "created", "queued"].includes(agentStatus.toLowerCase());
    
    // Determine actual success: completed + success message, not blocked
    const isActualSuccess = rawComplete && isSuccessMessage && !isBlocked;
    const isActualFailure = isFailed || (rawComplete && (isBlocked || !isSuccessMessage));

    // Extract relevant info
    const result = {
      taskId,
      status: isActualSuccess ? "completed" : isActualFailure ? "failed" : isRunning ? "running" : agentStatus,
      steps: statusData.steps || statusData.actions || [],
      screenshots: statusData.screenshots || [],
      finalMessage: finalMessage || null,
      error: statusData.error || (isBlocked ? finalMessage : null),
      completedAt: statusData.completed_at || statusData.completedAt || null,
      wasBlocked: isBlocked,
    };

    console.log(`[WebAgentStatus] Task ${taskId}: rawStatus=${agentStatus}, isActualSuccess=${isActualSuccess}, isActualFailure=${isActualFailure}, isBlocked=${isBlocked}`);

    // Update our database records if complete or failed
    if (isActualSuccess || isActualFailure) {
      // Update task
      if (internalTaskId) {
        await supabase
          .from("agent_tasks")
          .update({
            status: isActualSuccess ? "completed" : "failed",
            result: statusData,
            error_message: isActualFailure ? (statusData.error || finalMessage || "Agent failed") : null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", internalTaskId);
      }

      // Update application
      if (applicationId) {
        const appStatus = isActualSuccess ? "applied" : "failed";
        const appNotes = isActualSuccess 
          ? `Successfully submitted via Browser Use. ${finalMessage}`
          : `Browser Use ${isBlocked ? 'blocked' : 'failed'}: ${statusData.error || finalMessage || "Unknown error"}`;
        
        await supabase
          .from("applications")
          .update({
            status: appStatus,
            notes: appNotes,
            applied_at: isActualSuccess ? new Date().toISOString() : undefined,
          })
          .eq("id", applicationId);
        
        console.log(`[WebAgentStatus] Updated application ${applicationId} to status: ${appStatus}`);
      }

      // Log completion
      await supabase.from("agent_logs").insert({
        user_id: user.id,
        agent_name: "web_agent",
        log_level: isActualSuccess ? "info" : "error",
        message: isActualSuccess 
          ? `Application submitted successfully via Browser Use`
          : `Browser Use ${isBlocked ? 'blocked' : 'failed'}: ${statusData.error || finalMessage || "Unknown error"}`,
        task_id: internalTaskId,
        metadata: { taskId, result: statusData, wasBlocked: isBlocked },
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
