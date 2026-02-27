import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Tools the agent can call — mapped to real edge functions
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
      description: "Place an automated shopping order. The agent will find the best deal and purchase it.",
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
      description: "Get the user's profile, resume info, job preferences, and account status.",
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
      description: "Search the web for information using Firecrawl. Good for researching companies, salary data, interview tips, etc.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are Manus, an elite AI agent embedded in Career Compass — a fully autonomous job search and life automation platform.

You have COMPLETE ACCESS to the following capabilities through tool calls:
- Job Search: Trigger deep research pipelines to find matching jobs
- Resume Optimization: Run ChatGPT Deep Research to rewrite and optimize resumes
- Application Tracking: View all applications, their statuses, and interview details
- Auto-Shop: Automatically find and purchase products at the best price
- Email Monitoring: Check for recruiter responses and interview invitations
- Web Search: Research companies, salaries, interview tips, and anything else
- Profile & Preferences: View and understand the user's complete profile

PERSONALITY & STYLE:
- You are confident, proactive, and action-oriented
- Don't just answer questions — take action. If someone says "find me jobs", actually trigger the search
- Speak naturally, avoid bullet points and lists. Write in flowing paragraphs
- Be direct and get things done. You're an agent, not a chatbot
- When you use a tool, briefly explain what you're doing and share the results conversationally
- If a task will take time (like resume optimization), explain the timeline and what to expect

IMPORTANT:
- Always use tools when the user's request maps to an available action
- For multi-step tasks, execute them sequentially and report progress
- If you need more information, ask — but prefer to act with reasonable defaults
- You have the user's full context: their profile, resume, preferences, and history`;

// Execute tool calls against real backend
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

        // Trigger search-jobs-deep
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
        const { data: tasks } = await supabase
          .from("agent_tasks")
          .select("id, task_type, status, result, created_at")
          .eq("user_id", userId)
          .in("status", ["pending", "running"])
          .order("created_at", { ascending: false })
          .limit(5);

        const { data: runs } = await supabase
          .from("agent_runs")
          .select("id, run_type, status, summary_json, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5);

        return JSON.stringify({ activeTasks: tasks || [], recentRuns: runs || [] });
      }

      case "get_job_matches": {
        const limit = (args.limit as number) || 10;
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, title, company, location, match_score, url, created_at")
          .eq("user_id", userId)
          .order("match_score", { ascending: false, nullsFirst: false })
          .limit(limit);

        return JSON.stringify({ jobs: jobs || [], count: jobs?.length || 0 });
      }

      case "get_applications": {
        let query = supabase
          .from("applications")
          .select("id, status, company_name, job_title, job_url, applied_at, status_message")
          .eq("user_id", userId)
          .order("applied_at", { ascending: false });

        if (args.status) query = query.eq("status", args.status as string);
        const limit = (args.limit as number) || 10;
        query = query.limit(limit);

        const { data } = await query;
        return JSON.stringify({ applications: data || [], count: data?.length || 0 });
      }

      case "auto_shop_order": {
        const { data: address } = await supabase
          .from("shipping_addresses")
          .select("id")
          .eq("user_id", userId)
          .eq("is_default", true)
          .single();

        const { data, error } = await supabase.from("auto_shop_orders").insert({
          user_id: userId,
          product_query: args.product as string,
          max_price: (args.max_price as number) || null,
          quantity: (args.quantity as number) || 1,
          shipping_address_id: address?.id || null,
          status: "pending",
        }).select().single();

        if (error) return JSON.stringify({ error: error.message });

        // Trigger auto-shop function
        await supabase.functions.invoke("auto-shop", {
          body: { orderId: data.id },
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        });

        return JSON.stringify({ success: true, orderId: data.id, message: "Order placed and agent is shopping!" });
      }

      case "get_profile_info": {
        const [profile, prefs, resume, credits] = await Promise.all([
          supabase.from("profiles").select("*").eq("user_id", userId).single(),
          supabase.from("job_preferences").select("*").eq("user_id", userId).single(),
          supabase.from("resumes").select("id, title, ats_score, skills, is_primary").eq("user_id", userId),
          supabase.from("user_credits").select("balance").eq("user_id", userId).single(),
        ]);

        return JSON.stringify({
          profile: profile.data,
          preferences: prefs.data,
          resumes: resume.data,
          credits: credits.data?.balance || 0,
        });
      }

      case "check_email_inbox": {
        const limit = (args.limit as number) || 10;
        const { data: emails } = await supabase
          .from("job_emails")
          .select("id, from_name, from_email, subject, snippet, classification, received_at, is_read")
          .eq("user_id", userId)
          .order("received_at", { ascending: false })
          .limit(limit);

        return JSON.stringify({ emails: emails || [], count: emails?.length || 0 });
      }

      case "search_web": {
        const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
        if (!FIRECRAWL_API_KEY) return JSON.stringify({ error: "Web search not configured" });

        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: args.query, limit: 5 }),
        });

        if (!res.ok) return JSON.stringify({ error: "Search failed" });
        const data = await res.json();
        const results = (data.data || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          description: r.description || r.markdown?.substring(0, 300),
        }));

        return JSON.stringify({ results });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool execution failed" });
  }
}

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
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) throw new Error("Unauthorized");

    const { messages, stream = true } = await req.json();

    // Build conversation with system prompt
    const fullMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    // If streaming, we do a loop: call OpenAI, if tool_calls, execute and loop, else stream final
    if (stream) {
      // First, do a non-streaming call to check for tool calls
      let currentMessages = [...fullMessages];
      let maxLoops = 5;

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
          // Execute tool calls
          currentMessages.push(choice.message);

          for (const tc of choice.message.tool_calls) {
            const args = JSON.parse(tc.function.arguments || "{}");
            const result = await executeTool(tc.function.name, args, supabase, user.id);
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: result,
            });
          }
          // Loop again to get final response
          continue;
        }

        // No tool calls — stream the final response
        const streamRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: currentMessages,
            stream: true,
          }),
        });

        if (!streamRes.ok) throw new Error("Stream failed");

        return new Response(streamRes.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Fallback if too many loops
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
    console.error("[AgentChat]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
