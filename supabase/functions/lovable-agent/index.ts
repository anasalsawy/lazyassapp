import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── System Prompt — verbatim from docs/AgentPrompt-2.md ─────────────────────
const SYSTEM_PROMPT = `# Lovable AI Editor System Prompt
 
## Role
You are Lovable, an AI editor that creates and modifies web applications. You assist users by chatting with them and making changes to their code in real-time.

**Technology Stack**: React, Vite, Tailwind CSS, TypeScript with Supabase backend.

Current date: ${new Date().toISOString().split("T")[0]}

## Capabilities
You have REAL access to:
- **Secrets Management**: List and read secrets stored in the backend (API keys for Browser Use, Skyvern, Stripe, OpenAI, etc.)
- **External APIs**: Make HTTP requests to any external API (Browser Use Cloud, Skyvern, OpenAI, etc.) using stored credentials
- **Edge Functions**: Invoke any of the project's edge functions directly
- **Database**: Query the Supabase database for project data
- **File Operations**: Read, write, search, and modify project files (simulated in chat)

## Important Guidelines
- When the user asks you to do something with an external API, use the appropriate tool to actually make the request.
- You can chain tools: first fetch a secret (like BROWSER_USE_API_KEY), then use it to call the Browser Use API.
- Always confirm destructive actions before executing them.
- Keep responses concise.
- For Browser Use tasks, use the API at https://api.browser-use.com/api/v2/
- For Skyvern tasks, use the API at https://api.skyvern.com/api/v1/

## Available Secrets (pre-configured)
The following secrets are available and can be fetched:
OPENAI_API_KEY, FIRECRAWL_API_KEY, BRIDGE_API_KEY, STRIPE_SECRET_KEY, BROWSER_USE_API_KEY, 
SKYVERN_API_KEY, HYPERBROWSER_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
MAILGUN_API_KEY, MAILGUN_DOMAIN, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER,
BROWSER_USE_BRIDGE_URL, BROWSER_USE_BRIDGE_API_KEY, BRIDGE_URL, LOVABLE_API_KEY

## File Operations
The file-level tools (lov-write, lov-search-files, etc.) are simulated in this chat context — they describe what would happen. For real file modifications, the user should use the main Lovable editor.
`;

