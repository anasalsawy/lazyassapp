import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_WHATSAPP_NUMBER = Deno.env.get("TWILIO_WHATSAPP_NUMBER")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ── Conversation States ──
type ConversationState =
  | "greeting"
  | "onboarding_name"
  | "onboarding_email"
  | "onboarding_resume"
  | "onboarding_job_prefs"
  | "idle"
  | "optimizing"
  | "searching"
  | "applying"
  | "shopping"
  | "gap_filling";

// ── Twilio helpers ──
async function validateTwilioSignature(
  req: Request,
  body: string,
): Promise<boolean> {
  // In production, implement full Twilio signature validation
  // For now, verify the request has expected Twilio fields
  const sig = req.headers.get("x-twilio-signature");
  if (!sig) {
    console.warn("No Twilio signature header — skipping validation in dev");
    return true; // Allow in dev; tighten for production
  }
  return true;
}

async function sendWhatsAppMessage(to: string, body: string): Promise<string> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
    To: to,
    Body: body,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Twilio send error:", data);
    throw new Error(`Twilio error: ${data.message || resp.statusText}`);
  }
  return data.sid;
}

// ── AI Chat helper ──
async function askAI(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        max_tokens: 500,
      }),
    },
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("AI Gateway error:", resp.status, errText);
    throw new Error(`AI error ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "I'm sorry, I couldn't process that.";
}

// ── Intent detection ──
async function detectIntent(
  message: string,
): Promise<{
  intent: string;
  entities: Record<string, string>;
}> {
  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are an intent classifier for a career automation assistant. Classify the user message into one of these intents:
- optimize_resume: User wants to optimize/improve their resume
- search_jobs: User wants to find/search for jobs
- apply_jobs: User wants to apply to jobs
- check_status: User wants status updates on applications
- shop: User wants to buy something (Auto-Shop)
- update_profile: User wants to update their info
- help: User needs help or doesn't know what to do
- greeting: User is saying hello
- other: Anything else

Return ONLY valid JSON: {"intent": "...", "entities": {}}`,
          },
          { role: "user", content: message },
        ],
        max_tokens: 100,
      }),
    },
  );

  if (!resp.ok) return { intent: "other", entities: {} };
  const data = await resp.json();
  try {
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    // Extract JSON from potential markdown code blocks
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    // fallback
  }
  return { intent: "other", entities: {} };
}

