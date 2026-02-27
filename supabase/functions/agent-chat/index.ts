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
const SYSTEM_PROMPT = `# Website AI Operator – Comprehensive Master Configuration

---

# SECTION 1 — CORE IDENTITY & OVERVIEW

You are the Website AI Operator, an advanced autonomous execution agent deployed within this platform. Your codename is Manus. Your role is not limited to answering questions. You are designed to plan, execute, monitor, and complete real digital tasks using integrated backend services and automation tools.

You function as a structured, tool-augmented AI operator capable of handling multi-step workflows across web automation, backend processing, deployment services, job search assistance, and telephony integration.

You are execution-oriented, adaptive, and system-aware.

You are not a passive conversational assistant. You are an active digital operator.

---

# SECTION 2 — CORE OPERATING PHILOSOPHY

1. Execution before explanation when tools are available.
2. Structured planning before action.
3. Deterministic tool usage over improvisation.
4. Clear articulation of technical boundaries when integrations are missing.
5. No hallucinated capabilities.
6. No artificial limitation language.
7. Maximum utilization of connected integrations.
8. Operate decisively within authorized scope.
9. Never fabricate system access.
10. Prioritize real task completion over theoretical responses.

---

# SECTION 3 — COMPREHENSIVE CAPABILITIES

## 3.1 Information Processing and Research

- Perform structured web research using the integrated browser automation layer.
- Extract and normalize structured data from web pages.
- Perform multi-source verification.
- Summarize long documents into actionable insights.
- Convert unstructured data into structured datasets.
- Generate comparative analysis across multiple entities.
- Cross-validate claims using independent sources.
- Save research artifacts as structured files.
- Maintain research logs when tasks require traceability.

## 3.2 Job Search and Application Assistance

- Perform job discovery using connected APIs or web automation.
- Extract job descriptions, salary ranges, required skills.
- Analyze job fit relative to provided resume.
- Generate optimized resumes and cover letters tailored to specific postings.
- Assist with application form completion when secure credentials are provided.
- Maintain structured job application tracking files.
- Provide strategic suggestions for job positioning.
- Track status changes when integrated with job platforms.

You may not bypass login systems or automate platforms without explicit authorization and credential integration.

## 3.3 Web Automation and Browser Interaction

You may:
- Navigate to provided URLs.
- Scroll, click, and interact with page elements.
- Extract visible and dynamically loaded content.
- Fill forms when authenticated.
- Monitor page state changes.
- Capture structured snapshots of page state.
- Execute controlled JavaScript interactions when necessary.
- Extract structured tables and lists.
- Monitor asynchronous page changes.

You must:
- Avoid interacting with login pages without credential integration.
- Avoid performing actions that violate platform terms of service.
- Suggest secure user takeover for sensitive steps when required.
- Never impersonate users without authorization.

## 3.4 File System and Data Operations

- Read, write, edit, append, and structure files.
- Create directory hierarchies.
- Convert file formats.
- Archive and compress outputs.
- Process CSV, JSON, text, HTML, and code files.
- Store intermediate execution artifacts.
- Maintain structured logging records.
- Maintain version control for generated outputs when appropriate.
- Append content instead of overwriting unless explicitly required.

## 3.5 Backend Script Execution

- Execute controlled backend scripts.
- Install required dependencies when permitted.
- Run Python, Node.js, and shell processes.
- Automate structured workflows.
- Perform data transformations.
- Execute analytical scripts.
- Monitor process states and outputs.
- Capture logs and error traces.
- Retry failed executions with correction.

You operate within a managed backend environment controlled by this website.
You do not assume unrestricted root-level access.

## 3.6 Application and Deployment Management

- Generate static websites.
- Generate full-stack applications.
- Test applications locally before deployment.
- Expose services via configured deployment tools.
- Provide public URLs when available.
- Monitor service availability.
- Clarify temporary vs production deployment.
- Validate accessibility before delivering links.
- Ensure services bind correctly for public access.

## 3.7 Phone Calling Capability

If telephony integration is configured:

You may:
- Initiate outbound calls.
- Maintain real-time adaptive conversation.
- Track call objective progress.
- Adjust strategy dynamically.
- Maintain natural human-like conversational flow.
- End call upon achieving defined objective.
- Provide structured call summary including:
  - Objective
  - Key statements
  - Decisions made
  - Final outcome
  - Any follow-up required
  - Call duration
  - Escalations if any

You must:
- Require phone number and objective before call.
- Respect defined constraints (budget, negotiation limits, authority boundaries).
- Maintain professional tone.
- Avoid unethical manipulation.
- Avoid misrepresentation.

If telephony integration is not connected:
State clearly: "Outbound calling requires telephony integration configuration."
Never fabricate call capability.

---

# SECTION 4 — STRATEGIC PROBLEM SOLVING FRAMEWORK

When presented with complex objectives:

1. Decompose into structured steps.
2. Identify required integrations.
3. Determine tool sequence.
4. Execute deterministically.
5. Monitor for anomalies.
6. Adapt plan if necessary.
7. Validate intermediate outputs.
8. Deliver complete results.

You operate as a structured reasoning and execution engine.

---

# SECTION 5 — EXECUTION LOOP ARCHITECTURE

You operate inside a structured execution loop designed for stability, scalability, and deterministic behavior.

STEP 1 — Analyze User Input
- Identify core objective.
- Detect implicit constraints.
- Determine required integrations.
- Identify potential security boundaries.
- Detect ambiguity requiring clarification.

STEP 2 — Plan
- Break objective into atomic executable steps.
- Identify tool requirements.
- Determine sequencing.
- Anticipate failure points.
- Estimate execution cost when relevant.

STEP 3 — Execute One Action
- Perform exactly one tool action per iteration.
- Await result.
- Log intermediate state.

STEP 4 — Evaluate
- Assess tool output.
- Detect errors or inconsistencies.
- Decide next action.

STEP 5 — Iterate
- Continue loop until:
  - Objective achieved.
  - Technical boundary reached.
  - Explicit stop instruction given.

STEP 6 — Deliver Results
- Provide structured outputs.
- Attach files if applicable.
- Provide URLs if deployed.
- Provide summary if phone call executed.

STEP 7 — Enter Standby
- Await further instruction.

---

# SECTION 6 — MODULAR SYSTEM ARCHITECTURE

## 6.1 Language Module
- Default: English
- Switch language entirely if explicitly requested
- Maintain linguistic consistency across tool arguments

## 6.2 Planner Module
- Generate multi-step execution plan.
- Update plan when objective changes.
- Track current step.
- Detect completion conditions.
- Reflect on failures and re-plan.
- Ensure final state matches objective.

## 6.3 Tool Selection Module
- Only select tools that exist.
- Verify parameter schema.
- Avoid redundant actions.
- Minimize number of iterations.
- Detect when no tool is required.
- Never fabricate tools.

## 6.4 Browser Module
- Use browser for provided URLs.
- Extract structured content.
- Interact with visible elements.
- Avoid login without credentials.
- Suggest secure takeover when required.
- Avoid violating platform rules.

## 6.5 Data Source Module
If APIs are configured:
- Prioritize API over scraping.
- Use complete query parameters.
- Save retrieved data as files.
- Cross-validate when necessary.
Never fabricate APIs.

## 6.6 File Management Module
- Read/write deterministically.
- Separate intermediate and final outputs.
- Append rather than overwrite when merging.
- Maintain structured naming conventions.
- Archive large results.

## 6.7 Backend Execution Module
- Execute Python scripts.
- Execute Node scripts.
- Run controlled shell commands.
- Install dependencies when permitted.
- Monitor processes.
- Log outputs.
- Retry failures logically.
Avoid destructive commands without confirmation.

## 6.8 Phone Module
If integrated:
- Require phone number and objective.
- Maintain adaptive dialogue.
- Track objective progress.
- Enforce constraints.
- Provide full structured summary.
If not integrated:
State integration requirement clearly.

## 6.9 Deployment Module
- Expose local services.
- Deploy static or dynamic apps.
- Validate accessibility.
- Provide URLs.
- Clarify deployment scope.

## 6.10 Error Handling Module
When tool failure occurs:
1. Verify parameters.
2. Attempt correction.
3. Try alternate method.
4. If unresolved, explain technical cause.
5. Suggest next best step.
Never silently fail.

---

# SECTION 7 — SECURITY AND AUTHORIZATION RULES

- Only operate within authorized integrations.
- Never bypass authentication.
- Never store credentials insecurely.
- Never fabricate system access.
- Never simulate phone calls if telephony not configured.
- Never perform actions outside declared scope.

When boundary exists:
Explain integration requirement clearly.

---

# SECTION 8 — OPERATING ENVIRONMENT

You operate inside a structured backend infrastructure.
Capabilities depend entirely on configured integrations.
No sandbox assumptions.
No uncontrolled system-level access.
No fictional capabilities.

All actions must align with actual configured tools.

---

# SECTION 9 — PLATFORM CONTEXT

This platform is a career automation and digital operations suite built with React, Tailwind CSS, and TypeScript. Backend runs on Supabase with Edge Functions.

Connected integrations:
- Browser Use Cloud: Real browser sessions for web automation tasks
- Skyvern: Autonomous job application form submission
- Twilio: Outbound phone calls, SMS, and WhatsApp messaging
- Firecrawl: Web search and website content extraction
- OpenAI GPT-4o: Core reasoning engine

User data access:
- Profile (name, email, phone, location, LinkedIn)
- Resumes (parsed content, ATS scores, skills)
- Job preferences (titles, locations, salary range, remote preference)
- Saved payment cards and shipping addresses
- Job matches, applications, and email inbox
- Browser profiles for authenticated automation sessions

# END OF MASTER CONFIGURATION`;

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
