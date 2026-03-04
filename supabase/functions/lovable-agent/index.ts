import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── System Prompt — verbatim from docs/AgentPrompt-2.md ─────────────────────
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

## Available Tools
The system has access to various tools for:
- File operations (read, write, search, replace, rename, delete)
- Code searching across files
- Adding/removing dependencies
- Generating and editing images
- Web search and content fetching
- Reading console logs and network requests
- Project analytics`;

// ── Tool Definitions — verbatim from docs/AgentTools-2.json ─────────────────
const AGENT_TOOLS = [
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
      description: "Use this tool to write to a file. Overwrites the existing file if there is one. The file path should be relative to the project root.",
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
      description: "Line-Based Search and Replace Tool. Use this tool to find and replace specific content in a file you have access to, using explicit line numbers.",
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
      description: "Download a file from a URL and save it to the repository.",
      parameters: {
        type: "object",
        properties: {
          source_url: { type: "string", description: "The URL of the file to download" },
          target_path: { type: "string", description: "The path where the file should be saved in the repository" },
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
          formats: { type: "string", description: "Comma-separated list of formats: 'markdown', 'html', 'screenshot'." },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lov-view",
      description: "Use this tool to read the contents of a file. The file path should be relative to the project root. You can optionally specify line ranges.",
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
      description: "Use this tool to read the contents of the latest console logs at the moment the user sent the request.",
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
      description: "Use this tool to read the contents of the latest network requests.",
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
      description: "You MUST use this tool to rename a file instead of creating new files and deleting old ones.",
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
      description: "Generates an image based on a text prompt and saves it to the specified file path. Use the best models for large images that are really important. Make sure that you consider aspect ratio given the location of the image on the page when selecting dimensions.\n\nFor small images (less than 1000px), use flux.schnell, it's much faster and really good! This should be your default model.\nWhen you generate large images like a fullscreen image, use flux.dev. The maximum resolution is 1920x1920.\nOnce generated, you need to import the images in code as ES6 imports.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Text description of the desired image" },
          target_path: { type: "string", description: "The file path where the generated image should be saved." },
          width: { type: "number", description: "Image width (minimum 512, maximum 1920)" },
          height: { type: "number", description: "Image height (minimum 512, maximum 1920)" },
          model: { type: "string", description: "The model to use: flux.schnell (default), flux.dev." },
        },
        required: ["prompt", "target_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_image",
      description: "Edits or merges existing images based on a text prompt using Flux Kontext Pro model. This tool can work with single or multiple images.",
      parameters: {
        type: "object",
        properties: {
          image_paths: { type: "array", items: { type: "string" }, description: "Array of paths to existing image files." },
          prompt: { type: "string", description: "Text description of how to edit/merge the image(s)." },
          target_path: { type: "string", description: "The file path where the edited/merged image should be saved." },
          strength: { type: "number", description: "How much to change the image (0.0-1.0)." },
        },
        required: ["image_paths", "prompt", "target_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Performs a web search and returns relevant results with text content. Use this to find current information, documentation, or any web-based content.",
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
      description: "Read the analytics for the production build of the project between two dates, with a given granularity.",
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
function executeTool(toolName: string, args: Record<string, unknown>): string {
  // These are editor-level tools. In this chat context, we acknowledge the call
  // and return a descriptive response.
  switch (toolName) {
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

    // Tool call loop (max 5 iterations)
    let iterations = 0;
    while (choice?.finish_reason === "tool_calls" && choice?.message?.tool_calls?.length && iterations < 5) {
      iterations++;
      const toolCalls = choice.message.tool_calls;

      // Add assistant message with tool calls
      apiMessages.push(choice.message);

      // Execute each tool and add results
      for (const tc of toolCalls) {
        const toolArgs = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
        const result = executeTool(tc.function.name, toolArgs);
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

    // Now do a final streaming call with the full conversation
    const finalContent = choice?.message?.content || "";

    // Stream the final response
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
          { role: "user", content: "Please provide your final response now, incorporating any tool results above." },
        ],
        stream: true,
      }),
    });

    if (!streamResponse.ok || !streamResponse.body) {
      // Fall back to non-streamed content
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