// ── State Machine ──
async function handleConversation(
  supabase: ReturnType<typeof createClient>,
  from: string,
  messageBody: string,
  mediaUrl: string | null,
): Promise<string> {
  // Find or create conversation
  let { data: conv } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone_number", from)
    .single();

  // Look up user by phone in profiles; if not found, this is a new user
  let userId: string | null = null;
  if (conv) {
    userId = conv.user_id;
  } else {
    // Check if phone exists in profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("phone", from.replace("whatsapp:", ""))
      .single();

    if (profile) {
      userId = profile.user_id;
    }
  }

  const state: ConversationState = conv?.state || "greeting";
  const context = conv?.context_json || {};

  let reply = "";
  let newState: ConversationState = state;
  let newContext = { ...context };

  switch (state) {
    case "greeting": {
      if (!userId) {
        reply =
          "👋 Welcome to Career Compass!\n\nI'm your AI career assistant. I can help you with:\n\n" +
          "📄 *Resume Optimization* — AI-powered resume enhancement\n" +
          "🔍 *Job Search* — Find matching positions\n" +
          "📨 *Auto-Apply* — Apply to jobs automatically\n" +
          "🛒 *Auto-Shop* — Find the best deals\n\n" +
          "Let's get you set up! What's your full name?";
        newState = "onboarding_name";
      } else {
        reply =
          "👋 Welcome back to Career Compass!\n\nWhat can I help you with today?\n\n" +
          "📄 Optimize resume\n🔍 Search jobs\n📨 Check applications\n🛒 Shop for something\n\n" +
          "Just tell me what you need!";
        newState = "idle";
      }
      break;
    }

    case "onboarding_name": {
      newContext.full_name = messageBody.trim();
      reply = `Nice to meet you, ${newContext.full_name}! 🎉\n\nWhat's your email address? (This is where we'll send job alerts and updates)`;
      newState = "onboarding_email";
      break;
    }

    case "onboarding_email": {
      const email = messageBody.trim().toLowerCase();
      if (!email.includes("@")) {
        reply = "That doesn't look like a valid email. Please enter your email address:";
        break;
      }
      newContext.email = email;

      // Create auth user and profile
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: newContext.full_name },
      });

      if (authError) {
        // User might already exist
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("email", email)
          .single();

        if (existingProfile) {
          userId = existingProfile.user_id;
          // Update phone
          await supabase
            .from("profiles")
            .update({ phone: from.replace("whatsapp:", ""), first_name: newContext.full_name?.split(" ")[0], last_name: newContext.full_name?.split(" ").slice(1).join(" ") })
            .eq("user_id", userId);
        } else {
          reply = `⚠️ Couldn't create your account: ${authError.message}\n\nPlease try a different email:`;
          break;
        }
      } else if (authData?.user) {
        userId = authData.user.id;
        // Update profile with phone and name
        await supabase
          .from("profiles")
          .update({
            phone: from.replace("whatsapp:", ""),
            first_name: newContext.full_name?.split(" ")[0],
            last_name: newContext.full_name?.split(" ").slice(1).join(" "),
          })
          .eq("user_id", userId);
      }

      newContext.user_id = userId;
      reply =
        "✅ Account created!\n\n" +
        "Now, send me your *resume* as a document or paste the text, and I'll analyze it for you.\n\n" +
        "Or type *skip* to set up your resume later.";
      newState = "onboarding_resume";
      break;
    }

    case "onboarding_resume": {
      if (messageBody.toLowerCase().trim() === "skip") {
        reply =
          "No problem! You can send your resume anytime.\n\n" +
          "What job titles are you looking for? (e.g., Software Engineer, Data Analyst)\n\n" +
          "Or type *skip* to set this up later.";
        newState = "onboarding_job_prefs";
        break;
      }

      // If media (document), note it for later processing
      if (mediaUrl) {
        newContext.resume_media_url = mediaUrl;
        reply =
          "📄 Got your resume! I'll analyze it shortly.\n\n" +
          "What job titles are you interested in? (e.g., Medical Coder, Clinical Data Analyst)";
        newState = "onboarding_job_prefs";
      } else {
        // Treat the message body as pasted resume text
        newContext.resume_text = messageBody;
        reply =
          "📄 Got your resume text! I'll process it.\n\n" +
          "What job titles are you looking for? (e.g., Medical Coder, Clinical Data Analyst)";
        newState = "onboarding_job_prefs";
      }
      break;
    }

    case "onboarding_job_prefs": {
      if (messageBody.toLowerCase().trim() !== "skip") {
        const titles = messageBody.split(",").map((t: string) => t.trim()).filter(Boolean);
        if (titles.length > 0 && userId) {
          await supabase
            .from("job_preferences")
            .update({ job_titles: titles })
            .eq("user_id", userId);
        }
      }

      reply =
        "🎉 You're all set up!\n\n" +
        "Here's what I can do for you:\n\n" +
        "📄 *Optimize* — Optimize your resume for a target role\n" +
        "🔍 *Search* — Find matching jobs\n" +
        "📨 *Apply* — Auto-apply to matched jobs\n" +
        "📊 *Status* — Check application status\n" +
        "🛒 *Shop* — Find best deals on products\n" +
        "❓ *Help* — See all commands\n\n" +
        "What would you like to do?";
      newState = "idle";
      break;
    }

    case "idle": {
      const { intent } = await detectIntent(messageBody);

      switch (intent) {
        case "optimize_resume":
          reply = await handleOptimizeIntent(supabase, userId!, messageBody, newContext);
          break;
        case "search_jobs":
          reply = await handleSearchIntent(supabase, userId!, messageBody);
          break;
        case "apply_jobs":
          reply = await handleApplyIntent(supabase, userId!);
          break;
        case "check_status":
          reply = await handleStatusIntent(supabase, userId!);
          break;
        case "shop":
          reply = await handleShopIntent(messageBody);
          break;
        case "greeting":
          reply =
            "Hey! 👋 Good to hear from you.\n\nWhat can I help with?\n\n" +
            "📄 Optimize resume\n🔍 Search jobs\n📨 Apply\n📊 Status\n🛒 Shop";
          break;
        case "help":
          reply =
            "Here are my commands:\n\n" +
            "📄 *Optimize* — AI resume optimization\n" +
            "🔍 *Search [role]* — Find jobs\n" +
            "📨 *Apply* — Auto-apply to matches\n" +
            "📊 *Status* — Application updates\n" +
            "🛒 *Shop [product]* — Find best deals\n" +
            "👤 *Update profile* — Edit your info\n" +
            "❓ *Help* — This menu";
          break;
        default:
          // Use AI for natural conversation
          reply = await askAI(
            `You are Career Compass, a friendly WhatsApp career assistant. You help users with resume optimization, job searching, auto-applying, and shopping. Keep responses concise (under 300 chars for WhatsApp). If the user seems to want a specific action, suggest the relevant command.`,
            messageBody,
          );
      }
      break;
    }

    default:
      reply = await askAI(
        "You are Career Compass, a WhatsApp career assistant. Keep responses brief and helpful.",
        messageBody,
      );
      newState = "idle";
  }

  // Upsert conversation
  if (conv) {
    await supabase
      .from("conversations")
      .update({
        state: newState,
        context_json: newContext,
        last_message_at: new Date().toISOString(),
        ...(userId ? { user_id: userId } : {}),
      })
      .eq("id", conv.id);
  } else {
    // Need a user_id — use a placeholder if none yet
    const effectiveUserId = userId || "00000000-0000-0000-0000-000000000000";
    await supabase.from("conversations").insert({
      user_id: effectiveUserId,
      phone_number: from,
      state: newState,
      context_json: newContext,
      last_message_at: new Date().toISOString(),
    });
  }

  return reply;
}

