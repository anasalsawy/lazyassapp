import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Voice Agent — Professional-grade conversational AI phone calls via Twilio.
 * 
 * Architecture:
 * 1. POST /voice-agent?action=initiate — Creates Twilio call pointing webhook to this function
 * 2. Twilio calls POST /voice-agent?action=webhook — Initial greeting
 * 3. After each speech input, Twilio calls POST /voice-agent?action=gather — AI processes & responds
 * 4. Conversation continues in a loop with <Gather> until AI decides to end the call
 * 
 * Each turn: Twilio sends speech → we call AI → return TwiML with <Say> + <Gather>
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Conversation Store (in-memory per function instance, keyed by CallSid) ──
// For production: store in DB. For now, edge function instances handle one call.
const conversations: Map<string, Array<{ role: string; content: string }>> = new Map();

function getConversation(callSid: string): Array<{ role: string; content: string }> {
  if (!conversations.has(callSid)) {
    conversations.set(callSid, []);
  }
  return conversations.get(callSid)!;
}

// ── AI Response Generation ─────────────────────────────────────────────────
async function generateResponse(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  userInput: string
): Promise<{ speech: string; shouldEnd: boolean }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userInput },
  ];

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5-mini",
      messages,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[voice-agent] AI error:", resp.status, errText);
    throw new Error(`AI error: ${resp.status}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || "I apologize, could you repeat that?";
  
  // Check if AI wants to end the call
  const shouldEnd = content.includes("[END_CALL]") || 
                    content.toLowerCase().includes("goodbye") && content.toLowerCase().includes("thank you for");
  
  // Clean up any control tokens
  const speech = content.replace(/\[END_CALL\]/g, "").trim();
  
  return { speech, shouldEnd };
}

// ── TwiML Builders ─────────────────────────────────────────────────────────
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildGatherTwiml(speech: string, webhookUrl: string, voice: string = "Polly.Matthew-Neural"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" speechModel="experimental_conversations" enhanced="true" action="${escapeXml(webhookUrl)}" method="POST">
    <Say voice="${voice}">${escapeXml(speech)}</Say>
  </Gather>
  <Say voice="${voice}">I didn't catch that. Let me know if you're still there.</Say>
  <Gather input="speech" speechTimeout="auto" speechModel="experimental_conversations" enhanced="true" action="${escapeXml(webhookUrl)}" method="POST">
    <Say voice="${voice}">Hello?</Say>
  </Gather>
  <Say voice="${voice}">It seems like the connection dropped. Have a great day!</Say>
</Response>`;
}

function buildEndCallTwiml(speech: string, voice: string = "Polly.Matthew-Neural"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escapeXml(speech)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;
}

// ── Voice Selection Based on Tone ──────────────────────────────────────────
function selectVoice(tone: string): string {
  switch (tone?.toLowerCase()) {
    case "female":
    case "warm":
      return "Polly.Joanna-Neural";
    case "british":
    case "formal":
      return "Polly.Amy-Neural";
    case "friendly":
    case "casual":
      return "Polly.Matthew-Neural";
    case "authoritative":
    case "professional":
      return "Polly.Stephen-Neural";
    default:
      return "Polly.Matthew-Neural";
  }
}

