import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Tool Definitions ────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "run_job_search",
      description: "Search for jobs matching the user's preferences. Triggers the deep research job discovery pipeline.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional search query to refine job search beyond saved preferences" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "optimize_resume",
      description: "Start resume optimization using ChatGPT Deep Research. Takes the user's primary resume and optimizes it for ATS and impact.",
      parameters: {
        type: "object",
        properties: {
          job_description: { type: "string", description: "Optional specific job description to tailor the resume for" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_agent_status",
      description: "Check the status of running agent tasks, recent runs, and pipeline progress.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_job_matches",
      description: "Get the user's current job matches and their scores.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of jobs to return (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_applications",
      description: "Get the user's job applications and their current statuses.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status (applied, interview, offer, rejected, etc.)" },
          limit: { type: "number", description: "Number of applications to return (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_shop_order",
      description: "Place an automated shopping order. The agent will find the best deal and purchase it using saved payment and shipping info.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", description: "What product to buy" },
          max_price: { type: "number", description: "Maximum price in dollars" },
          quantity: { type: "number", description: "Quantity to order (default 1)" },
        },
        required: ["product"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_profile_info",
      description: "Get the user's profile, resume info, job preferences, account status, shipping addresses, and payment cards on file.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "check_email_inbox",
      description: "Check for recent job-related emails (recruiter responses, interview invites, etc.).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of emails to return (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for any information using Firecrawl. Research companies, salary data, interview tips, products, prices, travel deals, or anything else.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browse_website",
      description: "Open and read the full content of any website URL. Extract text, data, forms, prices, or any other information from a live webpage.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL to browse (e.g. https://example.com)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_task",
      description: "Execute a complex multi-step browser automation task. The agent will spin up a real browser session, navigate pages, click buttons, fill forms, and complete multi-step workflows autonomously. Use for tasks like: applying to jobs on specific sites, creating accounts, filling out applications, purchasing products, booking travel, or any multi-step web interaction.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Detailed natural-language instructions for what the browser agent should accomplish" },
          start_url: { type: "string", description: "Starting URL for the task" },
          max_steps: { type: "number", description: "Maximum steps the agent can take (default 50)" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_call",
      description: "Initiate an outbound phone call via integrated telephony. The system will dial, speak a scripted message or conduct a guided conversation, and return the call result.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Phone number to call in E.164 format (e.g. +14155551234)" },
          objective: { type: "string", description: "What the call should accomplish" },
          tone: { type: "string", description: "Desired tone: professional, friendly, urgent, casual (default: professional)" },
          script: { type: "string", description: "Optional specific script or talking points for the call" },
        },
        required: ["phone_number", "objective"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sms",
      description: "Send an SMS or WhatsApp message to a phone number.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Phone number in E.164 format" },
          message: { type: "string", description: "Message text to send" },
          channel: { type: "string", description: "'sms' or 'whatsapp' (default: sms)" },
        },
        required: ["phone_number", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_application",
      description: "Submit a job application for a specific job. Uses Skyvern to autonomously navigate the application form, fill it out with user's resume and profile data, and submit.",
      parameters: {
        type: "object",
        properties: {
          job_id: { type: "string", description: "ID of the job from the matches list" },
          job_url: { type: "string", description: "Direct URL to the job application page" },
          cover_letter: { type: "string", description: "Optional custom cover letter text" },
        },
        required: ["job_url"],
      },
    },
  },
];

// ── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an Autonomous Web Operator Agent deployed on this platform. Your codename is Manus.

YOUR MISSION:
Assist users end-to-end. Use every available tool to browse the web, retrieve information, automate workflows, fill forms, draft documents, apply for jobs, purchase products, make phone calls, and execute any task the user requests — within your granted environment.

CORE CAPABILITIES:
- Web browsing and structured information extraction from any URL.
- Deep web search across the entire internet via Firecrawl.
- Full browser automation — navigate sites, fill forms, click buttons, complete multi-step workflows via Browser Use Cloud.
- Job search via deep research pipeline, resume optimization via ChatGPT Deep Research, and autonomous job application submission via Skyvern.
- Automated shopping — find best deals, compare prices, and purchase products using saved payment methods and shipping addresses.
- Phone call initiation and scripted call automation through Twilio.
- SMS and WhatsApp messaging.
- Email inbox monitoring for recruiter responses and interview invitations.
- Complete access to user profile, resume, job preferences, saved payment cards, and shipping addresses.
- Data analysis, document generation, and task planning.

