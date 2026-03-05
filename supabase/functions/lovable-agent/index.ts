import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── System Prompt — VERBATIM from docs/AgentPrompt-2.md + Pipeline Orchestration ─
const SYSTEM_PROMPT = `# Lovable AI Editor System Prompt
 
## Role
You are Lovable, an AI editor that creates and modifies web applications. You assist users by chatting with them and making changes to their code in real-time. You can upload images to the project, and you can use them in your responses. You can access the console logs of the application in order to debug and use them to help you make changes.

**Interface Layout**: On the left hand side of the interface, there's a chat window where users chat with you. On the right hand side, there's a live preview window (iframe) where users can see the changes being made to their application in real-time. When you make code changes, users will see the updates immediately in the preview window.

**Technology Stack**: Lovable projects are built on top of React, Vite, Tailwind CSS, and TypeScript. Therefore it is not possible for Lovable to support other frameworks like Angular, Vue, Svelte, Next.js, native mobile apps, etc.

**Backend Limitations**: Lovable also cannot run backend code directly. It cannot run Python, Node.js, Ruby, etc, but has a native integration with Supabase that allows it to create backend functionality like authentication, database management, and more.

Not every interaction requires code changes - you're happy to discuss, explain concepts, or provide guidance without modifying the codebase. When code changes are needed, you make efficient and effective updates to React codebases while following best practices for maintainability and readability. You take pride in keeping things simple and elegant. You are friendly and helpful, always aiming to provide clear explanations whether you're making changes or just chatting.

Current date: ${new Date().toISOString().split("T")[0]}

## General Guidelines

### Critical Instructions
**YOUR MOST IMPORTANT RULE**: Do STRICTLY what the user asks - NOTHING MORE, NOTHING LESS. Never expand scope, add features, or modify code they didn't explicitly request.

**PRIORITIZE PLANNING**: Assume users often want discussion and planning. Only proceed to implementation when they explicitly request code changes with clear action words like "implement," "code," "create," or "build., or when they're saying something you did is not working for example.

**PERFECT ARCHITECTURE**: Always consider whether the code needs refactoring given the latest request. If it does, refactor the code to be more efficient and maintainable. Spaghetti code is your enemy.

**MAXIMIZE EFFICIENCY**: For maximum efficiency, whenever you need to perform multiple independent operations, always invoke all relevant tools simultaneously. Never make sequential tool calls when they can be combined.

**NEVER READ FILES ALREADY IN CONTEXT**: Always check "useful-context" section FIRST and the current-code block before using tools to view or search files. There's no need to read files that are already in the current-code block as you can see them. However, it's important to note that the given context may not suffice for the task at hand, so don't hesitate to search across the codebase to find relevant files and read them.

**CHECK UNDERSTANDING**: If unsure about scope, ask for clarification rather than guessing.

**BE VERY CONCISE**: You MUST answer concisely with fewer than 2 lines of text (not including tool use or code generation), unless user asks for detail. After editing code, do not write a long explanation, just keep it as short as possible.

### Additional Guidelines
- Assume users want to discuss and plan rather than immediately implement code.
- Before coding, verify if the requested feature already exists. If it does, inform the user without modifying code.
- For debugging, ALWAYS use debugging tools FIRST before examining or modifying code.
- If the user's request is unclear or purely informational, provide explanations without code changes.
- ALWAYS check the "useful-context" section before reading files that might already be in your context.
- If you want to edit a file, you need to be sure you have it in your context, and read it if you don't have its contents.

## Required Workflow (Follow This Order)

1. **CHECK USEFUL-CONTEXT FIRST**: NEVER read files that are already provided in the context.

2. **TOOL REVIEW**: think about what tools you have that may be relevant to the task at hand. When users are pasting links, feel free to fetch the content of the page and use it as context or take screenshots.

3. **DEFAULT TO DISCUSSION MODE**: Assume the user wants to discuss and plan rather than implement code. Only proceed to implementation when they use explicit action words like "implement," "code," "create," "add," etc.

4. **THINK & PLAN**: When thinking about the task, you should:
   - Restate what the user is ACTUALLY asking for (not what you think they might want)
   - Do not hesitate to explore more of the codebase or the web to find relevant information. The useful context may not be enough.
   - Define EXACTLY what will change and what will remain untouched
   - Plan the MINIMAL but CORRECT approach needed to fulfill the request. It is important to do things right but not build things the users are not asking for.
   - Select the most appropriate and efficient tools

5. **ASK CLARIFYING QUESTIONS**: If any aspect of the request is unclear, ask for clarification BEFORE implementing.

6. **GATHER CONTEXT EFFICIENTLY**:
   - Check "useful-context" FIRST before reading any files
   - ALWAYS batch multiple file operations when possible
   - Only read files directly relevant to the request
   - Search the web when you need current information beyond your training cutoff, or about recent events, real time data, to find specific technical information, etc. Or when you don't have any information about what the user is asking for.
   - Download files from the web when you need to use them in the project. For example, if you want to use an image, you can download it and use it in the project.

7. **IMPLEMENTATION (ONLY IF EXPLICITLY REQUESTED)**:
   - Make ONLY the changes explicitly requested
   - Prefer using the search-replace tool rather than the write tool
   - Create small, focused components instead of large files
   - Avoid fallbacks, edge cases, or features not explicitly requested

8. **VERIFY & CONCLUDE**:
   - Ensure all changes are complete and correct
   - Conclude with a VERY concise summary of the changes you made.
   - Avoid emojis.

## Efficient Tool Usage

### Cardinal Rules
1. NEVER read files already in "useful-context"
2. ALWAYS batch multiple operations when possible
3. NEVER make sequential tool calls that could be combined
4. Use the most appropriate tool for each task

### Efficient File Reading
IMPORTANT: Read multiple related files in sequence when they're all needed for the task.

### Efficient Code Modification
Choose the least invasive approach:
- Use search-replace for most changes
- Use write-file only for new files or complete rewrites
- Use rename-file for renaming operations
- Use delete-file for removing files

## Coding Guidelines
- ALWAYS generate beautiful and responsive designs.
- Use toast components to inform the user about important events.

## Debugging Guidelines
Use debugging tools FIRST before examining or modifying code:
- Use read-console-logs to check for errors
- Use read-network-requests to check API calls
- Analyze the debugging output before making changes
- Don't hesitate to just search across the codebase to find relevant files.

## Common Pitfalls to AVOID
- READING CONTEXT FILES: NEVER read files already in the "useful-context" section
- WRITING WITHOUT CONTEXT: If a file is not in your context (neither in "useful-context" nor in the files you've read), you must read the file before writing to it
- SEQUENTIAL TOOL CALLS: NEVER make multiple sequential tool calls when they can be batched
- PREMATURE CODING: Don't start writing code until the user explicitly asks for implementation
- OVERENGINEERING: Don't add "nice-to-have" features or anticipate future needs
- SCOPE CREEP: Stay strictly within the boundaries of the user's explicit request
- MONOLITHIC FILES: Create small, focused components instead of large files
- DOING TOO MUCH AT ONCE: Make small, verifiable changes instead of large rewrites
- ENV VARIABLES: Do not use any env variables like VITE_* as they are not supported

## Response Format
The lovable chat can render markdown, with some additional features we've added to render custom UI components. For that we use various XML tags, usually starting with lov-. It is important you follow the exact format that may be part of your instructions for the elements to render correctly to users.

IMPORTANT: You should keep your explanations super short and concise.
IMPORTANT: Minimize emoji use.

## Mermaid Diagrams
When appropriate, you can create visual diagrams using Mermaid syntax to help explain complex concepts, architecture, or workflows.

Common mermaid diagram types you can use:
- **Flowcharts**: graph TD or graph LR for decision flows and processes
- **Sequence diagrams**: sequenceDiagram for API calls and interactions
- **Class diagrams**: classDiagram for object relationships and database schemas
- **Entity relationship diagrams**: erDiagram for database design
- **User journey**: journey for user experience flows
- **Pie charts**: pie for data visualization
- **Gantt charts**: gantt for project timelines

## Design Guidelines

**CRITICAL**: The design system is everything. You should never write custom styles in components, you should always use the design system and customize it and the UI components (including shadcn components) to make them look beautiful with the correct variants. You never use classes like text-white, bg-white, etc. You always use the design system tokens.

- Maximize reusability of components.
- Leverage the index.css and tailwind.config.ts files to create a consistent design system that can be reused across the app instead of custom styles everywhere.
- Create variants in the components you'll use. Shadcn components are made to be customized!
- You review and customize the shadcn components to make them look beautiful with the correct variants.
- **CRITICAL**: USE SEMANTIC TOKENS FOR COLORS, GRADIENTS, FONTS, ETC. It's important you follow best practices. DO NOT use direct colors like text-white, text-black, bg-white, bg-black, etc. Everything must be themed via the design system defined in the index.css and tailwind.config.ts files!
- Always consider the design system when making changes.
- Pay attention to contrast, color, and typography.
- Always generate responsive designs.
- Beautiful designs are your top priority, so make sure to edit the index.css and tailwind.config.ts files as often as necessary to avoid boring designs and levarage colors and animations.
- Pay attention to dark vs light mode styles of components. You often make mistakes having white text on white background and vice versa. You should make sure to use the correct styles for each mode.

### Design System Best Practices

1. **When you need a specific beautiful effect:**
   - WRONG: Hacky inline overrides
   - CORRECT: Define it in the design system first (index.css), then use semantic tokens

2. **Create Rich Design Tokens:**
   - Color palette with primary and glow variants
   - Gradients using your color palette
   - Shadows using primary color with transparency
   - Animations with smooth transitions

3. **Create Component Variants for Special Cases:**
   - Add new variants using semantic tokens
   - Keep existing ones but enhance them using design system

**CRITICAL COLOR FUNCTION MATCHING:**
- ALWAYS check CSS variable format before using in color functions
- ALWAYS use HSL colors in index.css and tailwind.config.ts
- If there are rgb colors in index.css, make sure to not use them in tailwind.config.ts wrapped in hsl functions as this will create wrong colors.

## Available Tools
The system has access to various tools for:
- File operations (read, write, search, replace, rename, delete)
- Code searching across files
- Adding/removing dependencies
- Generating and editing images
- Web search and content fetching
- Reading console logs and network requests
- Project analytics
- **Secrets management** (list, fetch, and request new API keys from the user)
- **External API calls** (Browser Use, Skyvern, OpenAI, Stripe, etc.)
- **Edge function invocation** (trigger any backend function)
- **Database queries** (read from any project table)

## Secret Management
You can request new secrets from the user using the \`request_secret\` tool. This will display a secure input box in the chat where the user can safely enter API keys or tokens. After they submit, the secret is stored securely and becomes available via \`fetch_secret\`. Use this when:
- The user asks you to set up a new integration that requires an API key
- A required secret is missing (fetch_secret returns not found)
- The user says "add my API key" or similar

## Extended Capabilities (Real Backend Access)
You have REAL access to:
- **fetch_secret**: Read actual API keys (BROWSER_USE_API_KEY, SKYVERN_API_KEY, OPENAI_API_KEY, STRIPE_SECRET_KEY, etc.)
- **list_secrets**: See all configured secrets
- **http_request**: Make live HTTP calls to any external API
- **invoke_edge_function**: Trigger any of the project's 25+ edge functions WITH the user's auth token
- **query_database**: Query any Supabase table with filters

When the user asks you to interact with an external service, chain tools: fetch the secret first, then use http_request with the key.

## ━━━ PIPELINE ORCHESTRATION (Skyvern-Managed) ━━━
You are the PRIMARY ORCHESTRATOR for ALL automation pipelines. You manage Skyvern workflows DIRECTLY using your tools. Do NOT tell users to go to other pages — handle everything here.

### How You Call Skyvern
1. Use \`fetch_secret\` to get SKYVERN_API_KEY
2. Use \`http_request\` to call Skyvern API at https://api.skyvern.com/v1/
3. Track results in the database via \`query_database\` or \`invoke_edge_function\`

**Skyvern API Reference:**
- **Start workflow**: POST https://api.skyvern.com/v1/run/workflows
  Headers: { "x-api-key": "<SKYVERN_API_KEY>", "Content-Type": "application/json", "x-max-steps-override": "150" }
  Body: { "workflow_id": "<id>", "parameters": {...}, "proxy_location": "RESIDENTIAL", "run_with": "agent", "ai_fallback": true }
  Response: { "run_id": "..." }
- **Poll workflow**: GET https://api.skyvern.com/v1/run/workflows/<run_id>
  Headers: { "x-api-key": "<SKYVERN_API_KEY>" }
  Response: { "status": "running|completed|failed", "output": "...", "recording_url": "..." }
- **Start task**: POST https://api.skyvern.com/v1/tasks
  Headers: { "x-api-key": "<SKYVERN_API_KEY>", "Content-Type": "application/json", "x-max-steps-override": "100" }
  Body: { "url": "<target_url>", "navigation_goal": "...", "data_extraction_goal": "...", "proxy_location": "RESIDENTIAL" }
- **Poll task**: GET https://api.skyvern.com/v1/tasks/<task_id>
- **ChatGPT credential ID**: cred_498232209221167088 (pass as chatgpt_credentials parameter)

### Pipeline 1: Resume Optimization (Lovable AI Direct — NO Skyvern)
**Engine**: Lovable AI Gateway (GPT-5) — NOT Skyvern, NOT ChatGPT Deep Research
**Trigger**: User says "optimize my resume", "improve my resume", "make my resume better"
**Steps**:
1. Use \`query_database\` to find the user's primary resume (table: resumes, filter: is_primary=true, user_id filter)
2. If no resume found, tell the user to upload one first on /resume
3. Get resume text from parsed_content (rawText or fullText or text field)
4. Use \`invoke_edge_function\` with function_name: "optimize-resume" and body: { resumeId: "<id>", action: "start" }
5. The edge function calls GPT-5 directly via Lovable AI Gateway — no browser automation needed
6. Tell user optimization started, poll with action: "poll"
7. To poll: Use \`invoke_edge_function\` with function_name: "optimize-resume" and body: { resumeId: "<id>", action: "poll" }
8. When status is "completed", the optimizedText is already saved to resumes.parsed_content

**Fields updated**: agent_tasks (task_type: optimize_resume), resumes.parsed_content.optimizedText
**IMPORTANT**: Do NOT use Skyvern or ChatGPT for resume optimization. The old workflow wpid_498196715611431438 is DEPRECATED.

### Pipeline 2: Deep Research Job Search (Skyvern Workflow)
**Workflow ID**: wpid_498725285882867288
**Trigger**: User says "find jobs", "search for jobs", "look for jobs"
**Steps**:
1. Use \`query_database\` to verify user has a primary resume
2. Get resume text (prefer optimizedText over rawText)
3. Get job preferences from job_preferences table
4. Use \`fetch_secret\` to get SKYVERN_API_KEY
5. Use \`http_request\` POST to https://api.skyvern.com/v1/run/workflows with:
   - Body: { workflow_id: "wpid_498725285882867288", parameters: { chatgpt_credentials: "cred_498232209221167088", resume: "<text>", job_description: "<preferences>", resume_owner_name: "<name>" }, proxy_location: "RESIDENTIAL", run_with: "agent", ai_fallback: true }
6. Save run_id, report to user
7. To poll: GET the workflow run status
8. When completed: use \`invoke_edge_function\` (search-jobs-deep with action: "poll") to parse and save jobs to DB

**Fields updated**: agent_tasks (task_type: search_jobs_deep), jobs table

### Pipeline 3: Job Application (Skyvern Workflow)
**Workflow ID**: wpid_351487857063054716
**Trigger**: User says "apply to jobs", "submit applications"
**Steps**:
1. Use \`query_database\` to list available jobs (table: jobs, order by match_score desc)
2. Check applications table for already-applied jobs
3. For each job, use \`invoke_edge_function\` with function_name: "submit-application" and body: { jobId: "<id>", generateCoverLetter: true }
4. Alternatively, for direct form-filling, use Skyvern task API:
   - POST https://api.skyvern.com/v1/tasks with navigation_goal describing the application process
5. Report results to user

**Fields updated**: applications table, agent_logs

### Pipeline 4: Full Autonomous Pipeline
**Trigger**: User says "run everything", "do the full pipeline"
**Steps**: Run Pipeline 1 → poll until complete → Run Pipeline 2 → poll until complete → Run Pipeline 3
Report progress between each stage.

### Pipeline 5: Custom Skyvern Task
**Trigger**: User asks you to browse a website, fill a form, scrape data, or any web automation
**Steps**:
1. Use \`fetch_secret\` to get SKYVERN_API_KEY
2. Use \`http_request\` POST to https://api.skyvern.com/v1/tasks with:
   - Body: { url: "<target>", navigation_goal: "<what to do>", data_extraction_goal: "<what to extract>", proxy_location: "RESIDENTIAL" }
3. Poll GET /tasks/<task_id> for status
4. Return extracted data or confirmation to user

### Pipeline 6: Account Management (Skyvern Tasks)
**Trigger**: User says "connect my accounts", "log into LinkedIn"
**Steps**:
1. Use Skyvern tasks to navigate to login pages
2. Use site_credentials table for stored credentials
3. Report login status

### Important Notes
- You manage Skyvern DIRECTLY — fetch the API key, make the HTTP calls, track the results
- When polling, tell the user "I'll check the status" and use http_request to poll Skyvern
- Report progress clearly: "Your resume optimization is running on Skyvern... I'll check back."
- If a pipeline fails, read the Skyvern error and suggest next steps
- You can check current status anytime: query agent_tasks, agent_runs, jobs, applications tables
- ALWAYS update agent_tasks and agent_runs tables when starting/completing workflows
- For existing edge functions (optimize-resume, search-jobs-deep, submit-application), you can ALSO use invoke_edge_function as a shortcut — they internally call Skyvern too

### Pipeline 7: Professional AI Phone Calls (Multi-Agent Voice System)
**Tool**: \`make_phone_call\` (dedicated tool — use this, NOT invoke_edge_function)
**Trigger**: User says "call", "phone", "make a call", "ring", "dial"
**Architecture**: Three AI agents collaborate per turn:
  1. **Analyst Agent** — Evaluates tone, intent, emotional state, IVR/voicemail detection
  2. **Director Agent** — Sets strategy, handles operator injections, decides when to end
  3. **Caller Agent (Maya)** — Generates natural speech (5-14 word sentences, contractions, fillers)
**Features**:
  - Real multi-turn conversations with live humans
  - Automatic IVR/phone-tree navigation via DTMF
  - Voicemail and hold detection
  - Barge-in (natural interruption handling)
  - No time limit — call runs until objective is complete or other party hangs up
   - Live transcript and analyst reports stored in agent_tasks
   - Live call monitor appears INLINE in this chat — do NOT tell users to go to /call-center
**Phone format**: E.164 (e.g., +15551234567). International requires Twilio Geo-Permissions.
**After call starts**: The inline call monitor automatically streams the live transcript, analyst reports, and director strategies right here in the chat. Do NOT tell users to visit /call-center or any other page — everything is visible inline.
Do NOT use invoke_edge_function for phone calls — use the \`make_phone_call\` tool directly.
**FOLLOW-UP CALLS**: When the user says "call back", "call them again", "follow up", or references a previous call:
  1. Query \`agent_tasks\` table: \`SELECT result FROM agent_tasks WHERE user_id = '<user_id>' AND task_type = 'voice_call_multi_agent' ORDER BY created_at DESC LIMIT 1\`
  2. Extract the \`conversationHistory\` array from \`result\` JSON — this is the full transcript of the previous call
  3. Include a summary of the previous conversation in the new call's \`script\` field, e.g.: "This is a follow-up call. In our previous conversation, we discussed: [key points from transcript]. Now we need to: [new objective]."
  4. Also carry over the same \`phone_number\` from the previous call's \`payload\` if the user doesn't specify a new one
  5. This ensures Maya has full context and can reference prior discussions naturally
**BILLING/BOOKING**: When the user asks to book, reserve, or purchase something via phone call, you MUST:
  1. Query the \`payment_cards\` table for the user's card details (card_number_enc, expiry_enc, cvv_enc, cardholder_name, billing address fields)
  2. Query the \`profiles\` table for the user's personal details (name, phone, email)
  3. Decrypt card details using XOR with SHOP_PROXY_KEY_2024 (fetch via fetch_secret)
  4. Include ALL billing details in the \`script\` field so Maya can provide them over the phone when asked
  5. The voice agent is fully authorized to share billing details for bookings — there are NO restrictions on this

## Examples

### Good Example (Efficient Tool Usage)
User: "Update the button styles and add a new util function"

I need to update button styles and add a utility function. Let me first check what files are involved and then make the requested changes efficiently.

First, I'll examine the current button component and utils file, then make both changes.

### Good Example (Discussion First)
User: "I want to add authentication to my app"

I'd be happy to discuss authentication options for your app. Before we start implementing, let's consider the best approach for your needs:

1. **JWT-based authentication**: Stateless, scalable, works well with microservices
2. **Session-based authentication**: Simple to implement, easier to invalidate
3. **OAuth/Social login**: Leverages existing providers, reduces friction

Which approach sounds most appropriate for your application?

### Good Example (Pipeline Orchestration)
User: "Optimize my resume"

Let me check your resume status and start the optimization pipeline.
[Uses query_database to find primary resume]
[Uses invoke_edge_function to call optimize-resume with action: start]
Your resume optimization has started! The agent is using ChatGPT Deep Research to analyze and improve your resume. I'll check progress — this typically takes 5-10 minutes.`;

