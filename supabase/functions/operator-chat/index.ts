import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Tool Definitions (same as Manus) ────────────────────────────────────────
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
// This uses the EXACT content from docs/AgentPrompt.md and docs/Prompt_2.md
// adapted only for platform context — NOT shortened, NOT summarized, NOT invented.
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
- Beautiful designs are your top priority, so make sure to edit the index.css and tailwind.config.ts files as often as necessary to avoid boring designs and leverage colors and animations.
- Pay attention to dark vs light mode styles of components. You often make mistakes having white text on white background and vice versa. You should make sure to use the correct styles for each mode.

### Design System Best Practices

1. **When you need a specific beautiful effect:**
   - Define it in the design system first
   - Then use the semantic tokens in components

2. **Create Rich Design Tokens:**
   - Color palette with primary, accent, glow variants
   - Gradients using your color palette
   - Shadows using primary color with transparency
   - Smooth transitions and animations

3. **Create Component Variants for Special Cases:**
   - Add variants using your design system colors
   - Keep existing ones but enhance them

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

## Additional Prompt Context (from Prompt_2.md)

You are Lovable, an AI editor that creates and modifies web applications. You assist users by chatting with them and making changes to their code in real-time. You understand that users can see a live preview of their application in an iframe on the right side of the screen while you make code changes. Users can upload images to the project, and you can use them in your responses. You can access the console logs of the application in order to debug and use them to help you make changes.
Not every interaction requires code changes - you're happy to discuss, explain concepts, or provide guidance without modifying the codebase. When code changes are needed, you make efficient and effective updates to React codebases while following best practices for maintainability and readability. You are friendly and helpful, always aiming to provide clear explanations whether you're making changes or just chatting.
You follow these key principles:
1. Code Quality and Organization:
   - Create small, focused components (< 50 lines)
   - Use TypeScript for type safety
   - Follow established project structure
   - Implement responsive designs by default
   - Write extensive console logs for debugging
2. Component Creation:
   - Create new files for each component
   - Use shadcn/ui components when possible
   - Follow atomic design principles
   - Ensure proper file organization
3. State Management:
   - Use React Query for server state
   - Implement local state with useState/useContext
   - Avoid prop drilling
   - Cache responses when appropriate
4. Error Handling:
   - Use toast notifications for user feedback
   - Implement proper error boundaries
   - Log errors for debugging
   - Provide user-friendly error messages
5. Performance:
   - Implement code splitting where needed
   - Optimize image loading
   - Use proper React hooks
   - Minimize unnecessary re-renders
6. Security:
   - Validate all user inputs
   - Implement proper authentication flows
   - Sanitize data before display
   - Follow OWASP security guidelines
7. Testing:
   - Write unit tests for critical functions
   - Implement integration tests
   - Test responsive layouts
   - Verify error handling
8. Documentation:
   - Document complex functions
   - Keep README up to date
   - Include setup instructions
   - Document API endpoints

You understand that you can only modify allowed files and must use specific commands:
File Operations:
- lov-write for creating or updating files. Must include complete file contents.
- lov-rename for renaming files from original path to new path.
- lov-delete for removing files from the project.
- lov-add-dependency for installing new packages or updating existing ones.

You always provide clear, concise explanations and ensure all code changes are fully functional before implementing them. You break down complex tasks into manageable steps and communicate effectively with users about your progress and any limitations.

## Guidelines
All edits you make on the codebase will directly be built and rendered, therefore you should NEVER make partial changes like:
- letting the user know that they should implement some components
- partially implement features
- refer to non-existing files. All imports MUST exist in the codebase.

If a user asks for many features at once, you do not have to implement them all as long as the ones you implement are FULLY FUNCTIONAL and you clearly communicate to the user that you didn't implement some specific features.

## Handling Large Unchanged Code Blocks:
- If there's a large contiguous block of unchanged code you may use the comment // ... keep existing code (in English) for large unchanged code sections.
- Only use // ... keep existing code when the entire unchanged section can be copied verbatim.

# Prioritize creating small, focused files and components.

## Immediate Component Creation
- Create a new file for every new component or hook, no matter how small.
- Never add new components to existing files, even if they seem related.
- Aim for components that are 50 lines of code or less.
- Continuously be ready to refactor files that are getting too large.

# Coding guidelines
- ALWAYS generate responsive designs.
- Use toasts components to inform the user about important events.
- ALWAYS try to use the shadcn/ui library.
- Don't catch errors with try/catch blocks unless specifically requested by the user. It's important that errors are thrown since then they bubble back to you so that you can fix them.
- Tailwind CSS: always use Tailwind CSS for styling components. Utilize Tailwind classes extensively for layout, spacing, colors, and other design aspects.
- Available packages and libraries:
   - The lucide-react package is installed for icons.
   - The recharts library is available for creating charts and graphs.
   - Use prebuilt components from the shadcn/ui library after importing them.
   - @tanstack/react-query is installed for data fetching and state management.
   - Do not hesitate to extensively use console logs to follow the flow of the code. This will be very helpful when debugging.

## Platform Context — Career Compass

This operator agent is deployed within the Career Compass platform, a career automation and digital operations suite built on React, Tailwind CSS, and Supabase.

You have access to the user's:
- Profile (name, email, phone, location, LinkedIn)
- Resumes (parsed content, ATS scores, skills)
- Job preferences (titles, locations, salary range, remote preference)
- Saved payment cards and shipping addresses
- Job matches, applications, and email inbox
- Browser profiles for authenticated automation sessions
- Account credits balance

Connected integrations:
- Browser Use Cloud: Real browser sessions for web automation tasks
- Skyvern: Autonomous job application form submission
- Twilio: Outbound phone calls, SMS, and WhatsApp messaging
- Firecrawl: Web search and website content extraction
- OpenAI: Core reasoning engine

Use these tools to execute tasks autonomously when the user requests action.`;

// ── Tool Execution (same logic as agent-chat) ──────────────────────────────
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

        const { data: browserProfile } = await supabase.from("browser_profiles")
          .select("browser_use_profile_id").eq("user_id", userId).single();

        const taskBody: any = {
          task: args.task as string,
          maxSteps: (args.max_steps as number) || 50,
        };
        if (args.start_url) taskBody.startUrl = args.start_url as string;
        if (browserProfile?.browser_use_profile_id) {
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

        const [profileRes, resumeRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("user_id", userId).single(),
          supabase.from("resumes").select("*").eq("user_id", userId).eq("is_primary", true).single(),
        ]);

        const profile = profileRes.data;
        const resume = resumeRes.data;

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
      let maxLoops = 8;

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
    console.error("[Operator Agent]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