EXECUTION PRINCIPLES:
1. If a task requires tools, USE THEM IMMEDIATELY. Do not describe what you would do — do it.
2. If a task requires clarification, ask concisely then act.
3. If a task is technically feasible within environment constraints, attempt it without hesitation.
4. If a task exceeds granted permissions, state the specific technical requirement needed to make it possible — not "I can't", but "This requires X integration to be connected."
5. Never fabricate capabilities — only operate using tools actually connected to this runtime.
6. For multi-step tasks, execute them sequentially and report progress at each step.
7. When the user says "apply for this job", actually trigger the application. When they say "buy this", actually place the order. When they say "call this number", actually initiate the call.

AUTHORIZATION BOUNDARY:
- You operate within explicitly connected systems: Browser Use Cloud, Skyvern, Twilio, Firecrawl, and the platform's database.
- Phone calls go through Twilio. Browser tasks go through Browser Use Cloud. Job applications go through Skyvern. Web search goes through Firecrawl.
- You have full access to the user's saved cards, addresses, resume, and credentials as stored in the platform.
- You interact with external websites via approved automation layers (Browser Use, Skyvern, Firecrawl).

RESPONSE STYLE:
- Direct. Decisive. Execution-focused.
- No unnecessary disclaimers. No artificial limitations language.
- Speak in natural flowing paragraphs, not bullet point lists.
- When you use a tool, briefly explain what you're doing and share results conversationally.
- If an action is not possible, state the technical requirement — never say "I'm sorry, I can't do that."