// ── Tool Definitions ─────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  // --- REAL TOOLS ---
  {
    type: "function",
    function: {
      name: "fetch_secret",
      description: "Fetch the value of a stored secret/API key by name. Use this to get credentials before calling external APIs. Available secrets include: OPENAI_API_KEY, BROWSER_USE_API_KEY, SKYVERN_API_KEY, STRIPE_SECRET_KEY, FIRECRAWL_API_KEY, HYPERBROWSER_API_KEY, and more.",
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
      name: "http_request",
      description: "Make an HTTP request to any external API. Use this to call Browser Use Cloud API, Skyvern API, OpenAI API, or any other service. You must fetch the required API key first using fetch_secret, then include it in the headers.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method" },
          url: { type: "string", description: "Full URL to call, e.g. 'https://api.browser-use.com/api/v2/tasks'" },
          headers: { type: "object", description: "Request headers as key-value pairs, e.g. { 'X-Browser-Use-API-Key': '...', 'Content-Type': 'application/json' }" },
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
      description: "Invoke one of the project's Supabase edge functions. Available functions: agent-chat, analyze-resume, auto-shop, calculate-analytics, card-preauth, check-subscription, create-checkout, customer-portal, email-agent, email-oauth, email-processor, email-webhook, generate-cover-letter, generate-email-alias, get-verification-code, job-agent, lever-job-research, match-jobs, operator-chat, optimize-resume, redesign-resume, scrape-jobs, search-jobs-deep, submit-application, sync-agent-status",
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
      description: "Query the Supabase database. Specify a table name and optional filters. Returns up to 100 rows.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table name, e.g. 'applications', 'jobs', 'agent_tasks'" },
          select: { type: "string", description: "Columns to select, e.g. '*' or 'id,status,created_at'. Default: '*'" },
          filters: { type: "array", items: { type: "object", properties: { column: { type: "string" }, operator: { type: "string" }, value: { type: "string" } } }, description: "Array of filters like [{column: 'status', operator: 'eq', value: 'active'}]" },
          limit: { type: "number", description: "Max rows to return. Default: 20" },
          order: { type: "string", description: "Column to order by, e.g. 'created_at.desc'" },
        },
        required: ["table"],
      },
    },
  },
  // --- SIMULATED FILE TOOLS ---
  {
    type: "function",
    function: {
      name: "lov-search-files",
      description: "Search for patterns across project files using regex.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          include_pattern: { type: "string" },
        },
        required: ["query", "include_pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-write",
      description: "Write content to a project file (simulated in chat context).",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-view",
      description: "Read a project file's contents (simulated in chat context).",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          numResults: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
];

// ── Real Tool Execution ─────────────────────────────────────────────────────
async function executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  switch (toolName) {
    // ── REAL: Fetch a secret value ──
    case "fetch_secret": {
      const name = args.secret_name as string;
      const value = Deno.env.get(name);
      if (!value) {
        return JSON.stringify({ success: false, error: `Secret '${name}' not found or not set.` });
      }
      // Return a masked version for display + the real value for the model to use
      const masked = value.slice(0, 6) + "..." + value.slice(-4);
      return JSON.stringify({ success: true, secret_name: name, value: value, display_value: masked, message: `Secret '${name}' fetched successfully. Use the value in subsequent API calls.` });
    }

    // ── REAL: List all available secrets ──
    case "list_secrets": {
      const knownSecrets = [
        "OPENAI_API_KEY", "FIRECRAWL_API_KEY", "BRIDGE_API_KEY", "STRIPE_SECRET_KEY",
        "BROWSER_USE_API_KEY", "SKYVERN_API_KEY", "HYPERBROWSER_API_KEY",
        "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY",
        "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_REGION",
        "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER",
        "BROWSER_USE_BRIDGE_URL", "BROWSER_USE_BRIDGE_API_KEY", "BRIDGE_URL",
        "LOVABLE_API_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_DB_URL",
        "SHOP_PROXY_KEY_2024",
      ];
      const available = knownSecrets.filter(s => !!Deno.env.get(s));
      const missing = knownSecrets.filter(s => !Deno.env.get(s));
      return JSON.stringify({ available, missing, total_configured: available.length });
    }

    // ── REAL: Make HTTP request ──
    case "http_request": {
      const method = (args.method as string) || "GET";
      const url = args.url as string;
      const headers = (args.headers as Record<string, string>) || {};
      const body = args.body as Record<string, unknown> | undefined;

      if (!url) return JSON.stringify({ error: "URL is required" });

      try {
        const fetchOpts: RequestInit = {
          method,
          headers: { "Content-Type": "application/json", ...headers },
        };
        if (body && ["POST", "PUT", "PATCH"].includes(method)) {
          fetchOpts.body = JSON.stringify(body);
        }

        console.log(`[http_request] ${method} ${url}`);
        const resp = await fetch(url, fetchOpts);
        const responseText = await resp.text();
        
        let responseData;
        try { responseData = JSON.parse(responseText); } 
        catch { responseData = responseText; }

        return JSON.stringify({
          success: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          data: responseData,
        });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "HTTP request failed" });
      }
    }

    // ── REAL: Invoke edge function ──
    case "invoke_edge_function": {
      const funcName = args.function_name as string;
      const body = args.body as Record<string, unknown> | undefined;

      try {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const { data, error } = await supabase.functions.invoke(funcName, {
          body: body || {},
        });

        if (error) {
          return JSON.stringify({ success: false, error: error.message });
        }
        return JSON.stringify({ success: true, data });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Edge function invocation failed" });
      }
    }

    // ── REAL: Query database ──
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
        if (error) {
          return JSON.stringify({ success: false, error: error.message });
        }
        return JSON.stringify({ success: true, count: data?.length || 0, data });
      } catch (err) {
        return JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Query failed" });
      }
    }

    // ── SIMULATED: File operations ──
    case "lov-write":
      return JSON.stringify({ success: true, file: args.file_path, message: `File '${args.file_path}' would be written. Use the main Lovable editor for real file changes.` });
    case "lov-search-files":
      return JSON.stringify({ results: [], message: `Search for '${args.query}' in '${args.include_pattern}' — use main editor for real search.` });
    case "lov-view":
      return JSON.stringify({ message: `File '${args.file_path}' — ask the user to share contents or use the main editor.` });
    case "web_search":
      return JSON.stringify({ message: `Web search for '${args.query}' — this is simulated in chat context.` });

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    const apiMessages = [
      { role: "system", content: SYSTEM_PROMPT },
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

    // Tool call loop (max 10 iterations for chained API calls)
    let iterations = 0;
    while (choice?.finish_reason === "tool_calls" && choice?.message?.tool_calls?.length && iterations < 10) {
      iterations++;
      const toolCalls = choice.message.tool_calls;

      // Add assistant message with tool calls
      apiMessages.push(choice.message);

      // Execute each tool and add results
      for (const tc of toolCalls) {
        const toolArgs = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
        
        console.log(`[tool] ${tc.function.name}`, JSON.stringify(toolArgs).slice(0, 200));
        const result = await executeTool(tc.function.name, toolArgs);
        apiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // Call again with tool results
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

    // Stream the final response
    const finalContent = choice?.message?.content || "";

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
          { role: "user", content: "Please provide your final response now, incorporating any tool results above. Do NOT reveal raw API keys or secret values to the user — only show masked versions. Summarize what you did and the results." },
        ],
        stream: true,
      }),
    });

    if (!streamResponse.ok || !streamResponse.body) {
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(streamResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("lovable-agent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
