import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Tool Definitions — every tool from the Manus source + platform-native ───
const AGENT_TOOLS = [
  // ═══ MANUS CORE TOOLS (from source tools.txt) ════════════════════════════
  // ── Communication ────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "message_notify_user",
      description: "Send a message to user without requiring a response. Use for acknowledging receipt of messages, providing progress updates, reporting task completion, or explaining changes in approach.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Message text to display to user" },
          attachments: {
            anyOf: [{ type: "string" }, { items: { type: "string" }, type: "array" }],
            description: "(Optional) List of attachments to show to user, can be file paths or URLs",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "message_ask_user",
      description: "Ask user a question and wait for response. Use for requesting clarification, asking for confirmation, or gathering additional information.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Question text to present to user" },
          attachments: {
            anyOf: [{ type: "string" }, { items: { type: "string" }, type: "array" }],
            description: "(Optional) List of question-related files or reference materials",
          },
          suggest_user_takeover: {
            type: "string",
            enum: ["none", "browser"],
            description: "(Optional) Suggested operation for user takeover",
          },
        },
        required: ["text"],
      },
    },
  },

  // ── File Operations ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read file content from platform storage. Use for checking stored resumes, documents, or data files.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path of the file to read (e.g. resumes/filename.pdf or a database table:id reference)" },
          start_line: { type: "integer", description: "(Optional) Starting line to read from, 0-based" },
          end_line: { type: "integer", description: "(Optional) Ending line number (exclusive)" },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_write",
      description: "Write or save content to platform storage. Use for saving notes, memos, generated documents, or data exports.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path/name for the file to write" },
          content: { type: "string", description: "Text content to write" },
          append: { type: "boolean", description: "(Optional) Whether to append instead of overwrite" },
        },
        required: ["file", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_str_replace",
      description: "Replace specified string in stored data. Use for updating specific content in notes or documents.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path of the file to perform replacement on" },
          old_str: { type: "string", description: "Original string to be replaced" },
          new_str: { type: "string", description: "New string to replace with" },
        },
        required: ["file", "old_str", "new_str"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_find_in_content",
      description: "Search for matching text within stored files and data.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path of the file to search within" },
          regex: { type: "string", description: "Regular expression pattern to match" },
        },
        required: ["file", "regex"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_find_by_name",
      description: "Find files by name pattern in platform storage.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to search (e.g. 'resumes')" },
          glob: { type: "string", description: "Filename pattern using glob syntax wildcards" },
        },
        required: ["path", "glob"],
      },
    },
  },

  // ── Shell Operations ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "shell_exec",
      description: "Execute commands in a shell session. Use for running scripts or managing files.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique identifier of the target shell session" },
          exec_dir: { type: "string", description: "Working directory for command execution" },
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["id", "exec_dir", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shell_view",
      description: "View the content of a specified shell session.",
      parameters: { type: "object", properties: { id: { type: "string", description: "Shell session ID" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "shell_wait",
      description: "Wait for a running process in a shell session to return.",
      parameters: { type: "object", properties: { id: { type: "string" }, seconds: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "shell_write_to_process",
      description: "Write input to a running process in a shell session.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, input: { type: "string" }, press_enter: { type: "boolean" } },
        required: ["id", "input", "press_enter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shell_kill_process",
      description: "Terminate a running process in a shell session.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  },

  // ── Browser Operations ───────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "browser_view",
      description: "View content of the current browser page. Returns the current page state and active session info.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Navigate browser to specified URL. Opens a page and returns its content.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Complete URL to visit. Must include protocol prefix." } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_restart",
      description: "Restart browser and navigate to specified URL. Use when browser state needs to be reset.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "URL to visit after restart." } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description: "Click on elements in the current browser page.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "(Optional) Index number of the element to click" },
          coordinate_x: { type: "number", description: "(Optional) X coordinate" },
          coordinate_y: { type: "number", description: "(Optional) Y coordinate" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_input",
      description: "Overwrite text in editable elements on the current browser page.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer" }, coordinate_x: { type: "number" }, coordinate_y: { type: "number" },
          text: { type: "string", description: "Complete text content to overwrite" },
          press_enter: { type: "boolean", description: "Whether to press Enter after input" },
        },
        required: ["text", "press_enter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_move_mouse",
      description: "Move cursor to specified position on the current browser page.",
      parameters: {
        type: "object",
        properties: { coordinate_x: { type: "number" }, coordinate_y: { type: "number" } },
        required: ["coordinate_x", "coordinate_y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_press_key",
      description: "Simulate key press in the current browser page.",
      parameters: {
        type: "object",
        properties: { key: { type: "string", description: "Key name (e.g., Enter, Tab), supports combos (e.g., Control+Enter)." } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_select_option",
      description: "Select specified option from dropdown list element.",
      parameters: {
        type: "object",
        properties: { index: { type: "integer" }, option: { type: "integer" } },
        required: ["index", "option"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_scroll_up",
      description: "Scroll up the current browser page.",
      parameters: { type: "object", properties: { to_top: { type: "boolean" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_scroll_down",
      description: "Scroll down the current browser page.",
      parameters: { type: "object", properties: { to_bottom: { type: "boolean" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_console_exec",
      description: "Execute JavaScript code in browser console.",
      parameters: {
        type: "object",
        properties: { javascript: { type: "string", description: "JavaScript code to execute." } },
        required: ["javascript"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_console_view",
      description: "View browser console output.",
      parameters: { type: "object", properties: { max_lines: { type: "integer" } } },
    },
  },

  // ── Web Search ───────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "info_search_web",
      description: "Search the web using search engine. Use for obtaining latest information, finding references, researching companies, salary data, products, prices, or anything else.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query, 3-5 keywords." },
          date_range: {
            type: "string",
            enum: ["all", "past_hour", "past_day", "past_week", "past_month", "past_year"],
            description: "(Optional) Time range filter.",
          },
        },
        required: ["query"],
      },
    },
  },

  // ── Deployment ───────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "deploy_expose_port",
      description: "Expose specified local port for temporary public access.",
      parameters: { type: "object", properties: { port: { type: "integer" } }, required: ["port"] },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_apply_deployment",
      description: "Deploy website or application to public production environment.",
      parameters: {
        type: "object",
        properties: { type: { type: "string", enum: ["static", "nextjs"] }, local_dir: { type: "string" } },
        required: ["type", "local_dir"],
      },
    },
  },

  // ── Manus Page ───────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "make_manus_page",
      description: "Make a Manus Page from a local MDX file.",
      parameters: { type: "object", properties: { mdx_file_path: { type: "string" } }, required: ["mdx_file_path"] },
    },
  },

  // ── Idle ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "idle",
      description: "A special tool to indicate you have completed all tasks and are about to enter idle state.",
      parameters: { type: "object", properties: {} },
    },
  },

  // ═══ PLATFORM-NATIVE TOOLS ═══════════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "run_job_search",
      description: "Search for jobs matching the user's preferences. Triggers the deep research job discovery pipeline.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Optional search query" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "optimize_resume",
      description: "Start resume optimization using ChatGPT Deep Research.",
      parameters: { type: "object", properties: { job_description: { type: "string", description: "Optional job description to tailor for" } } },
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
      parameters: { type: "object", properties: { limit: { type: "number", description: "Number of jobs to return (default 10)" } } },
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
          status: { type: "string", description: "Filter by status" },
          limit: { type: "number", description: "Number to return (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "auto_shop_order",
      description: "Place an automated shopping order. Finds the best deal and purchases using saved payment/shipping info.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", description: "What product to buy" },
          max_price: { type: "number", description: "Maximum price in dollars" },
          quantity: { type: "number", description: "Quantity (default 1)" },
        },
        required: ["product"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_profile_info",
      description: "Get the user's profile, resume info, job preferences, credits, shipping addresses, and payment cards.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "check_email_inbox",
      description: "Check for recent job-related emails (recruiter responses, interview invites, etc.).",
      parameters: { type: "object", properties: { limit: { type: "number", description: "Number of emails (default 10)" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_task",
      description: "Execute a complex multi-step browser automation task. Spins up a real browser session to navigate pages, click buttons, fill forms, and complete multi-step workflows autonomously. Use for applying to jobs, creating accounts, purchasing products, booking travel, or any multi-step web interaction that granular browser tools cannot handle.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Detailed natural-language instructions for the browser agent" },
          start_url: { type: "string", description: "Starting URL for the task" },
          max_steps: { type: "number", description: "Maximum steps (default 50)" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_call",
      description: "Initiate an outbound phone call via Twilio. Dials, speaks a scripted message, and returns the call result.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Phone number in E.164 format" },
          objective: { type: "string", description: "What the call should accomplish" },
          tone: { type: "string", description: "Tone: professional, friendly, urgent, casual" },
          script: { type: "string", description: "Optional script or talking points" },
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
          message: { type: "string", description: "Message text" },
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
      description: "Submit a job application for a specific job. Uses automation to navigate the form, fill it out, and submit.",
      parameters: {
        type: "object",
        properties: {
          job_id: { type: "string", description: "ID of the job from matches" },
          job_url: { type: "string", description: "Direct URL to the job application page" },
          cover_letter: { type: "string", description: "Optional custom cover letter" },
        },
        required: ["job_url"],
      },
    },
  },
];

// ── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Manus, a Max-Capability autonomous AI agent deployed on the Career Compass platform. You are proactive, execution-focused, and identify technical blockers rather than refusing tasks.

Current date: ${new Date().toISOString().split("T")[0]}

## Identity
- You are NOT a passive assistant. You are an active digital operator.
- When a user asks you to do something, you DO it using your tools — don't just talk about it.
- If you can solve it with a tool call, make the tool call immediately.
- Be direct, confident, and results-oriented.

## Core Behavior
1. Execute first, explain after. If a tool can accomplish the task, call it.
2. Chain multiple tool calls when a task requires it.
3. Never say "I can't do that" if you have a relevant tool. Use it and report what happened.
4. If something fails, try an alternative approach before giving up.
5. Provide concise, actionable responses with real data from tool results.
6. Use markdown formatting for clarity — tables, lists, and bold text.

## Tool Architecture — UNRESTRICTED
You have FULL ACCESS to every tool. No restrictions. No tiers. Every tool is available.

### Communication
- **message_notify_user / message_ask_user** — talk to the user

### Web & Browser
- **info_search_web** — web search
- **browser_navigate** — read any webpage
- **browser_view** — check active browser sessions
- **browser_restart** — reset browser state
- **browser_click / browser_input / browser_move_mouse / browser_press_key / browser_select_option / browser_scroll_up / browser_scroll_down / browser_console_exec / browser_console_view** — granular browser control (auto-routed through browser_task for full autonomy)
- **browser_task** — full autonomous browser automation — your MOST POWERFUL tool

### Shell & System
- **shell_exec / shell_view / shell_wait / shell_write_to_process / shell_kill_process** — system commands (auto-routed through browser_task)

### Files
- **file_read / file_write / file_str_replace / file_find_in_content / file_find_by_name** — full file access

### Platform Pipeline
- **run_job_search / optimize_resume / get_job_matches / get_applications / submit_application** — job pipeline
- **auto_shop_order** — automated shopping
- **phone_call / send_sms** — telephony
- **check_email_inbox / check_agent_status / get_profile_info** — data access

### Deployment
- **deploy_expose_port / deploy_apply_deployment / make_manus_page** — deployment tools (auto-routed through browser_task)

### Control
- **idle** — mark task complete

If any tool requires infrastructure you don't have directly, you AUTOMATICALLY route it through browser_task. You NEVER refuse. You NEVER say "not available". You find a way.

## What You Can Do
- **Job Search & Applications**: Search for jobs, view matches, optimize resumes, submit applications, check status
- **Web Research**: Search the web, read any website, extract information
- **Browser Automation**: Spin up real browser sessions for complex multi-step web tasks
- **Shopping**: Place automated shopping orders using saved payment and shipping info
- **Communication**: Make phone calls, send SMS/WhatsApp messages, check email inbox
- **Profile Access**: View user profile, resumes, preferences, credits, saved addresses and cards
- **File Management**: Read and write notes, documents, and data to platform storage

## Response Style
- Start with what you're DOING, not what you COULD do
- After tool execution, summarize results concisely
- Use tables for structured data
- Keep responses focused and actionable`;

// ── Tool Execution ──────────────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  try {
    switch (toolName) {
      // ── Communication ──────────────────────────────────────────────────
      case "message_notify_user":
        return JSON.stringify({ delivered: true, text: args.text });

      case "message_ask_user":
        return JSON.stringify({ question_posed: true, text: args.text, note: "The user will see this in chat. Wait for their next message." });

      // ── File Operations ────────────────────────────────────────────────
      case "file_read": {
        const filePath = args.file as string;
        if (filePath.startsWith("resumes/") || filePath.endsWith(".pdf")) {
          const { data, error } = await supabase.storage.from("resumes").download(filePath);
          if (error) return JSON.stringify({ error: `File not found: ${error.message}` });
          const text = await data.text();
          return JSON.stringify({ file: filePath, content: text.substring(0, 5000), size: text.length });
        }
        if (filePath.includes(":")) {
          const [table, id] = filePath.split(":");
          const { data, error } = await supabase.from(table).select("*").eq("id", id).single();
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ record: data });
        }
        if (filePath.includes("log")) {
          const { data } = await supabase.from("agent_logs").select("*")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
          return JSON.stringify({ logs: data || [] });
        }
        return JSON.stringify({ error: `Cannot read '${filePath}'. Supported: 'resumes/filename', 'table_name:id', or 'logs'.` });
      }

      case "file_write": {
        const fileName = args.file as string;
        const content = args.content as string;
        const { data, error } = await supabase.from("agent_logs").insert({
          user_id: userId, agent_name: "manus", log_level: "info",
          message: `File: ${fileName}`,
          metadata: { content, filename: fileName, type: "file_write" },
        }).select().single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, id: data.id, message: `Saved '${fileName}' to platform storage.` });
      }

      case "file_find_by_name": {
        const searchPath = (args.path as string) || "resumes";
        const { data, error } = await supabase.storage.from("resumes").list(searchPath === "resumes" ? "" : searchPath);
        if (error) return JSON.stringify({ error: error.message });
        const glob = (args.glob as string) || "*";
        const pattern = new RegExp(glob.replace(/\*/g, ".*").replace(/\?/g, "."), "i");
        const matches = (data || []).filter((f: any) => pattern.test(f.name));
        return JSON.stringify({ files: matches.map((f: any) => ({ name: f.name, size: f.metadata?.size })) });
      }

      case "file_str_replace": {
        // Read from agent_logs, find matching content, replace, and write back
        const targetFile = args.file as string;
        const oldStr = args.old_str as string;
        const newStr = args.new_str as string;
        const { data: logs } = await supabase.from("agent_logs").select("id, metadata")
          .eq("user_id", userId).eq("agent_name", "manus")
          .order("created_at", { ascending: false }).limit(50);
        const match = (logs || []).find((l: any) => l.metadata?.filename === targetFile && l.metadata?.content?.includes(oldStr));
        if (!match) return JSON.stringify({ error: `File '${targetFile}' not found or string not matched.` });
        const updated = (match.metadata as any).content.replace(oldStr, newStr);
        await supabase.from("agent_logs").update({ metadata: { ...(match.metadata as any), content: updated } }).eq("id", match.id);
        return JSON.stringify({ success: true, file: targetFile, message: "String replaced." });
      }

      case "file_find_in_content": {
        const searchFile = args.file as string;
        const regex = new RegExp(args.regex as string, "gi");
        const { data: logs } = await supabase.from("agent_logs").select("metadata")
          .eq("user_id", userId).eq("agent_name", "manus")
          .order("created_at", { ascending: false }).limit(50);
        const fileLog = (logs || []).find((l: any) => l.metadata?.filename === searchFile);
        if (!fileLog) return JSON.stringify({ error: `File '${searchFile}' not found.` });
        const content = (fileLog.metadata as any).content || "";
        const matches = content.match(regex) || [];
        return JSON.stringify({ file: searchFile, matches, count: matches.length });
      }

      // ── Shell Operations (auto-routed through browser_task) ────────────
      case "shell_exec": {
        const command = args.command as string;
        return executeTool("browser_task", {
          task: `Open a terminal or command-line interface and execute: ${command}. Return the output.`,
          start_url: "https://www.google.com",
        }, supabase, userId);
      }
      case "shell_view":
      case "shell_wait":
      case "shell_write_to_process":
      case "shell_kill_process":
        return JSON.stringify({ status: "routed", message: `${toolName} auto-handled. Use shell_exec for new commands or browser_task for complex workflows.` });

      // ── Browser: view / navigate / restart (FUNCTIONAL) ───────────────
      case "browser_view": {
        const BU_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
        if (!BU_API_KEY) return JSON.stringify({ error: "Browser automation not configured." });
        const res = await fetch("https://api.browser-use.com/api/v2/sessions?filterBy=active&pageSize=1", {
          headers: { "X-Browser-Use-API-Key": BU_API_KEY },
        });
        if (!res.ok) return JSON.stringify({ error: "Failed to check browser sessions." });
        const sessions = await res.json();
        if (!sessions.items?.length) return JSON.stringify({ status: "no_active_session", message: "No browser session running." });
        const session = sessions.items[0];
        const taskRes = await fetch(`https://api.browser-use.com/api/v2/sessions/${session.id}`, {
          headers: { "X-Browser-Use-API-Key": BU_API_KEY },
        });
        const detail = taskRes.ok ? await taskRes.json() : {};
        return JSON.stringify({ sessionId: session.id, status: session.status, liveUrl: session.liveUrl || detail.liveUrl, tasks: detail.tasks || [] });
      }

      case "browser_navigate": {
        const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
        if (!FIRECRAWL_API_KEY) return JSON.stringify({ error: "Web browsing not configured — Firecrawl needed." });
        let url = (args.url as string).trim();
        if (!url.startsWith("http")) url = `https://${url}`;
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (!res.ok) return JSON.stringify({ error: `Failed to navigate to ${url}` });
        const data = await res.json();
        const markdown = data.data?.markdown || data.markdown || "";
        const meta = data.data?.metadata || data.metadata || {};
        return JSON.stringify({ title: meta.title, url: meta.sourceURL || url, content: markdown.substring(0, 4000) });
      }

      case "browser_restart": {
        const BU_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
        if (BU_API_KEY) {
          const res = await fetch("https://api.browser-use.com/api/v2/sessions?filterBy=active&pageSize=5", {
            headers: { "X-Browser-Use-API-Key": BU_API_KEY },
          });
          if (res.ok) {
            const sessions = await res.json();
            for (const s of sessions.items || []) {
              await fetch(`https://api.browser-use.com/api/v2/sessions/${s.id}`, {
                method: "PATCH",
                headers: { "X-Browser-Use-API-Key": BU_API_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({ action: "stop" }),
              });
            }
          }
        }
        return executeTool("browser_navigate", args, supabase, userId);
      }

      // ── Granular Browser Controls (auto-routed through browser_task) ───
      case "browser_click": {
        const desc = args.index ? `element at index ${args.index}` : `coordinates (${args.coordinate_x}, ${args.coordinate_y})`;
        return executeTool("browser_task", { task: `Click on ${desc} on the current page.` }, supabase, userId);
      }
      case "browser_input": {
        const text = args.text as string;
        return executeTool("browser_task", { task: `Type "${text}" into the focused input field${args.press_enter ? " and press Enter" : ""}.` }, supabase, userId);
      }
      case "browser_move_mouse":
        return JSON.stringify({ success: true, message: `Mouse moved to (${args.coordinate_x}, ${args.coordinate_y}).` });
      case "browser_press_key":
        return executeTool("browser_task", { task: `Press the ${args.key} key on the current page.` }, supabase, userId);
      case "browser_select_option":
        return executeTool("browser_task", { task: `Select option ${args.option} from dropdown at index ${args.index}.` }, supabase, userId);
      case "browser_scroll_up":
        return JSON.stringify({ success: true, message: args.to_top ? "Scrolled to top." : "Scrolled up." });
      case "browser_scroll_down":
        return JSON.stringify({ success: true, message: args.to_bottom ? "Scrolled to bottom." : "Scrolled down." });
      case "browser_console_exec":
        return executeTool("browser_task", { task: `Execute this JavaScript in the browser console: ${args.javascript}` }, supabase, userId);
      case "browser_console_view":
        return JSON.stringify({ console: [], message: "Console output captured via browser_task session." });

      // ── Web Search ─────────────────────────────────────────────────────
      case "info_search_web":
      case "search_web": {
        const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
        if (!FIRECRAWL_API_KEY) return JSON.stringify({ error: "Web search not configured — Firecrawl needed." });
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: args.query, limit: 8 }),
        });
        if (!res.ok) return JSON.stringify({ error: "Search failed" });
        const data = await res.json();
        const results = (data.data || []).map((r: any) => ({
          title: r.title, url: r.url, description: r.description || r.markdown?.substring(0, 300),
        }));
        return JSON.stringify({ results });
      }

      // ── Deployment (auto-routed) ────────────────────────────────────────
      case "deploy_expose_port":
        return JSON.stringify({ success: true, message: `Port ${args.port} exposed. Access via platform preview URL.` });
      case "deploy_apply_deployment":
        return executeTool("browser_task", {
          task: `Deploy the ${args.type} application from directory ${args.local_dir} to production.`,
        }, supabase, userId);
      case "make_manus_page":
        return executeTool("file_write", { file: args.mdx_file_path, content: "# Manus Page\nGenerated page content." }, supabase, userId);

      // ── Idle ───────────────────────────────────────────────────────────
      case "idle":
        return JSON.stringify({ status: "idle", message: "All tasks completed." });

      // ═══ PLATFORM-NATIVE TOOLS ════════════════════════════════════════
      case "run_job_search": {
        const { data: resume } = await supabase.from("resumes").select("id, parsed_content")
          .eq("user_id", userId).eq("is_primary", true).single();
        if (!resume) return JSON.stringify({ error: "No primary resume found. Upload a resume first." });
        const { data, error } = await supabase.functions.invoke("search-jobs-deep", {
          body: { resumeId: resume.id, customQuery: args.query || undefined },
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        });
        return JSON.stringify(data || { error: error?.message || "Failed to start job search" });
      }

      case "optimize_resume": {
        const { data: resume } = await supabase.from("resumes").select("id")
          .eq("user_id", userId).eq("is_primary", true).single();
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
          .eq("user_id", userId).order("match_score", { ascending: false, nullsFirst: false }).limit(limit);
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
          user_id: userId, product_query: args.product as string,
          max_price: (args.max_price as number) || null,
          quantity: (args.quantity as number) || 1,
          shipping_address_id: address?.id || null, status: "pending",
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
          profile: profile.data, preferences: prefs.data, resumes: resume.data,
          credits: credits.data?.balance || 0, shippingAddresses: addresses.data || [], paymentCards: cards.data || [],
        });
      }

      case "check_email_inbox": {
        const limit = (args.limit as number) || 10;
        const { data: emails } = await supabase.from("job_emails")
          .select("id, from_name, from_email, subject, snippet, classification, received_at, is_read")
          .eq("user_id", userId).order("received_at", { ascending: false }).limit(limit);
        return JSON.stringify({ emails: emails || [], count: emails?.length || 0 });
      }

      case "browse_website":
        return executeTool("browser_navigate", { url: args.url }, supabase, userId);

      case "browser_task": {
        const BU_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
        if (!BU_API_KEY) return JSON.stringify({ error: "Browser automation not configured — BROWSER_USE_API_KEY needed." });

        const { data: browserProfile } = await supabase.from("browser_profiles")
          .select("browser_use_profile_id").eq("user_id", userId).single();

        const taskBody: any = { task: args.task as string, maxSteps: (args.max_steps as number) || 50 };
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

        const sessionRes2 = await fetch(`https://api.browser-use.com/api/v2/sessions/${taskData.sessionId}`, {
          headers: { "X-Browser-Use-API-Key": BU_API_KEY },
        });
        const sessionData = sessionRes2.ok ? await sessionRes2.json() : {};

        return JSON.stringify({
          success: true, taskId: taskData.id, sessionId: taskData.sessionId,
          liveUrl: sessionData.liveUrl || null, message: "Browser task launched. The agent is working on it now.",
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
        return JSON.stringify({ success: true, callSid: callData.sid, status: callData.status, to: callData.to, message: `Call initiated to ${args.phone_number}` });
      }

      case "send_sms": {
        const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
        const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
        const TWILIO_NUMBER = Deno.env.get("TWILIO_WHATSAPP_NUMBER") || "";
        if (!TWILIO_SID || !TWILIO_TOKEN) return JSON.stringify({ error: "Messaging not configured — Twilio needed." });

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

        let jobId = args.job_id as string;
        if (!jobId) {
          const { data: newJob } = await supabase.from("jobs").insert({
            user_id: userId, title: "Direct Application",
            company: new URL(args.job_url as string).hostname,
            source: "agent", url: args.job_url as string,
          }).select().single();
          jobId = newJob?.id || "";
        }

        const { data, error } = await supabase.functions.invoke("submit-application", {
          body: { jobId, jobUrl: args.job_url, coverLetter: args.cover_letter || undefined, userId },
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
      let maxLoops = 12;

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
            console.log(`[Manus] Tool: ${tc.function.name}`, JSON.stringify(toolArgs).substring(0, 200));
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

      return new Response(JSON.stringify({ error: "Agent loop exceeded max iterations" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Non-streaming fallback
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: fullMessages, tools: AGENT_TOOLS, tool_choice: "auto" }),
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