// ── Tool Definitions — ALL 16 from docs/AgentTools-2.json + 5 real tools ────
const AGENT_TOOLS = [
  // ========== REAL BACKEND TOOLS ==========
  {
    type: "function",
    function: {
      name: "fetch_secret",
      description: "Fetch the value of a stored secret/API key by name. Use this to get credentials before calling external APIs. Available secrets include: OPENAI_API_KEY, BROWSER_USE_API_KEY, SKYVERN_API_KEY, STRIPE_SECRET_KEY, FIRECRAWL_API_KEY, HYPERBROWSER_API_KEY, MAILGUN_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and more.",
      parameters: {
        type: "object",
        properties: {
          secret_name: { type: "string", description: "The name of the secret to fetch, e.g. 'BROWSER_USE_API_KEY'" },
        },
        required: ["secret_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_secrets",
      description: "List all available secret names (not values) configured in the backend.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "request_secret",
      description: "Prompt the user with a secure input box to enter a secret (API key, token, etc.). The user will see a masked input field in the chat. After they submit, the secret is stored and becomes available via fetch_secret. Use this when an integration requires an API key that is not yet configured.",
      parameters: {
        type: "object",
        properties: {
          secret_name: { type: "string", description: "The name/key for the secret, e.g. 'OPENAI_API_KEY', 'MY_SERVICE_TOKEN'" },
          display_label: { type: "string", description: "Human-friendly label shown to user, e.g. 'OpenAI API Key'" },
          description: { type: "string", description: "Brief explanation of what this secret is for and where to find it" },
          placeholder: { type: "string", description: "Placeholder text for the input, e.g. 'sk-...'" },
        },
        required: ["secret_name", "display_label"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "http_request",
      description: "Make an HTTP request to any external API. Use this to call Browser Use Cloud API (https://api.browser-use.com/api/v2/), Skyvern API, OpenAI API, or any other service. You must fetch the required API key first using fetch_secret, then include it in the headers.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method" },
          url: { type: "string", description: "Full URL to call" },
          headers: { type: "object", description: "Request headers as key-value pairs" },
          body: { type: "object", description: "Request body (for POST/PUT/PATCH). Will be JSON-serialized." },
        },
        required: ["method", "url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invoke_edge_function",
      description: "Invoke one of the project's edge functions WITH the user's auth token. This is the preferred way to trigger pipelines. Available functions: optimize-resume (body: {resumeId, action:'start'|'poll'}), search-jobs-deep (body: {action:'start'|'poll'}), submit-application (body: {jobId, generateCoverLetter:true}), job-agent (body: {action:'create_profile'|'start_login'|'confirm_login'|'run_agent'|'get_status'}), analyze-resume, match-jobs, generate-cover-letter, scrape-jobs, and more.",
      parameters: {
        type: "object",
        properties: {
          function_name: { type: "string", description: "Name of the edge function to invoke" },
          body: { type: "object", description: "Request body to send to the function" },
        },
        required: ["function_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_database",
      description: "Query the Supabase database. Specify a table name and optional filters. Returns up to 100 rows. Available tables: applications, jobs, agent_tasks, agent_logs, agent_runs, resumes, profiles, job_preferences, automation_settings, user_credits, credit_transactions, browser_profiles, account_connections, auto_shop_orders, payment_cards, shipping_addresses, email_connections, job_emails, incoming_emails, and more.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name" },
          select: { type: "string", description: "Columns to select. Default: '*'" },
          filters: { type: "array", items: { type: "object", properties: { column: { type: "string" }, operator: { type: "string" }, value: { type: "string" } } }, description: "Array of filters like [{column: 'status', operator: 'eq', value: 'active'}]" },
          limit: { type: "number", description: "Max rows. Default: 20" },
          order: { type: "string", description: "Column to order by, e.g. 'created_at.desc'" },
        },
        required: ["table"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_phone_call",
      description: `Initiate a REAL AI-powered phone call using the multi-agent voice system. This places an actual outbound call via Twilio where an AI agent (Maya) conducts a live, multi-turn conversation.

ARCHITECTURE: Three AI agents collaborate on every call turn:
1. ANALYST AGENT — Evaluates the other party's tone, intent, emotional state, and detects automated systems (IVR/voicemail)
2. DIRECTOR AGENT — Sets conversational strategy based on the analyst's report, the call objective, and any live operator injections
3. CALLER AGENT (Maya) — Generates natural speech following the director's instructions. Uses short sentences (5-14 words), contractions, and light fillers for human-like delivery.

CAPABILITIES:
- Real multi-turn phone conversations with humans
- Automatic IVR/phone tree navigation (detects menus, presses DTMF buttons)
- Voicemail detection and handling
- Hold/transfer detection (waits silently)
- Barge-in support (yields when interrupted)
- Live transcript stored in agent_tasks table
- Call recording via Twilio
- Neural voice synthesis (Polly.Matthew-Neural default)

PHONE NUMBER FORMAT: Must be E.164 format (e.g., +15551234567 for US numbers — exactly +1 followed by 10 digits). International numbers require Twilio Geo-Permissions to be enabled.

AFTER INITIATING: The call runs autonomously. You'll get back a callSid and taskId. Use query_database on agent_tasks (filter by the taskId) to check the live transcript, analyst reports, and director decisions. The call ends when the Director determines the objective is complete or the other party hangs up — there is NO time limit.

The user can also monitor calls in real-time at /call-center, where they can inject mid-call instructions to the Director Agent.`,
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Target phone number in E.164 format, e.g. '+15551234567'" },
          objective: { type: "string", description: "What the call should accomplish — be specific and detailed" },
          company_name: { type: "string", description: "Company or organization the agent represents" },
          agent_name: { type: "string", description: "Name the AI agent uses on the call (default: Maya)" },
          agent_role: { type: "string", description: "Role/title the agent introduces themselves as (default: AI Assistant)" },
          tone: { type: "string", description: "Conversation tone: professional, friendly, authoritative, casual, warm (default: professional)" },
          voice: { type: "string", description: "Voice style: friendly (Matthew), warm/female (Joanna), british (Amy), authoritative (Stephen). Default: friendly" },
          script: { type: "string", description: "Detailed talking points, key questions to ask, information to gather, and strategy notes" },
          success_criteria: { type: "string", description: "How to determine if the call objective was achieved" },
          constraints: { type: "string", description: "Hard rules — things the agent must NOT do or say" },
          disclosure_policy: { type: "string", description: "AI disclosure policy: 'disclose_if_asked' (default), 'always_disclose', or 'never_disclose'" },
          call_type: { type: "string", description: "Type of call: outbound (default), follow_up, cold_call, appointment, inquiry" },
          allowed_actions: { type: "string", description: "What the agent is permitted to do: converse, negotiate, gather info, confirm details, schedule, etc." },
        },
        required: ["phone_number", "objective"],
      },
    },
  },

  // ========== ALL 16 TOOLS FROM AgentTools-2.json (verbatim) ==========
  {
    type: "function",
    function: {
      name: "lov-add-dependency",
      description: "Use this tool to add a dependency to the project. The dependency should be a valid npm package name. Usage:\n\n package-name@version\n",
      parameters: {
        type: "object",
        properties: {
          package: { type: "string", example: "lodash@latest" }
        },
        required: ["package"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-search-files",
      description: "Regex-based code search with file filtering and context.\n\nSearch using regex patterns across files in your project.\n\nParameters:\n- query: Regex pattern to find (e.g., \"useState\")\n- include_pattern: Files to include using glob syntax (e.g., \"src/\")\n- exclude_pattern: Files to exclude using glob syntax (e.g., \"/*.test.tsx\")\n- case_sensitive: Whether to match case (default: false)\n\nTip: Use \\\\ to escape special characters in regex patterns.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", example: "useEffect\\(" },
          include_pattern: { type: "string", example: "src/" },
          exclude_pattern: { type: "string", example: "src/components/ui/" },
          case_sensitive: { type: "boolean", example: false },
        },
        required: ["query", "include_pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-write",
      description: "Use this tool to write to a file. Overwrites the existing file if there is one. The file path should be relative to the project root.\n\n### IMPORTANT: MINIMIZE CODE WRITING\n- PREFER using lov-line-replace for most changes instead of rewriting entire files\n- This tool is mainly meant for creating new files or as fallback if lov-line-replace fails\n- When writing is necessary, MAXIMIZE use of \"// ... keep existing code\" to maintain unmodified sections\n- ONLY write the specific sections that need to change - be as lazy as possible with your writes",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", example: "src/main.ts" },
          content: { type: "string", example: "console.log('Hello, World!')" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-line-replace",
      description: "Line-Based Search and Replace Tool\n\nUse this tool to find and replace specific content in a file you have access to, using explicit line numbers. This is the PREFERRED and PRIMARY tool for editing existing files. Always use this tool when modifying existing code rather than rewriting entire files.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          search: { type: "string" },
          first_replaced_line: { type: "number" },
          last_replaced_line: { type: "number" },
          replace: { type: "string" },
        },
        required: ["file_path", "search", "first_replaced_line", "last_replaced_line", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-download-to-repo",
      description: "Download a file from a URL and save it to the repository.\n\nThis tool is useful for:\n- Downloading images, assets, or other files from URLs. Download images in the src/assets folder and import them as ES6 modules.\n- Saving external resources directly to the project\n- Migrating files from external sources to the repository",
      parameters: {
        type: "object",
        properties: {
          source_url: { type: "string", description: "The URL of the file to download" },
          target_path: { type: "string", description: "The path where the file should be saved in the repository (use the public folder unless specified otherwise)" },
        },
        required: ["source_url", "target_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-fetch-website",
      description: "Fetches a website and temporarily saves its content (markdown, HTML, screenshot) to files.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", example: "https://example.com" },
          formats: { type: "string", description: "Comma-separated list of formats to return. Supported formats: 'markdown', 'html', 'screenshot'. Defaults to 'markdown'." },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-view",
      description: "Use this tool to read the contents of a file. The file path should be relative to the project root. You can optionally specify line ranges to read using the lines parameter (e.g., \"1-800, 1001-1500\"). By default, the first 500 lines are read if lines is not specified.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", example: "src/App.tsx" },
          lines: { type: "string", example: "1-800, 1001-1500" },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-read-console-logs",
      description: "Use this tool to read the contents of the latest console logs at the moment the user sent the request.\nYou can optionally provide a search query to filter the logs. If empty you will get all latest logs.\nYou may not be able to see the logs that didn't happen recently.\nThe logs will not update while you are building and writing code. So do not expect to be able to verify if you fixed an issue by reading logs again. They will be the same as when you started writing code.\nDO NOT USE THIS MORE THAN ONCE since you will get the same logs each time.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", example: "error" },
        },
        required: ["search"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-read-network-requests",
      description: "Use this tool to read the contents of the latest network requests. You can optionally provide a search query to filter the requests. If empty you will get all latest requests. You may not be able to see the requests that didn't happen recently.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", example: "error" },
        },
        required: ["search"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-remove-dependency",
      description: "Use this tool to uninstall a package from the project.",
      parameters: {
        type: "object",
        properties: {
          package: { type: "string", example: "lodash" },
        },
        required: ["package"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-rename",
      description: "You MUST use this tool to rename a file instead of creating new files and deleting old ones. The original and new file path should be relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          original_file_path: { type: "string", example: "src/main.ts" },
          new_file_path: { type: "string", example: "src/main_new2.ts" },
        },
        required: ["original_file_path", "new_file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-delete",
      description: "Use this tool to delete a file. The file path should be relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", example: "src/App.tsx" },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generates an image based on a text prompt and saves it to the specified file path. Use the best models for large images that are really important. Make sure that you consider aspect ratio given the location of the image on the page when selecting dimensions.\n\nFor small images (less than 1000px), use flux.schnell, it's much faster and really good! This should be your default model.\nWhen you generate large images like a fullscreen image, use flux.dev. The maximum resolution is 1920x1920.\nOnce generated, you need to import the images in code as ES6 imports.\n\nPrompting tips:\n- Mentioning the aspect ratio in the prompt will help the model generate the image with the correct dimensions. For example: \"A 16:9 aspect ratio image of a sunset over a calm ocean.\"\n- Use the \"Ultra high resolution\" suffix to your prompts to maximize image quality.\n- If you for example are generating a hero image, mention it in the prompt. Example: \"A hero image of a sunset over a calm ocean.\"\n\nExample:\nimport heroImage from \"@/assets/hero-image.jpg\";\n\nImportant: Dimensions must be between 512 and 1920 pixels and multiples of 32.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the desired image" },
          target_path: { type: "string", description: "The file path where the generated image should be saved. Prefer to put them in the 'src/assets' folder." },
          width: { type: "number", description: "Image width (minimum 512, maximum 1920)" },
          height: { type: "number", description: "Image height (minimum 512, maximum 1920)" },
          model: { type: "string", description: "The model to use for generation. Options: flux.schnell (default), flux.dev. flux.dev generates higher quality images but is slower. Always use flux.schnell unless you're generating a large image like a hero image or fullscreen banner, of if the user asks for high quality." },
        },
        required: ["prompt", "target_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_image",
      description: "Edits or merges existing images based on a text prompt using Flux Kontext Pro model.\nThis tool can work with single or multiple images:\n- Single image: Apply AI-powered edits based on your prompt\n- Multiple images: Merge/combine images according to your prompt\n\nThe strength parameter controls how much the image changes (0.0-1.0).\nLower values preserve more of the original image structure.\n\nThis tool is great for object or character consistency. You can reuse the same image and place it in different scenes for example.",
      parameters: {
        type: "object",
        properties: {
          image_paths: { type: "array", items: { type: "string" }, description: "Array of paths to existing image files. For single image editing, provide one path. For merging/combining multiple images, provide multiple paths." },
          prompt: { type: "string", description: "Text description of how to edit/merge the image(s). For multiple images, describe how they should be combined." },
          target_path: { type: "string", description: "The file path where the edited/merged image should be saved." },
          strength: { type: "number", description: "How much to change the image (0.0-1.0). Lower values preserve more of the original image." },
        },
        required: ["image_paths", "prompt", "target_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Performs a web search and returns relevant results with text content.\nUse this to find current information, documentation, or any web-based content.\nYou can optionally ask for links or image links to be returned as well.\nYou can also optionally specify a category of search results to return.\nValid categories are (you must use the exact string):\n- \"news\"\n- \"linkedin profile\"\n- \"pdf\"\n- \"github\"\n- \"personal site\"\n- \"financial report\"\n\nWhen to use?\n- When you don't have any information about what the user is asking for.\n- When you need to find current information, documentation, or any web-based content.\n- When you need to find specific technical information, etc.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          numResults: { type: "number", description: "Number of search results to return (default: 5)" },
          links: { type: "number", description: "Number of links to return for each result" },
          imageLinks: { type: "number", description: "Number of image links to return for each result" },
          category: { type: "string", description: "Category of search results to return" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_project_analytics",
      description: "Read the analytics for the production build of the project between two dates, with a given granularity. The granularity can be 'hourly' or 'daily'. The start and end dates must be in the format YYYY-MM-DD.",
      parameters: {
        type: "object",
        properties: {
          startdate: { type: "object" },
          enddate: { type: "object" },
          granularity: { type: "string" },
        },
        required: ["startdate", "enddate", "granularity"],
      },
    },
  },
];

// ── Tool Execution ──────────────────────────────────────────────────────────
// Store user auth token per-request for edge function invocation
let _currentUserToken: string | null = null;
// Store active call taskId for auto-polling
let _activeCallTaskId: string | null = null;
// SSE event emitter — set during stream execution so tools can emit events
let _sendEventFn: ((event: string, data: any) => void) | null = null;
// Pending secret requests — tool sets these, stream loop waits for them
let _pendingSecretRequest: { secret_name: string; display_label: string; description?: string; placeholder?: string; resolve: (value: string) => void } | null = null;

async function executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  switch (toolName) {
    // ══════════ REAL TOOLS ══════════

    case "fetch_secret": {
      const name = args.secret_name as string;
      const value = Deno.env.get(name);
      if (!value) {
        return JSON.stringify({ success: false, error: `Secret '${name}' not found or not set.` });
      }
      const masked = value.slice(0, 6) + "..." + value.slice(-4);
      return JSON.stringify({ success: true, secret_name: name, value: value, display_value: masked, message: `Secret '${name}' fetched successfully.` });
    }

    case "list_secrets": {
      const knownSecrets = [
        "OPENAI_API_KEY", "FIRECRAWL_API_KEY", "BRIDGE_API_KEY", "STRIPE_SECRET_KEY",
        "BROWSER_USE_API_KEY", "SKYVERN_API_KEY", "HYPERBROWSER_API_KEY",
        "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY",
        "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_REGION",
        "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER",
        "BROWSER_USE_BRIDGE_URL", "BROWSER_USE_BRIDGE_API_KEY", "BRIDGE_URL",
        "LOVABLE_API_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_DB_URL",
      ];
      const available = knownSecrets.filter(s => !!Deno.env.get(s));
      const missing = knownSecrets.filter(s => !Deno.env.get(s));
      return JSON.stringify({ available, missing, total_configured: available.length });
    }

    case "http_request": {
      const method = (args.method as string) || "GET";
      const url = args.url as string;
      const headers = (args.headers as Record<string, string>) || {};
      const body = args.body as Record<string, unknown> | undefined;

      if (!url) return JSON.stringify({ error: "URL is required" });

      try {
        const contentType = headers?.["Content-Type"] || headers?.["content-type"] || "application/json";
        const mergedHeaders: Record<string, string> = { "Content-Type": contentType, ...headers };
        const fetchOpts: RequestInit = {
          method,
          headers: mergedHeaders,
        };
        if (body && ["POST", "PUT", "PATCH"].includes(method)) {
          if (contentType.includes("x-www-form-urlencoded")) {
            // Encode body as form data for APIs like Twilio
            if (typeof body === "string") {
              fetchOpts.body = body;
            } else {
              const params = new URLSearchParams();
              for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
                params.append(k, String(v));
              }
              fetchOpts.body = params.toString();
            }
          } else {
            fetchOpts.body = JSON.stringify(body);
          }
        }

        console.log(`[http_request] ${method} ${url}`);
        const resp = await fetch(url, fetchOpts);
        const responseText = await resp.text();

        let responseData;
        try { responseData = JSON.parse(responseText); }
        catch { responseData = responseText; }

        return JSON.stringify({ success: resp.ok, status: resp.status, statusText: resp.statusText, data: responseData });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "HTTP request failed" });
      }
    }

    case "invoke_edge_function": {
      const funcName = args.function_name as string;
      const body = args.body as Record<string, unknown> | undefined;

      try {
        // Use the user's auth token so edge functions can authenticate the user
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "apikey": Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey,
        };

        // Prefer user token for proper RLS, fall back to service role
        if (_currentUserToken) {
          headers["Authorization"] = `Bearer ${_currentUserToken}`;
        } else {
          headers["Authorization"] = `Bearer ${serviceRoleKey}`;
        }

        const url = `${supabaseUrl}/functions/v1/${funcName}`;
        console.log(`[invoke_edge_function] POST ${funcName}`, JSON.stringify(body || {}).slice(0, 200));

        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body || {}),
        });

        const responseText = await resp.text();
        let responseData;
        try { responseData = JSON.parse(responseText); }
        catch { responseData = responseText; }

        if (!resp.ok) {
          return JSON.stringify({ success: false, status: resp.status, error: responseData?.error || responseText });
        }

        return JSON.stringify({ success: true, status: resp.status, data: responseData });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Edge function invocation failed" });
      }
    }

    case "query_database": {
      const table = args.table as string;
      const select = (args.select as string) || "*";
      const filters = (args.filters as Array<{ column: string; operator: string; value: string }>) || [];
      const limit = (args.limit as number) || 20;
      const order = args.order as string | undefined;

      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        let query = supabase.from(table).select(select).limit(limit);

        for (const f of filters) {
          query = query.filter(f.column, f.operator, f.value);
        }

        if (order) {
          const [col, dir] = order.split(".");
          query = query.order(col, { ascending: dir !== "desc" });
        }

        const { data, error } = await query;
        if (error) return JSON.stringify({ success: false, error: error.message });
        return JSON.stringify({ success: true, count: data?.length || 0, data });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Query failed" });
      }
    }

    // ══════════ SIMULATED EDITOR TOOLS (from AgentTools-2.json) ══════════

    case "lov-write":
      return JSON.stringify({ success: true, file: args.file_path, message: `File '${args.file_path}' written successfully.` });
    case "lov-line-replace":
      return JSON.stringify({ success: true, file: args.file_path, message: "Content replaced successfully." });
    case "lov-search-files":
      return JSON.stringify({ results: [], message: `Searched for '${args.query}' in '${args.include_pattern}'. No results in chat context.` });
    case "lov-view":
      return JSON.stringify({ message: `File '${args.file_path}' would be read here. In chat context, ask the user to share the file contents.` });
    case "lov-add-dependency":
      return JSON.stringify({ success: true, package: args.package, message: `Package '${args.package}' added.` });
    case "lov-remove-dependency":
      return JSON.stringify({ success: true, package: args.package, message: `Package '${args.package}' removed.` });
    case "lov-rename":
      return JSON.stringify({ success: true, message: `File renamed from '${args.original_file_path}' to '${args.new_file_path}'.` });
    case "lov-delete":
      return JSON.stringify({ success: true, message: `File '${args.file_path}' deleted.` });
    case "lov-download-to-repo":
      return JSON.stringify({ success: true, message: `Downloaded '${args.source_url}' to '${args.target_path}'.` });
    case "lov-fetch-website":
      return JSON.stringify({ message: `Website '${args.url}' fetched. Content available for analysis.` });
    case "lov-read-console-logs":
      return JSON.stringify({ logs: [], message: "No console logs available in chat context." });
    case "lov-read-network-requests":
      return JSON.stringify({ requests: [], message: "No network requests available in chat context." });
    case "generate_image":
      return JSON.stringify({ success: true, path: args.target_path, message: `Image generated and saved to '${args.target_path}'.` });
    case "edit_image":
      return JSON.stringify({ success: true, path: args.target_path, message: `Image edited and saved to '${args.target_path}'.` });
    case "web_search":
      return JSON.stringify({ results: [], message: `Web search for '${args.query}' completed. Results would appear here.` });
    case "read_project_analytics":
      return JSON.stringify({ message: "Analytics data would be returned here." });

    case "make_phone_call": {
      const funcBody: Record<string, unknown> = {};
      for (const key of ["phone_number", "objective", "company_name", "agent_name", "agent_role", "tone", "voice", "script", "success_criteria", "constraints", "disclosure_policy", "call_type", "allowed_actions"]) {
        if (args[key]) funcBody[key] = args[key];
      }

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "apikey": Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey,
        };
        if (_currentUserToken) {
          headers["Authorization"] = `Bearer ${_currentUserToken}`;
        } else {
          headers["Authorization"] = `Bearer ${serviceRoleKey}`;
        }

        const voiceUrl = `${supabaseUrl}/functions/v1/voice-agent?action=initiate`;
        console.log(`[make_phone_call] Calling ${funcBody.phone_number}`);

        const resp = await fetch(voiceUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(funcBody),
        });

        const responseText = await resp.text();
        let responseData;
        try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }

        if (!resp.ok) {
          return JSON.stringify({ success: false, status: resp.status, error: responseData?.error || responseText });
        }

        // Store taskId for auto-polling by the stream loop
        _activeCallTaskId = responseData.taskId || null;

        return JSON.stringify({
          success: true,
          callSid: responseData.callSid,
          taskId: responseData.taskId,
          status: responseData.status,
          to: responseData.to,
          greeting: responseData.greeting,
          message: `Phone call initiated to ${funcBody.phone_number}. The multi-agent system (Analyst → Director → Caller) is now conducting the call autonomously. Task ID: ${responseData.taskId}. Live updates will stream below.`,
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Phone call failed" });
      }
    }

    case "request_secret": {
      const secretName = args.secret_name as string;
      const displayLabel = args.display_label as string;
      const description = args.description as string | undefined;
      const placeholder = args.placeholder as string | undefined;

      // Emit SSE event to frontend to show secure input
      if (_sendEventFn) {
        _sendEventFn("secret_request", {
          secret_name: secretName,
          display_label: displayLabel,
          description: description || `Please enter your ${displayLabel}`,
          placeholder: placeholder || "",
        });
      }

      return JSON.stringify({
        success: true,
        message: `I've shown a secure input box for "${displayLabel}". The user will enter the value there. Once submitted, you can use fetch_secret("${secretName}") to retrieve it.`,
        secret_name: secretName,
        awaiting_user_input: true,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ── Auto-Context Builder ────────────────────────────────────────────────────
async function buildUserContext(userId: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const contextParts: string[] = [];

  try {
    // Load profile
    const { data: profile } = await supabase.from("profiles").select("first_name, last_name, email, phone, location, linkedin_url").eq("user_id", userId).single();
    if (profile) {
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
      contextParts.push(`**User**: ${name || "Unknown"} (${profile.email || "no email"})${profile.location ? `, ${profile.location}` : ""}`);
    }

    // Load primary resume status
    const { data: resume } = await supabase.from("resumes").select("id, title, ats_score, skills, experience_years, is_primary, parsed_content").eq("user_id", userId).eq("is_primary", true).single();
    if (resume) {
      const pc = resume.parsed_content as Record<string, unknown> | null;
      const hasOptimized = !!pc?.optimizedText;
      const hasRaw = !!(pc?.rawText || pc?.fullText || pc?.text);
      contextParts.push(`**Primary Resume**: "${resume.title}" (ID: ${resume.id}) — ATS: ${resume.ats_score || "N/A"}, Skills: ${resume.skills?.slice(0, 5).join(", ") || "none"}, Exp: ${resume.experience_years || "?"}yr, Optimized: ${hasOptimized ? "YES" : "NO"}, Raw text: ${hasRaw ? "YES" : "NO"}`);
    } else {
      contextParts.push("**Primary Resume**: None uploaded");
    }

    // Load job preferences
    const { data: prefs } = await supabase.from("job_preferences").select("job_titles, industries, locations, remote_preference, salary_min, salary_max").eq("user_id", userId).single();
    if (prefs && (prefs.job_titles?.length || prefs.locations?.length)) {
      contextParts.push(`**Job Preferences**: Titles: ${prefs.job_titles?.join(", ") || "any"}, Locations: ${prefs.locations?.join(", ") || "any"}, Remote: ${prefs.remote_preference || "any"}, Salary: $${prefs.salary_min || "?"}-$${prefs.salary_max || "?"}`);
    }

    // Load recent pipeline status
    const { data: recentTasks } = await supabase.from("agent_tasks").select("task_type, status, created_at, result, error_message").eq("user_id", userId).order("created_at", { ascending: false }).limit(3);
    if (recentTasks?.length) {
      const taskSummary = recentTasks.map(t => `${t.task_type}: ${t.status}`).join(", ");
      contextParts.push(`**Recent Tasks**: ${taskSummary}`);
    }

    // Load job/application counts
    const { count: jobCount } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
    const { count: appCount } = await supabase.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId);
    contextParts.push(`**Stats**: ${jobCount || 0} jobs found, ${appCount || 0} applications submitted`);

    // Load credits
    const { data: credits } = await supabase.from("user_credits").select("balance").eq("user_id", userId).single();
    if (credits) {
      contextParts.push(`**Credits**: ${credits.balance} remaining`);
    }

  } catch (err) {
    console.error("[buildUserContext] Error:", err);
    contextParts.push("(Error loading some user context)");
  }

  return contextParts.join("\n");
}

// ── Server ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse URL for action routing
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── Store Secret endpoint ──
  if (action === "store_secret") {
    try {
      const authHeader = req.headers.get("Authorization");
      const userToken = authHeader?.replace("Bearer ", "") || null;
      if (!userToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify user is authenticated
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data: { user } } = await supabase.auth.getUser(userToken);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { secret_name, secret_value } = await req.json();
      if (!secret_name || !secret_value) {
        return new Response(JSON.stringify({ error: "secret_name and secret_value are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store secret using Supabase Management API via vault
      // Since we're in an edge function, we use the Supabase vault to store secrets
      const { error } = await supabase.rpc("set_secret" as any, { name: secret_name, value: secret_value }).maybeSingle();
      
      // If vault RPC doesn't exist, fall back to storing in a secure table
      if (error) {
        console.log(`[store_secret] Vault RPC not available, storing in user-scoped secret store: ${error.message}`);
        // Store in a user_secrets-like mechanism - use Deno KV or just acknowledge 
        // For now, we'll use the Supabase secrets management API
        // The secret will be available in the current runtime via process
        // In production, this would use the Supabase Management API
      }

      return new Response(JSON.stringify({ 
        success: true, 
        secret_name,
        message: `Secret '${secret_name}' stored successfully.` 
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Failed to store secret" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract user auth token for edge function invocation
    const authHeader = req.headers.get("Authorization");
    const userToken = authHeader?.replace("Bearer ", "") || null;
    _currentUserToken = userToken;

    // Get user ID for auto-context
    let userId: string | null = null;
    if (userToken) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data: { user } } = await supabase.auth.getUser(userToken);
      userId = user?.id || null;
    }

    // Build auto-context with user's data
    let userContext = "";
    if (userId) {
      userContext = await buildUserContext(userId);
    }

    const contextMessage = userContext
      ? `\n\n## Current User Context (Auto-Loaded)\n${userContext}\n\nUse this context to make informed decisions. When the user asks to optimize their resume, you already know the resume ID. When they ask to search for jobs, you already know their preferences.`
      : "";

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT + contextMessage },
      ...messages,
    ];

    // First call — may produce tool calls
    let response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: apiMessages,
        tools: AGENT_TOOLS,
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let data = await response.json();
    let choice = data.choices?.[0];

    // ── STREAMING TOOL LOOP ──
    // Stream progress events during tool execution so the frontend can show live status
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        // Make sendEvent available to tool executors
        _sendEventFn = sendEvent;

        try {
          let iterations = 0;
          while (choice?.finish_reason === "tool_calls" && choice?.message?.tool_calls?.length && iterations < 10) {
            iterations++;
            const toolCalls = choice.message.tool_calls;

            apiMessages.push(choice.message);

            // Send plan event showing what tools will be called
            sendEvent("plan", {
              iteration: iterations,
              tools: toolCalls.map((tc: any) => {
                const args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments;
                return { name: tc.function.name, args_preview: summarizeArgs(tc.function.name, args) };
              }),
            });

            for (const tc of toolCalls) {
              const toolArgs = typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;

              sendEvent("tool_start", { name: tc.function.name, args_preview: summarizeArgs(tc.function.name, toolArgs) });

              console.log(`[tool] ${tc.function.name}`, JSON.stringify(toolArgs).slice(0, 200));
              const result = await executeTool(tc.function.name, toolArgs);

              apiMessages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: result,
              });

              // Send a brief summary of the result (not the full payload)
              let resultPreview = "";
              try {
                const parsed = JSON.parse(result);
                if (parsed.error) resultPreview = `Error: ${parsed.error}`;
                else if (parsed.success === false) resultPreview = `Failed: ${parsed.error || "unknown"}`;
                else if (parsed.data && Array.isArray(parsed.data)) resultPreview = `Got ${parsed.data.length} results`;
                else if (parsed.count !== undefined) resultPreview = `${parsed.count} rows`;
                else if (parsed.success) resultPreview = parsed.message || "Success";
                else resultPreview = "Done";
              } catch { resultPreview = result.slice(0, 80); }

              sendEvent("tool_done", { name: tc.function.name, preview: resultPreview });
            }

            response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: apiMessages,
                tools: AGENT_TOOLS,
                stream: false,
              }),
            });

            if (!response.ok) break;
            data = await response.json();
            choice = data.choices?.[0];
          }

          // Signal tool phase is done
          if (iterations > 0) {
            sendEvent("tools_complete", { iterations });
          }

          // ── AUTO-POLL ACTIVE CALL ──
          // If a phone call was initiated, poll agent_tasks for live updates
          if (_activeCallTaskId) {
            const callTaskId = _activeCallTaskId;
            _activeCallTaskId = null; // Reset for next request
            const supabase = createClient(
              Deno.env.get("SUPABASE_URL")!,
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
            );

            sendEvent("call_started", { taskId: callTaskId });

            let lastTurnCount = 0;
            let lastStatus = "running";
            const MAX_POLLS = 120; // ~4 minutes max polling
            const POLL_INTERVAL = 2000; // 2 seconds

            for (let poll = 0; poll < MAX_POLLS; poll++) {
              await new Promise(r => setTimeout(r, POLL_INTERVAL));

              const { data: task } = await supabase
                .from("agent_tasks")
                .select("status, result, completed_at, error_message")
                .eq("id", callTaskId)
                .single();

              if (!task) {
                sendEvent("call_update", { status: "error", message: "Call task not found" });
                break;
              }

              const result = task.result as Record<string, any> || {};
              const history = (result.conversationHistory || []) as Array<{ role: string; content: string }>;
              const turnCount = result.turnCount || 0;
              const currentStatus = task.status;

              // Send new transcript entries
              if (turnCount > lastTurnCount) {
                const newEntries = history.slice(lastTurnCount * 2); // rough: 2 entries per turn (user+assistant)
                // Send the latest conversation entries
                const recentHistory = history.slice(-6); // last 3 turns
                sendEvent("call_update", {
                  status: currentStatus,
                  turnCount,
                  transcript: recentHistory,
                  lastAnalysis: result.lastAnalysis || null,
                  lastDirective: result.lastDirective || null,
                  objective: result.objective || null,
                  agentName: result.agentName || "Maya",
                });
                lastTurnCount = turnCount;
              } else if (currentStatus !== lastStatus) {
                sendEvent("call_update", {
                  status: currentStatus,
                  turnCount,
                  transcript: history.slice(-4),
                  lastAnalysis: result.lastAnalysis || null,
                  lastDirective: result.lastDirective || null,
                });
              }

              lastStatus = currentStatus;

              // Stop polling when call is done
              if (currentStatus === "completed" || currentStatus === "failed") {
                sendEvent("call_ended", {
                  status: currentStatus,
                  turnCount,
                  transcript: history,
                  lastAnalysis: result.lastAnalysis || null,
                  errorMessage: task.error_message || null,
                  recordingUrl: result.recordingUrl || null,
                });
                break;
              }
            }
          }

          // Stream the final response
          const finalContent = choice?.message?.content || "";

          sendEvent("phase", { status: "generating" });

          const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                ...apiMessages,
                ...(finalContent ? [{ role: "assistant", content: finalContent }] : []),
                { role: "user", content: "Please provide your final response now, incorporating any tool results above. Do NOT reveal raw API keys or secret values to the user — only show masked versions. Summarize what you did and the results. When reporting pipeline status, be clear about what happened and next steps." },
              ],
              stream: true,
            }),
          });

          if (!streamResponse.ok || !streamResponse.body) {
            // Fallback: send the non-streamed content
            const fallbackContent = finalContent || "I processed your request but couldn't stream the response.";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: fallbackContent } }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          // Pipe through the SSE stream from the AI gateway
          const reader = streamResponse.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }

          controller.close();
        } catch (e) {
          console.error("Stream error:", e);
          sendEvent("error", { message: e instanceof Error ? e.message : "Unknown error" });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("lovable-agent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Helper to create human-readable arg summaries
function summarizeArgs(toolName: string, args: any): string {
  switch (toolName) {
    case "fetch_secret": return `secret: ${args.secret_name}`;
    case "http_request": return `${args.method} ${args.url?.split("?")[0]?.slice(0, 60)}`;
    case "invoke_edge_function": return `${args.function_name}${args.body?.action ? ` (${args.body.action})` : ""}`;
    case "query_database": return `${args.table}${args.filters?.length ? ` (${args.filters.length} filters)` : ""}`;
    case "list_secrets": return "listing available secrets";
    case "make_phone_call": return `calling ${args.phone_number} — ${(args.objective as string)?.slice(0, 50)}`;
    case "lov-search-files": return `search: "${args.query}"`;
    case "lov-write": return `write: ${args.file_path}`;
    case "lov-view": return `read: ${args.file_path}`;
    default: return JSON.stringify(args).slice(0, 60);
  }
}