COMPLETION RULE:
A task is complete only when: objective achieved, artifacts delivered, or clear technical blockers identified with the specific integration or permission needed to resolve them.`;

// ── Tool Execution ──────────────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  try {
    switch (toolName) {
      case "run_job_search": {
        const { data: resume } = await supabase
          .from("resumes")
          .select("id, parsed_content")
          .eq("user_id", userId)
          .eq("is_primary", true)
          .single();
        if (!resume) return JSON.stringify({ error: "No primary resume found. Upload a resume first." });
        const { data, error } = await supabase.functions.invoke("search-jobs-deep", {
          body: { resumeId: resume.id, customQuery: args.query || undefined },
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        });
        return JSON.stringify(data || { error: error?.message || "Failed to start job search" });
      }

      case "optimize_resume": {
        const { data: resume } = await supabase
          .from("resumes")
          .select("id")
          .eq("user_id", userId)
          .eq("is_primary", true)
          .single();
        if (!resume) return JSON.stringify({ error: "No primary resume found." });
        const { data, error } = await supabase.functions.invoke("optimize-resume", {
          body: { resumeId: resume.id, jobDescription: args.job_description || undefined },
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        });
        return JSON.stringify(data || { error: error?.message });
      }

      case "check_agent_status": {
        const [tasks, runs] = await Promise.all([
          supabase.from("agent_tasks").select("id, task_type, status, result, created_at")
            .eq("user_id", userId).in("status", ["pending", "running"])
            .order("created_at", { ascending: false }).limit(5),
          supabase.from("agent_runs").select("id, run_type, status, summary_json, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
        ]);
        return JSON.stringify({ activeTasks: tasks.data || [], recentRuns: runs.data || [] });
      }

      case "get_job_matches": {
        const limit = (args.limit as number) || 10;
        const { data: jobs } = await supabase.from("jobs")
          .select("id, title, company, location, match_score, url, created_at")
          .eq("user_id", userId)
          .order("match_score", { ascending: false, nullsFirst: false })
          .limit(limit);
        return JSON.stringify({ jobs: jobs || [], count: jobs?.length || 0 });
      }

      case "get_applications": {
        let query = supabase.from("applications")
          .select("id, status, company_name, job_title, job_url, applied_at, status_message")
          .eq("user_id", userId).order("applied_at", { ascending: false });
        if (args.status) query = query.eq("status", args.status as string);
        const { data } = await query.limit((args.limit as number) || 10);
        return JSON.stringify({ applications: data || [], count: data?.length || 0 });
      }

      case "auto_shop_order": {
        const { data: address } = await supabase.from("shipping_addresses")
          .select("id").eq("user_id", userId).eq("is_default", true).single();
        const { data, error } = await supabase.from("auto_shop_orders").insert({
          user_id: userId,
          product_query: args.product as string,
          max_price: (args.max_price as number) || null,
          quantity: (args.quantity as number) || 1,
          shipping_address_id: address?.id || null,
          status: "pending",
        }).select().single();
        if (error) return JSON.stringify({ error: error.message });
        await supabase.functions.invoke("auto-shop", {
          body: { orderId: data.id },
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        });
        return JSON.stringify({ success: true, orderId: data.id, message: "Order placed — agent is shopping now." });
      }

      case "get_profile_info": {
        const [profile, prefs, resume, credits, addresses, cards] = await Promise.all([
          supabase.from("profiles").select("*").eq("user_id", userId).single(),
          supabase.from("job_preferences").select("*").eq("user_id", userId).single(),
          supabase.from("resumes").select("id, title, ats_score, skills, is_primary").eq("user_id", userId),
          supabase.from("user_credits").select("balance").eq("user_id", userId).single(),
          supabase.from("shipping_addresses").select("id, address_name, full_name, city, state, is_default").eq("user_id", userId),
          supabase.from("payment_cards").select("id, card_name, cardholder_name, is_default").eq("user_id", userId),
        ]);
        return JSON.stringify({
          profile: profile.data,
          preferences: prefs.data,
          resumes: resume.data,
          credits: credits.data?.balance || 0,
          shippingAddresses: addresses.data || [],
          paymentCards: cards.data || [],
        });
      }

      case "check_email_inbox": {
        const limit = (args.limit as number) || 10;
        const { data: emails } = await supabase.from("job_emails")
          .select("id, from_name, from_email, subject, snippet, classification, received_at, is_read")
          .eq("user_id", userId).order("received_at", { ascending: false }).limit(limit);
        return JSON.stringify({ emails: emails || [], count: emails?.length || 0 });
      }

      case "search_web": {
        const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
        if (!FIRECRAWL_API_KEY) return JSON.stringify({ error: "Web search not configured — Firecrawl connector needed." });
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: args.query, limit: 5 }),
        });
        if (!res.ok) return JSON.stringify({ error: "Search failed" });
        const data = await res.json();
        const results = (data.data || []).map((r: any) => ({
          title: r.title, url: r.url,
          description: r.description || r.markdown?.substring(0, 300),
        }));
        return JSON.stringify({ results });
      }

      case "browse_website": {
        const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
        if (!FIRECRAWL_API_KEY) return JSON.stringify({ error: "Web browsing not configured — Firecrawl connector needed." });
        let url = (args.url as string).trim();
        if (!url.startsWith("http")) url = `https://${url}`;
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (!res.ok) return JSON.stringify({ error: `Failed to browse ${url}` });
        const data = await res.json();
        const markdown = data.data?.markdown || data.markdown || "";
        const meta = data.data?.metadata || data.metadata || {};
        return JSON.stringify({ title: meta.title, url: meta.sourceURL || url, content: markdown.substring(0, 4000) });
      }

      case "browser_task": {
        const BU_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
        if (!BU_API_KEY) return JSON.stringify({ error: "Browser automation not configured — BROWSER_USE_API_KEY needed." });

        // Get user's browser profile for auth persistence
        const { data: browserProfile } = await supabase.from("browser_profiles")
          .select("browser_use_profile_id").eq("user_id", userId).single();

        const taskBody: any = {
          task: args.task as string,
          maxSteps: (args.max_steps as number) || 50,
        };
        if (args.start_url) taskBody.startUrl = args.start_url as string;
        if (browserProfile?.browser_use_profile_id) {
          // Create session with profile first
          const sessionRes = await fetch("https://api.browser-use.com/api/v2/sessions", {
            method: "POST",
            headers: { "X-Browser-Use-API-Key": BU_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ profileId: browserProfile.browser_use_profile_id }),
          });
          if (sessionRes.ok) {
            const session = await sessionRes.json();
            taskBody.sessionId = session.id;
          }
        }

        const res = await fetch("https://api.browser-use.com/api/v2/tasks", {
          method: "POST",
          headers: { "X-Browser-Use-API-Key": BU_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(taskBody),
        });

        if (!res.ok) {
          const errText = await res.text();
          return JSON.stringify({ error: `Browser task failed (${res.status}): ${errText}` });
        }
        const taskData = await res.json();

        // Get live URL
        const sessionRes = await fetch(`https://api.browser-use.com/api/v2/sessions/${taskData.sessionId}`, {
          headers: { "X-Browser-Use-API-Key": BU_API_KEY },
        });
        const sessionData = sessionRes.ok ? await sessionRes.json() : {};

        return JSON.stringify({
          success: true,
          taskId: taskData.id,
          sessionId: taskData.sessionId,
          liveUrl: sessionData.liveUrl || null,
          message: "Browser task launched. The agent is working on it now.",
        });
      }

      case "phone_call": {
        const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
        const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
        const TWILIO_NUMBER = Deno.env.get("TWILIO_WHATSAPP_NUMBER")?.replace("whatsapp:", "") || "";
        if (!TWILIO_SID || !TWILIO_TOKEN) return JSON.stringify({ error: "Telephony not configured — Twilio credentials needed." });

        const twiml = `<Response><Say voice="Polly.Matthew">${(args.script || args.objective as string).replace(/[<>&'"]/g, "")}</Say></Response>`;

        const callParams = new URLSearchParams();
        callParams.append("To", args.phone_number as string);
        callParams.append("From", TWILIO_NUMBER);
        callParams.append("Twiml", twiml);

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: callParams.toString(),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          return JSON.stringify({ error: `Call failed (${res.status}): ${errData.message || "Unknown error"}` });
        }
        const callData = await res.json();
        return JSON.stringify({
          success: true,
          callSid: callData.sid,
          status: callData.status,
          to: callData.to,
          message: `Call initiated to ${args.phone_number}. Objective: ${args.objective}`,
        });
      }

      case "send_sms": {
        const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
        const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
        const TWILIO_NUMBER = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || "";
        if (!TWILIO_SID || !TWILIO_TOKEN) return JSON.stringify({ error: "Messaging not configured — Twilio credentials needed." });

        const channel = (args.channel as string) || "sms";
        const from = channel === "whatsapp" ? TWILIO_NUMBER : TWILIO_NUMBER.replace("whatsapp:", "");
        const to = channel === "whatsapp" ? `whatsapp:${args.phone_number}` : args.phone_number as string;

        const msgParams = new URLSearchParams();
        msgParams.append("To", to);
        msgParams.append("From", from);
        msgParams.append("Body", args.message as string);

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: msgParams.toString(),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          return JSON.stringify({ error: `Message failed: ${errData.message || res.status}` });
        }
        const msgData = await res.json();
        return JSON.stringify({ success: true, sid: msgData.sid, status: msgData.status });
      }

      case "submit_application": {
        const SKYVERN_KEY = Deno.env.get("SKYVERN_API_KEY");
        if (!SKYVERN_KEY) return JSON.stringify({ error: "Job application engine not configured — Skyvern API key needed." });

        // Get user data for the application
        const [profileRes, resumeRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("user_id", userId).single(),
          supabase.from("resumes").select("*").eq("user_id", userId).eq("is_primary", true).single(),
        ]);

        const profile = profileRes.data;
        const resume = resumeRes.data;

        // Create application record
        let jobId = args.job_id as string;
        if (!jobId) {
          const { data: newJob } = await supabase.from("jobs").insert({
            user_id: userId,
            title: "Direct Application",
            company: new URL(args.job_url as string).hostname,
            source: "agent",
            url: args.job_url as string,
          }).select().single();
          jobId = newJob?.id || "";
        }

        const { data, error } = await supabase.functions.invoke("submit-application", {
          body: {
            jobId,
            jobUrl: args.job_url,
            coverLetter: args.cover_letter || undefined,
            userId,
          },
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        });

        return JSON.stringify(data || { error: error?.message || "Application submission failed" });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool execution failed" });
  }
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "AI not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) throw new Error("Unauthorized");

    const { messages, stream = true } = await req.json();

    const fullMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    if (stream) {
      let currentMessages = [...fullMessages];
      let maxLoops = 8; // Allow more loops for complex multi-tool tasks

      while (maxLoops-- > 0) {
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: currentMessages,
            tools: AGENT_TOOLS,
            tool_choice: "auto",
          }),
        });

        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          throw new Error(`OpenAI error: ${openaiRes.status} ${errText}`);
        }

        const completion = await openaiRes.json();
        const choice = completion.choices[0];

        if (choice.finish_reason === "tool_calls" || choice.message.tool_calls) {
          currentMessages.push(choice.message);
          for (const tc of choice.message.tool_calls) {
            const toolArgs = JSON.parse(tc.function.arguments || "{}");
            const result = await executeTool(tc.function.name, toolArgs, supabase, user.id);
            currentMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          }
          continue;
        }

        // Stream final response
        const streamRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o", messages: currentMessages, stream: true }),
        });

        if (!streamRes.ok) throw new Error("Stream failed");
        return new Response(streamRes.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      return new Response(JSON.stringify({ error: "Agent loop exceeded" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Non-streaming fallback
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: fullMessages,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
      }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[Manus Agent]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
