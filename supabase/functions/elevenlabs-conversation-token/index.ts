import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Generates a conversation token for ElevenLabs ConvAI.
 * Used by the client to start a WebRTC session with the ElevenLabs agent.
 * 
 * Supports dynamic overrides:
 *   - task_id: Injected into agent's system prompt template as {{task_id}}
 *   - custom_llm_extra_body: Additional context passed to the Custom LLM relay
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ELEVENLABS_AGENT_ID = "agent_1801kkj49vz6fx8t8wya5j5rppxx";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Use ELEVENLABS_CONVAI_KEY for convai_read permissions
    const ELEVENLABS_API_KEY =
      Deno.env.get("ELEVENLABS_CONVAI_KEY") ||
      Deno.env.get("ELEVENLABS_API_KEY");

    if (!ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch { /* empty body is ok */ }

    const taskId = body.task_id || "";
    const agentId = body.agent_id || ELEVENLABS_AGENT_ID;

    // Build overrides — inject task_id as a dynamic variable for the native LLM agent
    const overrides: any = {};
    if (taskId) {
      overrides.agent = {
        prompt: {
          // Dynamic variable injection — agent prompt uses {{task_id}}
          template_variables: { task_id: taskId },
        },
      };
      // Also pass as dynamic_variables for newer ElevenLabs SDK support
      overrides.conversation_config_override = {
        dynamic_variables: {
          task_id: taskId,
        },
      };
    }

    // Request conversation token
    const tokenUrl = `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`;

    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error("[token] ElevenLabs error:", tokenResp.status, errText);
      return new Response(
        JSON.stringify({ error: `Token generation failed: ${tokenResp.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData = await tokenResp.json();

    return new Response(
      JSON.stringify({
        token: tokenData.token,
        agent_id: agentId,
        task_id: taskId || undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[token] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