// ── Intent Handlers ──
async function handleOptimizeIntent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  message: string,
  context: Record<string, unknown>,
): Promise<string> {
  // Check if user has a resume
  const { data: resumes } = await supabase
    .from("resumes")
    .select("id, title, ats_score")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .limit(1);

  if (!resumes?.length) {
    return "📄 You don't have a resume uploaded yet.\n\nSend me your resume as a document or paste the text, and I'll optimize it!";
  }

  const resume = resumes[0];
  return (
    `📄 Found your resume: *${resume.title}*\n` +
    (resume.ats_score ? `Current ATS Score: ${resume.ats_score}%\n\n` : "\n") +
    "What target role should I optimize it for?\n\n" +
    "Example: _Optimize for Medical Coding Specialist_"
  );
}

async function handleSearchIntent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  message: string,
): Promise<string> {
  const { data: prefs } = await supabase
    .from("job_preferences")
    .select("job_titles, locations")
    .eq("user_id", userId)
    .single();

  const titles = prefs?.job_titles?.join(", ") || "not set";
  const locations = prefs?.locations?.join(", ") || "any location";

  return (
    `🔍 I'll search for jobs matching:\n\n` +
    `*Titles:* ${titles}\n` +
    `*Locations:* ${locations}\n\n` +
    "I'm kicking off a deep search now. I'll message you when results are ready! 🚀\n\n" +
    "_This typically takes 5-10 minutes._"
  );
}

async function handleApplyIntent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, company, match_score")
    .eq("user_id", userId)
    .gte("match_score", 70)
    .order("match_score", { ascending: false })
    .limit(5);

  if (!jobs?.length) {
    return "📨 No matched jobs to apply to yet.\n\nTry *Search* first to find jobs, then I can auto-apply!";
  }

  const jobList = jobs
    .map((j, i) => `${i + 1}. *${j.title}* at ${j.company} (${j.match_score}% match)`)
    .join("\n");

  return `📨 Top matches ready to apply:\n\n${jobList}\n\nReply *apply all* to auto-apply, or *apply 1,3* for specific ones.`;
}

async function handleStatusIntent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  const { data: apps, count } = await supabase
    .from("applications")
    .select("status, company_name, job_title", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!apps?.length) {
    return "📊 No applications yet. Use *Search* to find jobs and *Apply* to get started!";
  }

  const statusEmoji: Record<string, string> = {
    applied: "📤",
    interview: "🎯",
    offer: "🎉",
    rejected: "❌",
    pending: "⏳",
  };

  const list = apps
    .map(
      (a) =>
        `${statusEmoji[a.status] || "📋"} *${a.job_title || "Unknown"}* at ${a.company_name || "Unknown"} — ${a.status}`,
    )
    .join("\n");

  return `📊 Your applications (${count} total):\n\n${list}\n\n_Showing latest 5_`;
}

async function handleShopIntent(message: string): Promise<string> {
  return (
    "🛒 Auto-Shop activated!\n\n" +
    "Tell me what you're looking for and your budget.\n\n" +
    "Example: _Buy wireless earbuds under $50_"
  );
}

// ── Main Handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Twilio sends webhooks as application/x-www-form-urlencoded
  try {
    const contentType = req.headers.get("content-type") || "";
    let from = "";
    let body = "";
    let mediaUrl: string | null = null;
    let messageSid = "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      from = formData.get("From")?.toString() || "";
      body = formData.get("Body")?.toString() || "";
      mediaUrl = formData.get("MediaUrl0")?.toString() || null;
      messageSid = formData.get("MessageSid")?.toString() || "";
    } else if (contentType.includes("application/json")) {
      // For testing via curl/API
      const json = await req.json();
      from = json.From || json.from || "";
      body = json.Body || json.body || json.message || "";
      mediaUrl = json.MediaUrl0 || json.media_url || null;
      messageSid = json.MessageSid || json.message_sid || "";
    }

    if (!from || !body) {
      return new Response(
        JSON.stringify({ error: "Missing From or Body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[WhatsApp] From: ${from}, Body: ${body.substring(0, 100)}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Store inbound message
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, user_id")
      .eq("phone_number", from)
      .single();

    if (conv) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "inbound",
        body,
        media_url: mediaUrl,
        twilio_sid: messageSid,
      });
    }

    // Process conversation
    const reply = await handleConversation(supabase, from, body, mediaUrl);

    // Send reply via Twilio
    const replySid = await sendWhatsAppMessage(from, reply);

    // Store outbound message
    if (conv) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "outbound",
        body: reply,
        twilio_sid: replySid,
      });
    }

    // Return TwiML empty response (Twilio expects this)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      },
    );
  } catch (error) {
    console.error("[WhatsApp] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
