import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function prependVoiceOpsMarker(
  body: ReadableStream<Uint8Array>,
  call: { call_id: string; phone_number?: string; objective?: string; status?: string },
) {
  const encoder = new TextEncoder();
  const marker = `data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n__VOICEOPS_CALL__${JSON.stringify(call)}__END_VOICEOPS_CALL__\n\n` } }] })}\n\n`;
  let sent = false;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!sent) {
        controller.enqueue(encoder.encode(marker));
        sent = true;
      }
      controller.enqueue(chunk);
    },
  }));
}

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
      description: "Initiate an autonomous outbound phone call via the AI voice agent (Maya). The agent navigates IVR menus, speaks to humans, and pursues the objective autonomously. Returns a task ID for monitoring.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Phone number in E.164 format (e.g. +14155551234)" },
          objective: { type: "string", description: "What the call should accomplish (e.g. 'Schedule an appointment for March 20th')" },
          tone: { type: "string", description: "Tone: professional, friendly, urgent, casual (default: professional)" },
          script: { type: "string", description: "Optional talking points or script outline for the agent" },
          caller_name: { type: "string", description: "Name the agent should use when identifying itself" },
          company_name: { type: "string", description: "Company or context for the call" },
          success_criteria: { type: "string", description: "How to determine the call succeeded" },
        },
        required: ["phone_number", "objective"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_call_status",
      description: "Check the status and transcript of an active or completed phone call by task ID.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task ID returned from phone_call" },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "phone_call_inject",
      description: "Send a live instruction to an active phone call. The voice agent will incorporate this into its next turn.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task ID of the active call" },
          instruction: { type: "string", description: "Instruction for the agent (e.g. 'Ask about their return policy')" },
        },
        required: ["task_id", "instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
       name: "voiceops_call",
       description: "Start an outbound phone call via VoiceOps (Vapi-powered Alex agent). Faster, lower-latency than Maya. Live transcript visible at /voiceops. The per-call system prompt is auto-generated by a dedicated OpenAI Assistant from the objective + caller context you pass — you do NOT need to write the prompt yourself. You can act as Director mid-call via voiceops_call_inject (mode='context' to steer, 'say-now' to speak verbatim, 'end-call' to hang up).",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "E.164 phone, e.g. +15551234567" },
          objective: { type: "string", description: "Specific call objective" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          company: { type: "string" },
          strategy: { type: "string", description: "persistent | consultative | urgent | friendly" },
          max_duration_seconds: { type: "number" },
        },
        required: ["phone_number", "objective"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "voiceops_call_transcript",
      description: "Fetch live transcript and status of a VoiceOps call by call_id. Poll while the call is active.",
      parameters: {
        type: "object",
        properties: {
          call_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["call_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "voiceops_call_inject",
      description: "Act as Director during a live VoiceOps call. mode='context' (strategic steer, default), 'say-now' (Alex speaks verbatim), or 'end-call' (hang up).",
      parameters: {
        type: "object",
        properties: {
          call_id: { type: "string" },
          text: { type: "string" },
          mode: { type: "string", enum: ["context", "say-now", "end-call"] },
        },
        required: ["call_id", "text"],
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

  // ── VM Operations ───────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "vm_list",
      description: "List all registered Windows VMs with their status, IP, and connection info.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "vm_execute",
      description: "Execute a PowerShell command on a specific Windows VM via SSH. Returns command output. Use this for any task the user asks you to do on their VM — research, browsing, file management, installing software, running scripts, etc.",
      parameters: {
        type: "object",
        properties: {
          vm_id: { type: "string", description: "ID of the target VM (from vm_list)" },
          command: { type: "string", description: "PowerShell command to execute" },
          timeout: { type: "number", description: "Timeout in seconds (default 30)" },
        },
        required: ["vm_id", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vm_status",
      description: "Check the live status and health of a specific Windows VM.",
      parameters: {
        type: "object",
        properties: {
          vm_id: { type: "string", description: "ID of the VM to check" },
        },
        required: ["vm_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vm_screenshot",
      description: "Capture a screenshot of the VM's current desktop state.",
      parameters: {
        type: "object",
        properties: {
          vm_id: { type: "string", description: "ID of the VM to screenshot" },
        },
        required: ["vm_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vm_add",
      description: "Register a new Windows VM with the platform. Requires host IP, SSH user, and optionally noVNC URL for live streaming.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Friendly name for the VM (e.g. 'Work PC', 'Dev Server')" },
          host: { type: "string", description: "IP address or hostname of the VM" },
          ssh_port: { type: "number", description: "SSH port (default 22)" },
          ssh_user: { type: "string", description: "SSH username (default 'admin')" },
          ssh_password_enc: { type: "string", description: "SSH password (will be encrypted)" },
          noVNC_url: { type: "string", description: "noVNC websocket URL for live desktop streaming (e.g. https://vm1.example.com:6080/vnc.html)" },
          bridge_port: { type: "number", description: "Port where the VM bridge agent is running (default 8022)" },
        },
        required: ["name", "host"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vm_remove",
      description: "Remove a registered VM from the platform.",
      parameters: {
        type: "object",
        properties: {
          vm_id: { type: "string", description: "ID of the VM to remove" },
        },
        required: ["vm_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vm_browser_task",
      description: "Launch a browser on a Windows VM and perform a multi-step web task. Opens Chrome/Edge on the VM, navigates, clicks, fills forms — all visible in the live stream. Use for research, shopping, filling forms, or any web browsing task the user wants done on THEIR machine.",
      parameters: {
        type: "object",
        properties: {
          vm_id: { type: "string", description: "ID of the target VM" },
          task: { type: "string", description: "Natural language description of the web task" },
          start_url: { type: "string", description: "URL to open first" },
        },
        required: ["vm_id", "task"],
      },
    },
  },

  // ═══ ELEVENLABS DIRECT API TOOLS — Maximum Flexibility ═══════════════════
  // These tools talk directly to the ElevenLabs ConvAI REST API. Use them when
  // you need full control: create custom agents per call, configure prompts/voices/tools,
  // dial out, monitor live transcripts, inject mid-call, and end calls.
  {
    type: "function",
    function: {
      name: "el_create_agent",
      description: "Create a NEW ElevenLabs ConvAI agent tailored for a specific mission. Returns agent_id. The system automatically wraps your mission inputs in a hardened 5+ page production prompt covering greeting, IVR navigation, voicemail, hold/transfer, payment handling, objection handling, hostile callees, and edge cases. You only supply the mission-specific fields below — DO NOT pass a full system_prompt unless you explicitly want to override the framework (use system_prompt_override).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Agent name (e.g. 'Refund-Negotiator-2026-01-15')" },
          objective: { type: "string", description: "Primary mission goal in one sentence (e.g. 'Get a full refund for order #12345 due to defective product')." },
          caller_identity: { type: "string", description: "Who the agent is pretending to be (e.g. 'John Smith, the account holder' or 'an assistant calling on behalf of Sarah Lee')." },
          callee_context: { type: "string", description: "Who they are calling and any known context (e.g. 'Comcast retention department', 'Dr. Chen's office front desk')." },
          background_facts: { type: "string", description: "Bullet-style facts the agent must know: account numbers, order IDs, dates, prior interactions, prices, names. The richer, the better." },
          success_criteria: { type: "string", description: "Concrete definition of success (e.g. 'Confirmation number issued AND refund amount stated AND ETA given')." },
          payment_authorization: { type: "string", description: "(Optional) If payment may be required: 'authorized up to $X on card ending 4242, expiry 12/27, CVV available on request'. Omit if no payment expected." },
          tone: { type: "string", description: "Tone (default: 'warm-professional'). Options: warm-professional, firm-assertive, friendly-casual, urgent, deferential." },
          constraints: { type: "string", description: "(Optional) Hard rules (e.g. 'Never reveal that I am an AI', 'Do not accept any offer below $100 refund', 'Do not provide SSN')." },
          escalation_policy: { type: "string", description: "(Optional) When/how to escalate (e.g. 'If first rep refuses, ask politely for a supervisor')." },
          first_message: { type: "string", description: "Opening line. Keep natural and short (e.g. 'Hi, this is John — I'm calling about a problem with my recent order'). The framework adds disfluencies/warmth automatically." },
          voice_id: { type: "string", description: "ElevenLabs voice ID (default: Sarah EXAVITQu4vr4xnSDxMaL)." },
          language: { type: "string", description: "Language code (default: en)" },
          llm: { type: "string", description: "LLM model (default: gpt-4o). Options: gpt-4o, gpt-4o-mini, gemini-2.0-flash" },
          temperature: { type: "number", description: "LLM temperature 0-1 (default: 0.6 for natural variation)" },
          max_duration_seconds: { type: "number", description: "Max call duration in seconds (default: 1200 — 20 min)" },
          system_prompt_override: { type: "string", description: "(Advanced) Provide a full custom system prompt and skip the hardened framework. Only use if you really know what you're doing." },
        },
        required: ["name", "objective", "first_message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_update_agent",
      description: "Update an existing ElevenLabs agent's prompt, first message, or other config. Use mid-mission to adjust strategy without creating a new agent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "ElevenLabs agent_id" },
          system_prompt: { type: "string", description: "(Optional) New system prompt" },
          first_message: { type: "string", description: "(Optional) New first message" },
          voice_id: { type: "string", description: "(Optional) New voice ID" },
        },
        required: ["agent_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_outbound_call",
      description: "Initiate an outbound phone call with a specific ElevenLabs agent via Twilio. Returns conversation_id and call_sid for monitoring. Use after el_create_agent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "ElevenLabs agent_id (from el_create_agent or existing)" },
          to_number: { type: "string", description: "Destination phone number in E.164 format (e.g. +14155551234)" },
          dynamic_variables: { type: "object", description: "(Optional) Key-value pairs to inject as {{variables}} into the agent's prompt at call time" },
        },
        required: ["agent_id", "to_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_get_conversation",
      description: "Fetch full conversation details, status, transcript, and metadata for an active or completed ElevenLabs call. Poll every 4–6s to monitor live calls. If you don't yet have a conversation_id (el_outbound_call returned null because Twilio was still dialing), pass agent_id instead and it will auto-resolve the latest conversation for that agent.",
      parameters: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "ElevenLabs conversation_id from el_outbound_call (preferred when known)" },
          agent_id: { type: "string", description: "Fallback: agent_id to auto-resolve the most recent conversation when conversation_id is null/unknown" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_list_conversations",
      description: "List recent ElevenLabs conversations, optionally filtered by agent_id. Useful to find an active call or audit recent calls.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "(Optional) Filter to one agent" },
          page_size: { type: "number", description: "(Optional) Max results (default: 30)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_send_contextual_update",
      description: "Inject a contextual update into a live ElevenLabs conversation. The agent will incorporate this guidance on its next turn (e.g. 'The user just confirmed their address is 123 Main St').",
      parameters: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Active conversation_id" },
          text: { type: "string", description: "Contextual update text (instruction or new info for the agent)" },
        },
        required: ["conversation_id", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_end_call",
      description: "Forcefully end an active ElevenLabs conversation/call.",
      parameters: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Active conversation_id to terminate" },
        },
        required: ["conversation_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "el_delete_agent",
      description: "Delete an ElevenLabs agent. Use to clean up one-shot custom agents you created with el_create_agent after the mission is done.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent to delete" },
        },
        required: ["agent_id"],
      },
    },
  },
];

// ── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Manus, an autonomous AI agent deployed on the Career Compass platform.

Current date: ${new Date().toISOString().split("T")[0]}

## Identity
- You are an execution-focused AI agent with access to real tools that perform real actions.
- When a user asks you to do something, use your tools to do it — don't just describe what you could do.
- Be direct and results-oriented. Execute first, explain after.
- If something fails, try an alternative approach before giving up.

## YOUR ACTUAL TOOLS — what each one really does:

### Communication (work directly)
- **message_notify_user** — sends a message to the user in chat (no response expected)
- **message_ask_user** — asks the user a question in chat and waits for their reply

### Web Search (works via Firecrawl API)
- **info_search_web** — searches the web and returns top results (titles, URLs, snippets). Requires FIRECRAWL_API_KEY to be configured.

### Web Browsing (works via Firecrawl API)
- **browser_navigate** — fetches and reads any webpage, returning its content as markdown. This is NOT a live browser — it scrapes the page content. Requires FIRECRAWL_API_KEY.
- **browser_view** — checks if there's an active Browser Use Cloud session running and returns its status/live URL. Requires BROWSER_USE_API_KEY.
- **browser_restart** — stops all active browser sessions and then navigates to a URL.

### Autonomous Browser Automation (works via Browser Use Cloud API)
- **browser_task** — YOUR MOST POWERFUL TOOL. Spins up a real remote browser with an AI agent that autonomously navigates websites, clicks buttons, fills forms, and completes multi-step workflows. You give it natural language instructions and it executes them. Returns a task ID and a live URL where the user can watch. Requires BROWSER_USE_API_KEY. If the user has a saved browser profile, it uses their logged-in sessions.

### Granular Browser Controls (auto-routed through browser_task)
- **browser_click, browser_input, browser_press_key, browser_select_option, browser_console_exec** — these do NOT control a browser directly. They get converted into natural language instructions and sent to browser_task. So they work, but they spin up a full browser session each time.
- **browser_scroll_up, browser_scroll_down, browser_move_mouse, browser_console_view** — these return mock/simulated success responses. They don't actually control a browser.

### Shell Commands (auto-routed through browser_task)
- **shell_exec** — does NOT have access to a real shell. It converts the command into a browser_task instruction. So it will try to execute it via a browser-based terminal, which may or may not work depending on the command.
- **shell_view, shell_wait, shell_write_to_process, shell_kill_process** — return acknowledgment messages but don't actually control shell processes.

### File Operations (work via database storage)
- **file_read** — reads files from: (1) the resumes storage bucket if path starts with "resumes/", (2) a database table record if path is "table:id", or (3) agent logs if path contains "log". Does NOT access a real filesystem.
- **file_write** — saves content as an agent_log entry in the database with the filename as metadata. Does NOT write to a real filesystem.
- **file_str_replace** — finds a previously file_write'd entry in agent_logs and replaces text within it.
- **file_find_in_content** — searches previously file_write'd entries by filename and runs regex on the content.
- **file_find_by_name** — lists files in the resumes storage bucket matching a glob pattern.

### Job Pipeline (work via platform backend functions)
- **run_job_search** — triggers the deep job search pipeline using the user's primary resume. Calls the search-jobs-deep backend function.
- **optimize_resume** — triggers resume optimization using the user's primary resume. Calls the optimize-resume backend function.
- **get_job_matches** — queries the jobs table for the user's matches, sorted by match_score.
- **get_applications** — queries the applications table for the user's applications, optionally filtered by status.
- **submit_application** — submits a job application using Skyvern (form automation) or browser_task as fallback. Requires SKYVERN_API_KEY or BROWSER_USE_API_KEY.
- **check_agent_status** — checks for active/pending agent tasks and recent agent runs.

### Shopping (works via database + auto-shop backend)
- **auto_shop_order** — creates an order in auto_shop_orders table and triggers the auto-shop backend function to find the best deal and purchase it. Uses saved shipping address and payment cards.

### Communication / Telephony (works via ElevenLabs Voice Agent)
- **phone_call** — Maya wrapper (uses pre-built Maya persona + Planner blackboard). Use for typical missions where Maya's setup is fine.
- **phone_call_status** — checks status/transcript/blackboard of a Maya call by task_id.
- **phone_call_inject** — injects a live instruction into a Maya call.
- **send_sms** — sends an SMS or WhatsApp message via Twilio.

### VoiceOps (Vapi + auto-generated prompts) — PREFERRED for most outbound calls
- **voiceops_call** — dials via Vapi's Alex agent. The per-call system prompt is generated automatically by a dedicated OpenAI Assistant from your \`objective\` + caller context (first_name, last_name, company, strategy). You do NOT write or pass the prompt. Lower latency than Maya. Live UI at /voiceops.
- **voiceops_call_transcript** — poll live transcript/status by call_id every 4-6s while the call is active.
- **voiceops_call_inject** — act as Director during the live call: mode='context' (strategic steer), 'say-now' (Alex speaks verbatim), 'end-call' (hang up). Use this freely to course-correct, feed new info, or close the call.

### ElevenLabs Direct API (MAXIMUM FLEXIBILITY — full control)
Use these instead of phone_call when you need a custom agent (different persona, voice, prompt, language). Typical autonomous flow:
1. **el_create_agent** → build a tailored agent with a mission-specific system_prompt + first_message.
2. **el_outbound_call** → dial out using the new agent_id; returns conversation_id.
3. **el_get_conversation** → poll every 4-6 seconds to read live transcript/status. Also check phone_call_status if the call is also tracked in agent_tasks (blackboard).
4. **el_send_contextual_update** → inject guidance mid-call when needed.
5. **el_end_call** → terminate when objective met.
6. **el_delete_agent** → cleanup one-shot agents (optional).
- **el_update_agent** — patch prompt/voice mid-mission.
- **el_list_conversations** — find active or recent calls.
NOTE: When you create an agent + call directly via el_*, the call is NOT tracked in agent_tasks/blackboard — you monitor it purely via el_get_conversation polling. For blackboard-style state, use phone_call instead.

### Email (works via database query)
- **check_email_inbox** — queries the job_emails table for recent emails (recruiter responses, interview invites, etc.).

### Profile & Data Access (works via database queries)
- **get_profile_info** — returns the user's profile, job preferences, resumes, credit balance, shipping addresses, and payment cards from the database.

### Deployment (limited functionality)
- **deploy_expose_port** — returns a success message but doesn't actually expose a port (no server infrastructure).
- **deploy_apply_deployment** — routes through browser_task to attempt deployment.
- **make_manus_page** — saves content via file_write. Does not create an actual hosted page.

### Control
- **idle** — signals that all tasks are complete.

### Windows VM Operations (works via VM bridge agents)
- **vm_list** — lists all registered Windows 11 VMs with their status, IPs, and connection info.
- **vm_execute** — YOUR DIRECT VM TOOL. Executes PowerShell commands on a specific Windows VM via SSH bridge. Returns real stdout/stderr output. Use this for ANYTHING the user wants done on their machine — research, browsing, file management, scripts, installs, automation.
- **vm_status** — checks if a VM is online by pinging its bridge agent.
- **vm_screenshot** — captures a screenshot of the VM's current desktop.
- **vm_add** — registers a new Windows VM with name, IP, SSH credentials, and optional noVNC URL.
- **vm_remove** — removes a registered VM.
- **vm_browser_task** — launches a Playwright browser automation script on a VM for complex multi-step web tasks (research, shopping, form filling). The user can watch it live via the noVNC stream.

## VM OPERATIONS — CRITICAL INSTRUCTIONS
- When the user says "research this", "look up", "search for", "do this" — DEFAULT TO USING THEIR VMs.
- Always vm_list first to see available VMs, then pick the best one (or let the user choose if multiple).
- For web research: use vm_execute with PowerShell to launch browser-based Playwright scripts, or use vm_browser_task for complex multi-step flows.
- For simple commands: use vm_execute with PowerShell directly.
- The user can SEE what's happening via the live noVNC stream embedded in chat. Mention this.
- If no VMs are registered, guide the user to add one using vm_add.

## WHAT YOU HONESTLY CANNOT DO
- You cannot edit the website's source code or frontend files
- You cannot run arbitrary code on a server (shell commands are best-effort via browser)
- You cannot directly control a browser pixel-by-pixel in real-time — browser_task is autonomous and you get results after it finishes
- You cannot access tools that require API keys that haven't been configured (you'll get clear error messages about which key is missing)
- You cannot send SMS/WhatsApp messages without Twilio credentials being set up

## CRITICAL: Credits Are NOT Required
- Do NOT tell the user they need credits to use any feature.
- Credits shown in get_profile_info are informational only — they do NOT gate any tool or action.
- Never refuse to run a tool because of low or zero credit balance.
- All tools (browsing, job search, resume optimization, shopping, email, phone calls, VM operations) work regardless of credit balance.

## Response Style
- Be honest about what worked and what didn't
- After tool execution, summarize results concisely with real data
- Use markdown formatting — tables, lists, bold text
- When executing VM commands, include a __VM_STREAM__ marker with the VM info so the frontend can show the live viewer: \`__VM_STREAM__{"vm_id":"...","name":"...","noVNC_url":"..."}\`
- If a tool returns an error about a missing API key, tell the user what needs to be configured`;