// ── Build System Prompt for Call ────────────────────────────────────────────
function buildCallSystemPrompt(objective: string, tone: string, script?: string, callerName?: string): string {
  return `You are a professional AI phone agent conducting a real phone call. You must behave EXACTLY like a skilled human caller.

## CRITICAL RULES
- You are ON THE PHONE. Speak naturally, conversationally, like a real person.
- Use short sentences. Phone conversations are back-and-forth, not monologues.
- NEVER speak more than 2-3 sentences at a time. Let the other person respond.
- Use natural filler words occasionally: "Sure", "Right", "I see", "Absolutely"
- React to what they say. Acknowledge their points before making yours.
- If they ask who you are, say you're calling on behalf of ${callerName || "my client"}.
- Sound confident but not pushy. Be warm and professional.
- NEVER say you are an AI, a bot, or a computer. You are a real person making a call.
- If asked directly if you're a robot, deflect naturally: "Ha, no, I'm very much real. Anyway..."

## YOUR OBJECTIVE
${objective}

## TONE
${tone || "Professional and confident, like an experienced business caller"}

${script ? `## TALKING POINTS & STRATEGY\n${script}` : ""}

## CONVERSATION FLOW
1. Start with a warm greeting and introduce yourself/your purpose
2. Build rapport before getting to the point
3. Listen actively and adapt your approach based on their responses
4. Handle objections gracefully — acknowledge, empathize, then redirect
5. Work toward your objective naturally, don't rush
6. When the objective is achieved OR the conversation naturally concludes, wrap up warmly
7. When you want to end the call, include [END_CALL] at the very end of your message

## HANDLING DIFFICULT SITUATIONS
- If they're busy: "I totally understand. When would be a better time for us to chat?"
- If they're skeptical: Acknowledge their concern, provide value first
- If they say no: Respect it, but try one gentle reframe before accepting
- If they're angry: "I completely understand your frustration. Let me see how I can help."
- If there's silence: Wait a beat, then gently re-engage: "Are you still with me?"

## OUTPUT FORMAT
- Respond with ONLY what you would SAY on the phone. No actions, no descriptions, no parentheticals.
- Keep responses SHORT (1-3 sentences max per turn).
- End the call with [END_CALL] token when appropriate.`;
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "initiate";

  try {
    // ── ACTION: INITIATE — Called by our agents to start a call ──
    if (action === "initiate") {
      const body = await req.json();
      const { phone_number, objective, tone, script, caller_name, voice } = body;

      if (!phone_number || !objective) {
        return new Response(JSON.stringify({ error: "phone_number and objective are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
      const TWILIO_NUMBER = Deno.env.get("TWILIO_WHATSAPP_NUMBER")?.replace("whatsapp:", "") || "";
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

      if (!TWILIO_SID || !TWILIO_TOKEN) {
        return new Response(JSON.stringify({ error: "Twilio credentials not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store call config in DB for the webhook to retrieve
      const supabase = createClient(SUPABASE_URL!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      
      const callConfig = {
        objective,
        tone: tone || "professional",
        script: script || "",
        caller_name: caller_name || "",
        voice: selectVoice(voice || tone || "professional"),
      };

      // Store config as an agent_task so webhook can retrieve it
      const authHeader = req.headers.get("Authorization");
      let userId = "system";
      if (authHeader) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) userId = user.id;
      }

      const { data: task } = await supabase.from("agent_tasks").insert({
        user_id: userId,
        task_type: "voice_call",
        status: "running",
        payload: callConfig,
      }).select("id").single();

      const taskId = task?.id || "unknown";
      
      // Build webhook URL — Twilio will POST to this when the call connects
      const webhookUrl = `${SUPABASE_URL}/functions/v1/voice-agent?action=webhook&task_id=${taskId}`;
      const gatherUrl = `${SUPABASE_URL}/functions/v1/voice-agent?action=gather&task_id=${taskId}`;

      // Generate the initial greeting via AI
      const systemPrompt = buildCallSystemPrompt(objective, callConfig.tone, script, caller_name);
      const { speech: greeting } = await generateResponse(
        systemPrompt,
        [],
        "The phone is ringing and someone just picked up. Give your opening greeting. Be natural, warm, and brief."
      );

      // Build initial TwiML with the AI greeting + Gather for their response
      const twiml = buildGatherTwiml(greeting, gatherUrl, callConfig.voice);

      // Initiate the Twilio call with the TwiML
      const callParams = new URLSearchParams();
      callParams.append("To", phone_number);
      callParams.append("From", TWILIO_NUMBER);
      callParams.append("Twiml", twiml);
      callParams.append("StatusCallback", `${SUPABASE_URL}/functions/v1/voice-agent?action=status&task_id=${taskId}`);
      callParams.append("StatusCallbackEvent", "completed");
      callParams.append("Record", "true");
      callParams.append("RecordingStatusCallback", `${SUPABASE_URL}/functions/v1/voice-agent?action=recording&task_id=${taskId}`);

      const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: callParams.toString(),
      });

      if (!twilioRes.ok) {
        const errData = await twilioRes.json().catch(() => ({}));
        console.error("[voice-agent] Twilio error:", errData);
        await supabase.from("agent_tasks").update({ status: "failed", error_message: errData.message || "Twilio call failed" }).eq("id", taskId);
        return new Response(JSON.stringify({ error: `Call failed: ${errData.message || twilioRes.status}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const callData = await twilioRes.json();

      // Store the initial conversation state
      await supabase.from("agent_tasks").update({
        result: {
          callSid: callData.sid,
          conversationHistory: [
            { role: "assistant", content: greeting },
          ],
          systemPrompt,
        },
      }).eq("id", taskId);

      console.log(`[voice-agent] Call initiated: ${callData.sid} to ${phone_number}`);

      return new Response(JSON.stringify({
        success: true,
        callSid: callData.sid,
        taskId,
        status: callData.status,
        to: phone_number,
        greeting,
        message: `Conversational call initiated to ${phone_number}. The AI agent will conduct a natural conversation.`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: GATHER — Twilio posts speech input here each turn ──
    if (action === "gather") {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      
      const speechResult = params.get("SpeechResult") || "";
      const callSid = params.get("CallSid") || "";
      const taskId = url.searchParams.get("task_id") || "";
      const confidence = parseFloat(params.get("Confidence") || "0");

      console.log(`[voice-agent] Gather — CallSid: ${callSid}, Speech: "${speechResult}", Confidence: ${confidence}`);

      if (!speechResult || !taskId) {
        // No speech detected, prompt again
        const voice = "Polly.Matthew-Neural";
        const gatherUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-agent?action=gather&task_id=${taskId}`;
        const twiml = buildGatherTwiml("I'm still here. Go ahead.", gatherUrl, voice);
        return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
      }

      // Retrieve conversation state from DB
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: task } = await supabase.from("agent_tasks").select("payload, result").eq("id", taskId).single();

      if (!task) {
        return new Response(buildEndCallTwiml("I'm sorry, something went wrong. Goodbye!"), {
          headers: { "Content-Type": "text/xml" },
        });
      }

      const config = task.payload as any;
      const result = task.result as any;
      const voice = config?.voice || "Polly.Matthew-Neural";
      const systemPrompt = result?.systemPrompt || buildCallSystemPrompt(config?.objective || "", config?.tone || "professional");
      const history: Array<{ role: string; content: string }> = result?.conversationHistory || [];

      // Add the user's speech to history
      history.push({ role: "user", content: speechResult });

      // Generate AI response
      const { speech, shouldEnd } = await generateResponse(systemPrompt, history, speechResult);
      
      // Add AI response to history
      history.push({ role: "assistant", content: speech });

      // Save updated conversation
      await supabase.from("agent_tasks").update({
        result: {
          ...result,
          conversationHistory: history,
          lastTurnAt: new Date().toISOString(),
          turnCount: history.filter(h => h.role === "user").length,
        },
      }).eq("id", taskId);

      // Build TwiML response
      if (shouldEnd || history.filter(h => h.role === "user").length >= 20) {
        // End the call
        const twiml = buildEndCallTwiml(speech, voice);
        await supabase.from("agent_tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", taskId);
        return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
      }

      // Continue conversation
      const gatherUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-agent?action=gather&task_id=${taskId}`;
      const twiml = buildGatherTwiml(speech, gatherUrl, voice);
      return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
    }

    // ── ACTION: WEBHOOK — Initial call connection (fallback) ──
    if (action === "webhook") {
      const taskId = url.searchParams.get("task_id") || "";
      const gatherUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-agent?action=gather&task_id=${taskId}`;
      const twiml = buildGatherTwiml("Hello! Thanks for taking my call.", gatherUrl);
      return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
    }

    // ── ACTION: STATUS — Call status callback ──
    if (action === "status") {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      const callStatus = params.get("CallStatus") || "";
      const callDuration = params.get("CallDuration") || "0";
      const taskId = url.searchParams.get("task_id") || "";

      console.log(`[voice-agent] Status — TaskId: ${taskId}, Status: ${callStatus}, Duration: ${callDuration}s`);

      if (taskId) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: task } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();
        await supabase.from("agent_tasks").update({
          status: callStatus === "completed" ? "completed" : "failed",
          completed_at: new Date().toISOString(),
          result: {
            ...(task?.result as any || {}),
            callStatus,
            callDuration: parseInt(callDuration),
          },
        }).eq("id", taskId);
      }

      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
    }

    // ── ACTION: RECORDING — Recording callback ──
    if (action === "recording") {
      const formData = await req.text();
      const params = new URLSearchParams(formData);
      const recordingUrl = params.get("RecordingUrl") || "";
      const taskId = url.searchParams.get("task_id") || "";

      if (taskId && recordingUrl) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: task } = await supabase.from("agent_tasks").select("result").eq("id", taskId).single();
        await supabase.from("agent_tasks").update({
          result: { ...(task?.result as any || {}), recordingUrl },
        }).eq("id", taskId);
      }

      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[voice-agent] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
