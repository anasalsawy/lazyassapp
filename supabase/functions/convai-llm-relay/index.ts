import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * DEPRECATED — convai-llm-relay is no longer used.
 * 
 * The voice agent now uses ElevenLabs' native LLM with Maya's persona
 * configured directly in the ElevenLabs dashboard. Context is injected
 * via conversation_initiation_client_data (dynamic_variables) at call start,
 * and mid-call steering via sendContextualUpdate() from the web UI.
 * 
 * This endpoint remains as a no-op to avoid 404s if anything still references it.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Return a simple pass-through response so ElevenLabs doesn't break
  // if it's still configured to point here during migration
  const body = await req.json().catch(() => ({}));
  const messages = body.messages || [];
  const lastUserMsg = messages.filter((m: any) => m.role === "user").pop()?.content || "";

  const content = lastUserMsg
    ? "I'm sorry, could you repeat that?"
    : "Hi, how can I help you today?";

  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "convai-relay-deprecated",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