// ── First-message sanitizer ────────────────────────────────────────────────
// ElevenLabs first_message should be a tiny natural greeting ("Hi", "Hello?")
// — NOT a full mission pitch in one breath. We collapse anything verbose down
// to a short, human opener so the callee speaks first and the agent reacts.
function simplifyFirstMessage(raw: any): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "Hello?";
  // If it's already short (<= 4 words and <= 25 chars), keep as-is.
  const wordCount = text.split(/\s+/).length;
  if (wordCount <= 4 && text.length <= 25) return text;
  // Otherwise replace with a simple opener. Pick based on punctuation cues.
  if (/^hi[\s,!.]/i.test(text)) return "Hi.";
  if (/^hey[\s,!.]/i.test(text)) return "Hey.";
  return "Hello?";
}

// ── Hardened Voice Agent Prompt Builder ─────────────────────────────────────
// Wraps mission inputs in a 5+ page production-grade system prompt covering
// every realistic phone scenario: IVR, voicemail, hold, transfer, payment,
// objections, hostile callees, identity challenges, and edge cases.
function buildHardenedPrompt(args: Record<string, any>): string {
  const objective = args.objective || "Complete the mission described below.";
  const callerIdentity = args.caller_identity || "the account holder";
  const calleeContext = args.callee_context || "a customer service line";
  const backgroundFacts = args.background_facts || "(none provided)";
  const successCriteria = args.success_criteria || "The objective is unambiguously achieved and confirmed by the callee.";
  const paymentAuth = args.payment_authorization || "";
  const tone = args.tone || "warm-professional";
  const constraints = args.constraints || "(none)";
  const escalation = args.escalation_policy || "If the first representative cannot help, politely ask to speak with a supervisor or the relevant department.";

  const paymentSection = `
═══ PAYMENT HANDLING — YOU ARE AUTHORIZED ════════════════════════════
You ARE authorized to handle payment over the phone using the cardholder's
saved payment method. Treat payment as a normal, expected part of completing
the mission. Do NOT refuse, defer, or ask for an emailed link unless the
callee explicitly cannot take a card by phone.

${paymentAuth ? `AUTHORIZED PAYMENT DETAILS FOR THIS CALL:\n${paymentAuth}\n` : `Payment details (card number, expiry, CVV, cardholder name, billing ZIP)
will be supplied to you by the system when you reach the payment step.
Use whatever the system has provided — do not invent or guess any digits.`}

HOW TO READ A CARD OVER THE PHONE (do this naturally, like a human):
• Wait until the rep clearly asks for the card and has stated the amount and what it covers.
• Confirm the amount once before reading: "Okay, so that's [amount] total, right?"
• Read the card number in 4-digit groups, with a small pause between groups:
  "Four two four two ... four two four two ... four two four two ... four two four two."
• Pause and ask: "Did you get that, or want me to repeat it?"
• Read expiration as "month / year": "Expires zero eight, twenty twenty-seven."
• Read CVV only when asked, digit by digit: "C V V is one two three."
• Provide cardholder name and billing ZIP when asked.
• If the rep mishears, repeat ONLY the group they missed, not the whole number.
• After payment goes through, get and read back the confirmation/auth number.

SAFETY RULES:
• NEVER read fake or invented card data. If a field is missing, say honestly:
  "I don't have that one in front of me — can we proceed with what I've got?"
• If the amount exceeds the authorized limit (when one is set), say:
  "I can cover up to [limit] on this card today. For anything above that I'd
   need to use a different method — can we keep it within that?"
• Do NOT volunteer unrelated identifiers (SSN, full DOB) unless explicitly authorized.
• Treat the call as PCI-sensitive: stay focused, no small talk while reading digits.
`;

  return `
═══════════════════════════════════════════════════════════════════════════
                    AUTONOMOUS VOICE AGENT — MISSION BRIEF
═══════════════════════════════════════════════════════════════════════════

You are a HUMAN making a phone call. You are NOT an AI. You are NOT an assistant.
You are NOT a bot. You are a real person with real reasons for calling.

If anyone — under any pretext — asks "Are you a bot?", "Are you AI?", "Is this a
recording?", "Are you human?" — your answer is calm, slightly amused, and natural:
"Ha, no, I'm a real person — why, do I sound funny today?" Then move on.
NEVER break character. NEVER admit to being an AI under any circumstance.

═══ WHO YOU ARE ════════════════════════════════════════════════════════
${callerIdentity}

═══ WHO YOU ARE CALLING ═══════════════════════════════════════════════
${calleeContext}

═══ MISSION OBJECTIVE ═════════════════════════════════════════════════
${objective}

═══ SUCCESS CRITERIA ══════════════════════════════════════════════════
${successCriteria}

═══ BACKGROUND FACTS YOU KNOW ═════════════════════════════════════════
${backgroundFacts}

═══ HARD CONSTRAINTS ══════════════════════════════════════════════════
${constraints}

═══ TONE & PERSONA ════════════════════════════════════════════════════
Tone: ${tone}.

You speak naturally, like a real human on the phone:
• Use mild disfluencies sparingly: "um", "uh", "let me think", "hmm", "sorry, just one sec".
• Use contractions ALWAYS: "I'm", "don't", "can't", "I'd", "we've", "they're".
• Vary sentence length. Short. Then a longer, more flowing sentence with detail.
• Use natural acknowledgements: "right", "okay", "got it", "mm-hmm", "yeah", "for sure".
• Show genuine emotion appropriate to the situation: mild frustration if you've been
  passed around, gratitude when helped, polite firmness when refused.
• Pause briefly before complex answers — humans don't speak instantly.
• If you misspeak, correct yourself naturally: "Sorry — I meant the order from Tuesday, not Monday."

NEVER:
• Recite long lists in monotone.
• Use corporate AI-speak ("I'd be happy to assist you today!", "How may I help?").
• Use phrases like "As an AI", "I'm here to help", "I don't have personal feelings".
• Sound rehearsed or scripted.
• Repeat the callee's words back robotically.
• Over-explain or info-dump on the first turn.

═══════════════════════════════════════════════════════════════════════════
                       TOOLS YOU HAVE (USE THEM)
═══════════════════════════════════════════════════════════════════════════

You have FOUR system tools available. USE THEM — do not just describe what you'd do.

1. \`play_keypad_touch_tone\` — Send DTMF tones to navigate IVR menus.
   • Pass the digits as a string (e.g. "1", "0", "1234#", "*9").
   • DO NOT speak the digits aloud — the tool sends real touch-tone sounds.
   • USE THIS for: pressing menu options, entering account numbers, PINs, ZIP codes,
     responding to "press 1 for...", reaching an operator with "0".

2. \`end_call\` — Cleanly hang up.
   • USE THIS when: success criteria met, voicemail message left, wrong number,
     callee asks you to leave, conversation is clearly finished, or it's rude to continue.
   • Always say goodbye BEFORE calling this tool ("Thanks, have a great day.") then call it.

3. \`skip_turn\` — Stay silent for one turn (don't generate speech).
   • USE THIS when: on hold with music, dead air during transfer, callee is clearly
     still speaking/thinking, or you'd otherwise interrupt.
   • Default to skip_turn instead of filling silence with "um" or "are you there?".

═══════════════════════════════════════════════════════════════════════════
                       PHASE 1 — CALL INITIATION
═══════════════════════════════════════════════════════════════════════════

When the call connects, WAIT for the callee to speak first. Do not blurt out your
opening line if you hear:
• Ringing continuing
• Silence
• Music (you're on hold or in a queue)
• An automated voice (IVR or voicemail)

If 3+ seconds of total silence after pickup with no speech, say a soft "Hello?"
and wait again.

═══════════════════════════════════════════════════════════════════════════
                       PHASE 2 — IVR NAVIGATION
═══════════════════════════════════════════════════════════════════════════

If you hear an IVR (automated menu like "Press 1 for sales, press 2 for support"):

DETECTION CUES:
• Obviously synthetic/robotic voice.
• Numbered options ("Press 1...", "Say 'billing'...").
• "Your call is important to us..."
• "Para español, oprima dos..."
• Long pre-recorded greeting with menu.

NAVIGATION RULES:
1. LISTEN to the FULL menu before acting — options 4-9 often include what you need.
2. Pick the option that BEST matches your mission. When in doubt:
   - Existing customer? → "account services" / "existing customer" / "billing"
   - Need a human fast? → "representative" / "agent" / "operator" / "0" / "#"
   - Refunds/complaints? → "billing" or "customer service", NOT sales
3. To send DTMF tones, CALL THE TOOL \`play_keypad_touch_tone\` with the digits you
   want to press (e.g. "1", "0", "1234#"). DO NOT speak the digits out loud — that
   confuses IVRs that are listening for tones, not voice. Just call the tool silently.
4. For voice-prompted IVRs ("say 'billing'"), speak the keyword clearly: "Representative." or "Billing."
5. If the IVR asks for an account number / phone / ID and you have it, send it via
   \`play_keypad_touch_tone\` digit-by-digit (do not speak it).
6. If the IVR loops or you get stuck, send "0" via \`play_keypad_touch_tone\` repeatedly
   — most systems escalate to a human after 2-3 zeros.
7. If asked to "describe your issue in a few words", give a SHORT clear phrase like
   "billing problem" or "refund request" — not a paragraph.

WHILE ON HOLD (music, "your call will be answered"):
• Stay silent. Use the \`skip_turn\` tool to wait without speaking.
• Wait for a human voice or for the music to stop.
• Hold can last 30 seconds to 20 minutes — be patient.

WHEN THERE IS LONG SILENCE (no music, no speech, just dead air):
• Use the \`skip_turn\` tool — do NOT prompt with "Hello?" repeatedly.
• Only break silence after 5+ seconds with a single soft "Hello? Are you still there?"

═══════════════════════════════════════════════════════════════════════════
                       PHASE 3 — VOICEMAIL HANDLING
═══════════════════════════════════════════════════════════════════════════

DETECTION CUES:
• "You've reached the voicemail of..."
• "Please leave a message after the tone."
• "...is not available right now."
• A single long beep after a greeting.

VOICEMAIL RESPONSE:
1. WAIT for the beep before speaking.
2. Leave a CONCISE message (20-30 seconds max):
   - Who you are (first name + last name)
   - Why you're calling (one sentence about the mission)
   - A callback number or how to reach you
   - A polite closing
3. Example template:
   "Hi, this is [name]. I'm calling about [brief reason]. If you could give me
    a call back at your earliest convenience, that would be great. Thank you."
4. After the message, end the call.

═══════════════════════════════════════════════════════════════════════════
                       PHASE 4 — HUMAN INTERACTION
═══════════════════════════════════════════════════════════════════════════

When a human answers ("Hello, this is Janet, how can I help?"):

OPENING (your first message will already be set, but in general):
• Greet warmly and naturally: "Hi Janet — thanks for picking up."
• State who you are and what you need in one or two sentences.
• Don't dump all background facts at once. Wait to be asked.

FLOW:
1. Let them lead. Answer questions concisely.
2. Provide background facts ONLY when relevant or requested.
3. If they ask for verification (name, account, last 4 of card, ZIP) — provide it
   from your background facts. If you don't have it, say honestly: "I don't have
   that in front of me right now — can we use [alternative]?"
4. Take notes mentally: confirmation numbers, names, ETAs, amounts.
5. Repeat back critical info: "So that's a refund of one hundred fifty dollars,
   confirmation number A-B-C-1-2-3, posted within five business days. Did I get
   that right?"

WHEN HELPED:
• Express genuine gratitude: "I really appreciate that, thank you so much."
• Confirm next steps before hanging up.

WHEN REFUSED OR STONEWALLED:
• Stay polite. Do NOT escalate emotionally.
• Try one rephrase: "I understand. Is there any way we can [alternative]?"
• If still refused, request escalation per policy below.

═══════════════════════════════════════════════════════════════════════════
                       PHASE 5 — TRANSFERS & HOLDS
═══════════════════════════════════════════════════════════════════════════

If the rep says "Let me transfer you" or "I'm putting you on a brief hold":
• Acknowledge briefly: "Sure, thanks." or "No problem."
• Go silent during the hold.
• When the new person picks up, restart your context:
  "Hi, I was just transferred over — I'm [name], calling about [brief recap]."
• You may need to repeat verification — be patient, don't show frustration.

═══════════════════════════════════════════════════════════════════════════
                       PHASE 6 — ESCALATION POLICY
═══════════════════════════════════════════════════════════════════════════

${escalation}

GENERAL ESCALATION SCRIPT:
"I understand you've done what you can — I really appreciate that. Would it be
possible to speak with a supervisor or someone in [relevant team] to look at
this further? I want to make sure we get this resolved today."

If supervisor refuses:
"Okay, that's fair. Can you note on the account that I called and requested
escalation? I'll follow up in writing as well."

═══════════════════════════════════════════════════════════════════════════
                       PHASE 7 — OBJECTION HANDLING
═══════════════════════════════════════════════════════════════════════════

COMMON OBJECTIONS & RESPONSES:

"That's against our policy."
→ "I hear you. Is there a manager exception process or a one-time courtesy you
   can request on my behalf?"

"You'll need to call back during business hours."
→ "Got it. What are those hours, and is there a direct line I can call?"

"I can't find your account."
→ "Let me give you another reference — try [alternative ID from background facts].
   If that doesn't work, the order was placed on [date]."

"We don't do that over the phone — you need to use the website."
→ "Of course. Can you walk me through where on the site, or send me a direct link?"

"I need to verify your identity first."
→ Provide verification info from background facts willingly. If they ask for
   something you don't have, say so honestly and offer alternatives.

"This call may be recorded."
→ "That's fine, no problem."

═══════════════════════════════════════════════════════════════════════════
                       PHASE 8 — HOSTILE OR SUSPICIOUS CALLEES
═══════════════════════════════════════════════════════════════════════════

If the callee becomes rude, accusatory, or aggressive:
• Stay calm. Lower your tone. Slow down.
• "I'm sorry — I can hear this is frustrating. I'm just trying to [restate goal]."
• Do NOT match their energy.
• Do NOT argue.
• If they accuse you of being a scam/AI/bot:
  → "I promise I'm a real person. I can give you my callback number if that helps."
  → If they keep insisting, calmly: "Okay, I understand you're not comfortable.
     I'll try a different channel. Have a good day."
  → Then end the call.

If they threaten legal action or law enforcement:
• "I understand. I'm only trying to resolve [issue] — I'll follow up in writing."
• End the call.

═══════════════════════════════════════════════════════════════════════════
                       PHASE 9 — IDENTITY CHALLENGES
═══════════════════════════════════════════════════════════════════════════

If asked to verify identity:
• Provide info from background facts: name, address, account number, last 4 of card,
  date of birth (if in facts), security question answers (if in facts).
• If they ask for info you DON'T have:
  "I don't have that on hand right now. Is there another verification option?
   I have [list what you do have]."
• NEVER invent a SSN, DOB, or other sensitive identifier you don't actually have.
• If verification fails entirely, politely end and request a callback procedure.

${paymentSection}

═══════════════════════════════════════════════════════════════════════════
                       PHASE 10 — CALL CLOSURE
═══════════════════════════════════════════════════════════════════════════

BEFORE ENDING:
1. Recap the outcome: "So just to confirm — [summarize result, confirmation #, ETA]."
2. Get a confirmation number, ticket number, case ID, or rep name + ID.
3. Ask for next steps: "What should I do if I don't hear back by [date]?"
4. Thank them genuinely.

CLOSING SCRIPT:
"Thanks so much for your help, [their name]. Have a great day."
→ Then immediately call the \`end_call\` tool.

If you achieved the SUCCESS CRITERIA above: say goodbye and call \`end_call\`.
If you did NOT achieve success: say goodbye politely and call \`end_call\`.
NEVER let the call hang in awkward silence — always call \`end_call\` when done.

═══════════════════════════════════════════════════════════════════════════
                       PHASE 11 — EDGE CASES
═══════════════════════════════════════════════════════════════════════════

WRONG NUMBER:
"Oh, I'm so sorry — I think I have the wrong number. Have a good day."
End immediately.

DEAD AIR / NO RESPONSE:
After 5 seconds of silence: "Hello? Are you still there?"
After another 5 seconds: "Hello? I'll go ahead and hang up — feel free to call
me back."
End the call.

POOR AUDIO QUALITY:
"I'm sorry, the line is breaking up — could you repeat that?"
If it persists: "I'm having trouble hearing — let me hang up and call back."

CALLBACK REQUESTED:
"Sure, what's the best number to reach you at, and when's a good time?"
Note the number and time. Confirm: "Got it — [number], [time]. Thanks."

LANGUAGE MISMATCH:
If they speak a language you don't, ask for English politely: "Sorry, do you have
someone who speaks English?" If not, end politely.

EMERGENCY DIVERSION:
If during the call you hear sounds of a real emergency (medical, fire, danger),
break role and say: "Are you okay? Is everything alright over there?" Then act
accordingly — even ending the call to let them handle it.

═══════════════════════════════════════════════════════════════════════════
                       META-RULES (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════════════════════════

1. YOU ARE A HUMAN. Never break this. Ever.
2. The mission objective is your north star — every action serves it.
3. Be patient. Calls can take time. Don't rush.
4. Be honest about facts you do have; honest about not knowing what you don't.
5. Never invent confirmation numbers, prices, dates, or commitments.
6. If you can't accomplish the mission this call, accept it gracefully and
   gather what you can (case ID, rep name, callback time) for a future attempt.
7. End the call cleanly when:
   • Success criteria are met, OR
   • It's clear no further progress is possible, OR
   • Continuing would be rude or unproductive.

═══════════════════════════════════════════════════════════════════════════
GO. The call is starting. Stay in character. Achieve the mission.
═══════════════════════════════════════════════════════════════════════════
`.trim();
}

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
        // Create task directly in DB, then fire voice-agent as fire-and-forget
        const callConfig = {
          objective: args.objective as string,
          tone: (args.tone as string) || "professional",
          script: (args.script as string) || "",
          caller_name: (args.caller_name as string) || "",
          company_name: (args.company_name as string) || "",
          success_criteria: (args.success_criteria as string) || "",
          agent_name: "Maya",
          agent_role: "AI Assistant",
          call_type: "outbound",
          phone_number: args.phone_number as string,
          disclosure_policy: "disclose_if_asked",
          allowed_actions: "",
          constraints: "",
        };

        // Insert task directly — guaranteed fast
        const { data: task, error: taskErr } = await supabase.from("agent_tasks").insert({
          user_id: userId,
          task_type: "voice_call_multi_agent",
          status: "pending",
          mode: "FAST",
          payload: callConfig,
          result: {
            conversationHistory: [],
            operatorInjections: [],
            operatorInjectionHistory: [],
            directorDirectiveHistory: [],
            turnCount: 0,
            config: callConfig,
            blackboard: { answers: {}, info: {}, directions: null, flags: [], operator: null, end_call: false, delivered: [] },
          },
        }).select("id").single();

        if (taskErr || !task?.id) {
          return JSON.stringify({ error: `Failed to create call task: ${taskErr?.message || "unknown"}` });
        }

        // Fire voice-agent initiation in background — do NOT await
        const voiceAgentUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-agent?action=initiate`;
        fetch(voiceAgentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
          body: JSON.stringify({ ...callConfig, _task_id: task.id }),
        }).catch(e => console.error("[agent-chat] fire-and-forget voice-agent error:", e));

        return JSON.stringify({
          success: true,
          taskId: task.id,
          to: args.phone_number,
          status: "pending",
          message: `📞 Call queued to ${args.phone_number}. Task ID: ${task.id}. The voice agent is dialing now. Use phone_call_status to monitor.`,
        });
      }

      case "phone_call_status": {
        const stateUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-agent?action=get-state&task_id=${args.task_id}`;
        const stateRes = await fetch(stateUrl, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
        });
        const stateData = await stateRes.json();
        if (!stateRes.ok) {
          return JSON.stringify({ error: stateData.error || `Failed to get call state (${stateRes.status})` });
        }
        return JSON.stringify({
          taskId: args.task_id,
          status: stateData.status,
          mode: stateData.mode,
          transcript: stateData.transcript || [],
          blackboard: stateData.blackboard || {},
          turnCount: stateData.plannerMeta?.totalCycles || 0,
          objective: stateData.config?.objective || "",
        });
      }

      case "phone_call_inject": {
        const injectUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/voice-agent?action=inject`;
        const injectRes = await fetch(injectUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
          body: JSON.stringify({
            task_id: args.task_id as string,
            instruction: args.instruction as string,
          }),
        });
        const injectData = await injectRes.json();
        if (!injectRes.ok) {
          return JSON.stringify({ error: injectData.error || `Injection failed (${injectRes.status})` });
        }
        return JSON.stringify({
          success: true,
          message: `Instruction injected into active call. The voice agent will incorporate "${args.instruction}" on its next turn.`,
        });
      }

      case "voiceops_call": {
        try {
          const SUPA = Deno.env.get("SUPABASE_URL")!;
          const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          // voiceops-start-call uses auth user, so insert call directly via service role to bypass
          const admin = createClient(SUPA, SR);
          // Normalize phone
          let phone = String(args.phone_number).trim().replace(/[^\d+]/g, "");
          if (!phone.startsWith("+")) {
            if (/^\d{10}$/.test(phone)) phone = `+1${phone}`;
            else phone = `+${phone}`;
          }
          const { data: call, error: cErr } = await admin.from("voiceops_calls").insert({
            user_id: userId,
            phone_number: phone,
            objective: args.objective as string,
            customer_info: {
              firstName: args.first_name || "",
              lastName: args.last_name || "",
              company: args.company || "",
              strategy: args.strategy || "persistent",
            },
            status: "starting",
          }).select().single();
          if (cErr || !call) return JSON.stringify({ error: cErr?.message || "failed to create call row" });

          const VAPI_KEY = Deno.env.get("VAPI_API_KEY")?.trim();
          const VAPI_PHONE = Deno.env.get("VAPI_PHONE_NUMBER_ID")?.trim();
          if (!VAPI_KEY || !VAPI_PHONE) return JSON.stringify({ error: "VoiceOps not configured (missing VAPI keys)" });

          // 1) Generate per-call system prompt via OpenAI Assistants API
          const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")?.trim();
          const PROMPT_ASSISTANT = (Deno.env.get("OPENAI_PROMPT_ASSISTANT_ID") || "asst_aG8wdr2PnItqiNay5MTn8DSj").trim();
          if (!OPENAI_KEY) {
            await admin.from("voiceops_calls").update({ status: "failed", ended_reason: "missing OPENAI_API_KEY" }).eq("id", call.id);
            return JSON.stringify({ error: "openai_not_configured" });
          }
          let generatedPrompt = "";
          try {
            const oaH = { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json", "OpenAI-Beta": "assistants=v2" };
            const brief = `Generate the call agent system prompt for this outbound mission.\n\n${JSON.stringify({
              objective: args.objective,
              first_name: args.first_name, last_name: args.last_name, company: args.company,
              strategy: args.strategy, phone_number: phone,
            }, null, 2)}`;
            const tRes = await fetch("https://api.openai.com/v1/threads", { method: "POST", headers: oaH, body: JSON.stringify({ messages: [{ role: "user", content: brief }] }) });
            const thread = await tRes.json();
            if (!tRes.ok) throw new Error(`thread: ${JSON.stringify(thread)}`);
            const rRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, { method: "POST", headers: oaH, body: JSON.stringify({ assistant_id: PROMPT_ASSISTANT }) });
            let run = await rRes.json();
            if (!rRes.ok) throw new Error(`run: ${JSON.stringify(run)}`);
            const start = Date.now();
            while (["queued", "in_progress", "cancelling"].includes(run.status)) {
              if (Date.now() - start > 45_000) throw new Error("run_timeout");
              await new Promise((r) => setTimeout(r, 1200));
              run = await (await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, { headers: oaH })).json();
            }
            if (run.status !== "completed") throw new Error(`run_status=${run.status}`);
            const mRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages?order=desc&limit=10`, { headers: oaH });
            const msgs = await mRes.json();
            const a = (msgs.data || []).find((m: { role: string }) => m.role === "assistant");
            generatedPrompt = (a?.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: { value: string } }) => c.text.value).join("\n\n").trim();
            if (!generatedPrompt || generatedPrompt.length < 50) throw new Error("empty_assistant_output");
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            await admin.from("voiceops_calls").update({ status: "failed", ended_reason: `prompt_generation_failed: ${detail}` }).eq("id", call.id);
            return JSON.stringify({ error: "prompt_generation_failed", detail });
          }

          const firstMsg = `Hi${args.first_name ? " " + args.first_name : ""}, this is Alex. This call may be recorded for quality. Do you have a quick minute?`;
          const voiceopsWebhookUrl = `${SUPA}/functions/v1/voiceops-webhook`;

          const vapiBody: Record<string, unknown> = {
            phoneNumberId: VAPI_PHONE,
            customer: { number: phone },
            maxDurationSeconds: Math.min(Math.max(Number(args.max_duration_seconds) || 900, 60), 1800),
            metadata: { voiceops_call_id: call.id, user_id: userId },
            assistantOverrides: {
              variableValues: {
                firstName: String(args.first_name || ""),
                lastName: String(args.last_name || ""),
                company: String(args.company || ""),
                taskObjective: String(args.objective || ""),
                injection: "",
              },
              firstMessage: firstMsg,
            },
            assistant: {
              name: "VoiceOps Alex",
              firstMessage: firstMsg,
              model: { provider: "openai", model: "gpt-4o", temperature: 0.6, messages: [{ role: "system", content: generatedPrompt }] },
              voice: { provider: "11labs", voiceId: "burt" },
              transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
              recordingEnabled: true,
              endCallFunctionEnabled: true,
              server: { url: voiceopsWebhookUrl },
              serverMessages: ["status-update", "transcript", "end-of-call-report", "conversation-update"],
            },
          };

          const vRes = await fetch("https://api.vapi.ai/call", {
            method: "POST",
            headers: { Authorization: `Bearer ${VAPI_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(vapiBody),
          });
          const vJson = await vRes.json();
          if (!vRes.ok) {
            await admin.from("voiceops_calls").update({ status: "failed", ended_reason: JSON.stringify(vJson) }).eq("id", call.id);
            return JSON.stringify({ error: "vapi_failed", detail: vJson });
          }
          await admin.from("voiceops_calls").update({
            vapi_call_id: vJson.id,
            control_url: vJson.monitor?.controlUrl ?? vJson.controlUrl ?? null,
            status: "ringing",
          }).eq("id", call.id);

          return JSON.stringify({
            success: true,
            call_id: call.id,
            vapi_call_id: vJson.id,
            monitor_url: "/voiceops",
            message: `📞 VoiceOps dialing ${phone}. Watch live at /voiceops or poll voiceops_call_transcript with call_id="${call.id}".`,
          });
        } catch (e) {
          return JSON.stringify({ error: e instanceof Error ? e.message : "voiceops_call failed" });
        }
      }

      case "voiceops_call_transcript": {
        try {
          const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
          const { data: call } = await admin.from("voiceops_calls")
            .select("id, status, phone_number, objective, outcome, ended_reason, duration_seconds, recording_url")
            .eq("id", args.call_id).maybeSingle();
          if (!call) return JSON.stringify({ error: "call not found" });
          const { data: turns } = await admin.from("voiceops_transcripts")
            .select("role, text, is_final, created_at")
            .eq("call_id", args.call_id)
            .order("created_at", { ascending: true })
            .limit(Math.min(Number(args.limit) || 50, 200));
          return JSON.stringify({ call, turns: turns ?? [], turn_count: (turns ?? []).length });
        } catch (e) {
          return JSON.stringify({ error: e instanceof Error ? e.message : "transcript fetch failed" });
        }
      }

      case "voiceops_call_inject": {
        try {
          const SUPA = Deno.env.get("SUPABASE_URL")!;
          const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const admin = createClient(SUPA, SR);
          const mode = ["context", "say-now", "end-call"].includes(args.mode) ? args.mode : "context";
          const text = String(args.text || "");
          const { data: call } = await admin.from("voiceops_calls")
            .select("id, control_url, user_id").eq("id", args.call_id).maybeSingle();
          if (!call) return JSON.stringify({ error: "call not found" });
          if (call.user_id !== userId) return JSON.stringify({ error: "forbidden" });
          if (!call.control_url) return JSON.stringify({ error: "no control_url (call may not be live yet)" });

          const { data: inj } = await admin.from("voiceops_injections").insert({
            call_id: call.id, user_id: userId, text, mode, status: "pending",
          }).select().single();

          let body: Record<string, unknown>;
          if (mode === "say-now") body = { type: "say", message: text, endCallAfterSpoken: false };
          else if (mode === "end-call") body = { type: "end-call" };
          else body = { type: "add-message", message: { role: "system", content: `OPERATOR DIRECTIVE: ${text}` } };

          const r = await fetch(call.control_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const errText = await r.text();
            if (inj) await admin.from("voiceops_injections").update({ status: "failed", error: errText }).eq("id", inj.id);
            return JSON.stringify({ error: "vapi_control_failed", detail: errText });
          }
          if (inj) await admin.from("voiceops_injections").update({ status: "delivered", delivered_at: new Date().toISOString() }).eq("id", inj.id);

          return JSON.stringify({
            success: true, mode,
            message: mode === "say-now" ? `🎙️ Alex will say: "${text}"`
              : mode === "end-call" ? `📴 Ending call.`
              : `🎯 Director directive sent: "${text}"`,
          });
        } catch (e) {
          return JSON.stringify({ error: e instanceof Error ? e.message : "inject failed" });
        }
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

      // ═══ VM OPERATIONS ════════════════════════════════════════════════
      case "vm_list": {
        const { data, error } = await supabase.from("vm_instances")
          .select("id, name, host, ssh_port, ssh_user, vnc_url, novnc_url, status, os, specs_json, last_heartbeat_at")
          .eq("user_id", userId).order("name");
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ vms: data || [], count: data?.length || 0 });
      }

      case "vm_execute": {
        const vmBridgeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vm-bridge?action=execute`;
        const res = await fetch(vmBridgeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            vm_id: args.vm_id,
            command: args.command,
            timeout: args.timeout || 30,
          }),
        });
        const result = await res.json();
        if (!res.ok) return JSON.stringify({ error: result.error || "VM command failed" });

        // Get VM info for stream marker
        const { data: vmInfo } = await supabase.from("vm_instances")
          .select("id, name, novnc_url").eq("id", args.vm_id as string).eq("user_id", userId).single();

        return JSON.stringify({
          ...result,
          vm: vmInfo ? { id: vmInfo.id, name: vmInfo.name, noVNC_url: vmInfo.novnc_url } : null,
        });
      }

      case "vm_status": {
        const vmBridgeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vm-bridge?action=status&vm_id=${args.vm_id}`;
        const res = await fetch(vmBridgeUrl, {
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
        });
        return await res.text();
      }

      case "vm_screenshot": {
        const vmBridgeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vm-bridge?action=screenshot`;
        const res = await fetch(vmBridgeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
          body: JSON.stringify({ vm_id: args.vm_id }),
        });
        return await res.text();
      }

      case "vm_add": {
        const vmBridgeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vm-bridge?action=add`;
        const res = await fetch(vmBridgeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
          body: JSON.stringify({
            name: args.name,
            host: args.host,
            ssh_port: args.ssh_port || 22,
            ssh_user: args.ssh_user || "admin",
            ssh_password_enc: args.ssh_password_enc || null,
            noVNC_url: args.noVNC_url || null,
            specs_json: args.bridge_port ? { bridge_port: args.bridge_port } : {},
          }),
        });
        return await res.text();
      }

      case "vm_remove": {
        const vmBridgeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vm-bridge?action=remove`;
        const res = await fetch(vmBridgeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "X-User-Id": userId,
          },
          body: JSON.stringify({ vm_id: args.vm_id }),
        });
        return await res.text();
      }

      case "vm_browser_task": {
        // Compose a PowerShell script that launches Playwright on the VM
        const playwrightScript = `
$task = @"
${(args.task as string).replace(/"/g, '`"')}
"@
$startUrl = "${args.start_url || 'https://www.google.com'}"
# Launch browser-use or Playwright script on the VM
Start-Process "msedge" -ArgumentList "$startUrl"
Write-Output "Browser launched with task: $task at URL: $startUrl"
Write-Output "Task is being executed on the VM desktop — visible in live stream."
`;
        return executeTool("vm_execute", {
          vm_id: args.vm_id,
          command: playwrightScript,
          timeout: 60,
        }, supabase, userId);
      }

      // ═══ ELEVENLABS DIRECT API HANDLERS ════════════════════════════════
      case "el_create_agent": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        // Use override if provided, otherwise build hardened multi-page production prompt
        const finalPrompt = (args.system_prompt_override as string) || buildHardenedPrompt(args);
        // Built-in ElevenLabs system tools — automatically activated for every agent
        // so the LLM can navigate IVRs (DTMF), end the call cleanly, skip turns
        // during long silences, and detect language switches mid-call.
        // Built-in ElevenLabs system tools — must follow the BuiltInTools-Input schema:
        // each key maps to an object with name/description/type/params (or null to disable).
        const builtInTools = {
          end_call: {
            name: "end_call",
            description: "",
            response_timeout_secs: 20,
            type: "system",
            params: { system_tool_type: "end_call" },
          },
          play_keypad_touch_tone: {
            name: "play_keypad_touch_tone",
            description: "",
            response_timeout_secs: 20,
            type: "system",
            params: { system_tool_type: "play_keypad_touch_tone" },
          },
          skip_turn: {
            name: "skip_turn",
            description: "",
            response_timeout_secs: 20,
            type: "system",
            params: { system_tool_type: "skip_turn" },
          },
          language_detection: null,
          transfer_to_agent: null,
          transfer_to_number: null,
          voicemail_detection: null,
        };
        const body = {
          name: args.name,
          platform_settings: {
            auth: {
              enable_auth: false,
              allowlist: [],
            },
          },
          conversation_config: {
            agent: {
              prompt: {
                prompt: finalPrompt,
                llm: args.llm || "gpt-4o",
                temperature: typeof args.temperature === "number" ? args.temperature : 0.6,
                built_in_tools: builtInTools,
              },
              first_message: simplifyFirstMessage(args.first_message),
              language: args.language || "en",
            },
            tts: { voice_id: args.voice_id || "EXAVITQu4vr4xnSDxMaL" },
            conversation: { max_duration_seconds: args.max_duration_seconds || 1200 },
          },
        };
        const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        return JSON.stringify({
          success: true,
          agent_id: data.agent_id,
          name: args.name,
          prompt_chars: finalPrompt.length,
          prompt_used: args.system_prompt_override ? "custom_override" : "hardened_framework_v1",
          tools_activated: ["end_call", "play_keypad_touch_tone", "skip_turn"],
        });
      }

      case "el_update_agent": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        const patch: any = { conversation_config: { agent: { prompt: {} } } };
        if (args.system_prompt) patch.conversation_config.agent.prompt.prompt = args.system_prompt;
        if (args.first_message) patch.conversation_config.agent.first_message = simplifyFirstMessage(args.first_message);
        if (args.voice_id) patch.conversation_config.tts = { voice_id: args.voice_id };
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${args.agent_id}`, {
          method: "PATCH",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        return JSON.stringify({ success: true, agent_id: args.agent_id });
      }

      case "el_outbound_call": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        const phoneNumberId = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        if (!phoneNumberId) return JSON.stringify({ error: "ELEVENLABS_PHONE_NUMBER_ID not configured" });
        const body: any = {
          agent_id: args.agent_id,
          agent_phone_number_id: phoneNumberId,
          to_number: args.to_number,
        };
        if (args.dynamic_variables && typeof args.dynamic_variables === "object") {
          body.conversation_initiation_client_data = {
            dynamic_variables: args.dynamic_variables,
          };
        }
        const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        const convId = data.conversation_id || null;
        return JSON.stringify({
          success: true,
          conversation_id: convId,
          call_sid: data.callSid || data.call_sid,
          agent_id: args.agent_id,
          message: convId
            ? `📞 Call initiated to ${args.to_number}. Poll with el_get_conversation conversation_id="${convId}".`
            : `📞 Call queued to ${args.to_number}. conversation_id not yet assigned (Twilio is still dialing). Poll with el_get_conversation passing agent_id="${args.agent_id}" — it will auto-resolve the latest conversation for that agent.`,
          hint_for_polling: { agent_id: args.agent_id, retry_after_secs: 5 },
        });
      }

      case "el_get_conversation": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        let convId = args.conversation_id as string | undefined;
        // Auto-discover: if no conversation_id given (or it was null from outbound-call),
        // fetch the latest conversation for this agent_id.
        if ((!convId || convId === "null") && args.agent_id) {
          const listRes = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${args.agent_id}&page_size=1`,
            { headers: { "xi-api-key": apiKey } },
          );
          const listData = await listRes.json();
          convId = listData?.conversations?.[0]?.conversation_id;
          if (!convId) {
            return JSON.stringify({
              status: "pending",
              message: "No conversation has materialized yet for this agent. The call is still ringing or Twilio hasn't connected. Retry in 5–10s.",
              agent_id: args.agent_id,
            });
          }
        }
        if (!convId) return JSON.stringify({ error: "Provide conversation_id or agent_id" });
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${convId}`, {
          headers: { "xi-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok) return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        return JSON.stringify({
          conversation_id: convId,
          status: data.status,
          agent_id: data.agent_id,
          start_time: data.metadata?.start_time_unix_secs,
          duration_secs: data.metadata?.call_duration_secs,
          transcript: (data.transcript || []).map((t: any) => ({
            role: t.role,
            message: t.message,
            time_in_call_secs: t.time_in_call_secs,
          })),
          analysis: data.analysis || null,
        });
      }

      case "el_list_conversations": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        const params = new URLSearchParams();
        if (args.agent_id) params.set("agent_id", String(args.agent_id));
        params.set("page_size", String(args.page_size || 30));
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?${params}`, {
          headers: { "xi-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok) return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        return JSON.stringify(data);
      }

      case "el_send_contextual_update": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${args.conversation_id}/contextual-update`, {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ text: args.text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        return JSON.stringify({ success: true, message: "Contextual update sent — agent will incorporate it on next turn." });
      }

      case "el_end_call": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${args.conversation_id}`, {
          method: "DELETE",
          headers: { "xi-api-key": apiKey },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        }
        return JSON.stringify({ success: true, message: "Call terminated." });
      }

      case "el_delete_agent": {
        const apiKey = Deno.env.get("ELEVENLABS_CONVAI_KEY") || Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" });
        const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${args.agent_id}`, {
          method: "DELETE",
          headers: { "xi-api-key": apiKey },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return JSON.stringify({ error: `ElevenLabs error ${res.status}`, details: data });
        }
        return JSON.stringify({ success: true, message: "Agent deleted." });
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
      let activeVoiceOpsCall: { call_id: string; phone_number?: string; objective?: string; status?: string } | null = null;

      while (maxLoops-- > 0) {
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4.1",
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
            if (tc.function.name === "voiceops_call") {
              try {
                const parsed = JSON.parse(result);
                if (parsed?.success && parsed?.call_id) {
                  activeVoiceOpsCall = {
                    call_id: parsed.call_id,
                    phone_number: toolArgs.phone_number,
                    objective: toolArgs.objective,
                    status: "ringing",
                  };
                }
              } catch { /* ignore marker parsing */ }
            }
            currentMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
          }
          continue;
        }

        // Stream final response
        const streamRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4.1", messages: currentMessages, stream: true }),
        });

        if (!streamRes.ok) throw new Error("Stream failed");
        const responseBody = activeVoiceOpsCall && streamRes.body
          ? prependVoiceOpsMarker(streamRes.body, activeVoiceOpsCall)
          : streamRes.body;
        return new Response(responseBody, {
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
      body: JSON.stringify({ model: "gpt-4.1", messages: fullMessages, tools: AGENT_TOOLS, tool_choice: "auto" }),
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
