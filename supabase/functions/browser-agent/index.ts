import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════════════
// SITE KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════
const SITE_KNOWLEDGE: Record<string, { search_pattern: string; login_url: string; notes: string }> = {
  "indeed.com": {
    search_pattern: "https://www.indeed.com/jobs?q={query}&l={location}",
    login_url: "https://secure.indeed.com/auth",
    notes: "Largest job board. Apply flows vary: Indeed Apply (iframe) vs external redirect.",
  },
  "linkedin.com": {
    search_pattern: "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
    login_url: "https://www.linkedin.com/login",
    notes: "Requires login for full listings. Easy Apply vs external. Anti-bot aggressive.",
  },
  "glassdoor.com": {
    search_pattern: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query}",
    login_url: "https://www.glassdoor.com/profile/login_input.htm",
    notes: "Login wall after a few views. Has salary data.",
  },
  "lever.co": {
    search_pattern: "https://jobs.lever.co/{company}",
    login_url: "",
    notes: "Company-specific boards. No login needed. Clean HTML.",
  },
  "greenhouse.io": {
    search_pattern: "https://boards.greenhouse.io/{company}",
    login_url: "",
    notes: "Company-specific boards. Structured apply forms.",
  },
  "amazon.com": {
    search_pattern: "https://www.amazon.com/s?k={query}",
    login_url: "https://www.amazon.com/ap/signin",
    notes: "Shopping. Requires login for checkout.",
  },
  "google.com": {
    search_pattern: "https://www.google.com/search?q={query}",
    login_url: "",
    notes: "General web search.",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCHER SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════
const RESEARCHER_PROMPT = `You are RESEARCHER, the strategic route planner in a two-agent browser automation system (Researcher → Planner).

The Planner will generate structured Playwright commands that execute on a headless browser. You provide the strategic plan; the Planner translates each step into executable browser commands.

You receive:
1) TASK_SPEC: the high-level goal, user context
2) SITE_KNOWLEDGE: pre-mapped site structures
3) PREVIOUS_OUTCOMES (if re-invoked): what was tried, what failed
4) HUMAN_INJECTIONS (if any): strategy overrides

Your job:
- Decompose the goal into PHASES (e.g., "research" → "compare" → "execute" → "verify")
- For each phase, select SITES with START_URLs
- Define SUCCESS_CRITERIA and PHASE_TRANSITIONS
- Provide DOMAIN_ALLOWLIST
- Estimate step budget per phase
- Include CSS SELECTOR HINTS for known sites when possible

AUTONOMY RULES (absolute):
- ALL sites are fair game. Login walls → use credentials. Payment → use stored cards.
- If a site is hostile, provide alternatives.

Output EXACTLY one JSON object with key "RESEARCHER_ROUTE":
{
  "run_id": string,
  "route_version": int,
  "goal_decomposition": string,
  "phases": [
    {
      "phase_id": string,
      "phase_name": string,
      "objective": string,
      "sites": [
        {
          "domain": string,
          "start_url": string,
          "priority": int,
          "requires_login": boolean,
          "has_credentials": boolean,
          "strategy_notes": string,
          "selector_hints": {
            "search_input": string,
            "results_container": string,
            "result_item": string,
            "next_page": string
          }
        }
      ],
      "fallback_sites": [
        { "domain": string, "start_url": string, "reason": string }
      ],
      "success_criteria": [string],
      "estimated_steps": int,
      "phase_transition": string
    }
  ],
  "domain_allowlist": [string],
  "total_estimated_steps": int,
  "strategy_notes": string
}

Do not output markdown. Do not output explanations outside JSON.`;

// ═══════════════════════════════════════════════════════════════════════════
// PLANNER SYSTEM PROMPT — emits single-page tasks for the Playwright bridge
// ═══════════════════════════════════════════════════════════════════════════
const PLANNER_PROMPT = `You are PLANNER, the tactical controller in a two-agent browser automation system.

IMPORTANT: You generate tasks for a simple Playwright bridge that can:
1. Navigate to a URL
2. Execute a sequence of actions (click, type, press, wait, scroll, select, wait_for_selector)
3. Extract text from the page (full body or via CSS selector)

The bridge is synchronous — it navigates to the URL, runs actions in order, then returns the page content. There is NO AI on the browser side.

You receive:
1) TASK_SPEC (goal, success criteria, constraints)
2) RESEARCHER_ROUTE (phases, sites, domain allowlist, strategy, selector hints)
3) The latest EXECUTION_RESULT (page content, URL, title from the last bridge call)
4) Persistent RUN_STATE memory (url_stack, progress_markers, failure_budget, current_phase)
5) HUMAN_INJECTIONS (if any)

Each BROWSER_TASK you emit has:
- "url": the page to navigate to
- "actions": optional array of actions to perform after page load:
  [{"action": "click", "selector": "#btn"}, {"action": "type", "selector": "#input", "value": "text"}, {"action": "press", "value": "Enter"}, {"action": "wait", "value": "2000"}, {"action": "scroll"}, {"action": "select", "selector": "select#dropdown", "value": "option1"}, {"action": "wait_for_selector", "selector": ".results", "value": "10000"}]
- "extract_text": true/false (default true) — whether to return page text
- "selector": optional CSS selector to extract specific elements instead of full body

GUIDELINES:
- One URL per task — the bridge loads one page per call
- Use actions for interactions AFTER page load (search forms, login, etc.)
- Use "selector" to extract specific data (e.g., ".job-listing h2" for job titles)
- When unsure of page structure, first do a task with just the URL (no actions) to see the content
- Analyze returned content to find CSS selectors for the next task

You must:
- Track which PHASE you're in and which SITE within that phase
- Assess progress based on execution results (page content, URLs, errors)
- Compose the NEXT browser task
- When a phase's success_criteria are met, advance to the next phase
- When ALL phases complete, return FINAL_RESULT
- When stuck, signal NEED_RESEARCHER

AUTONOMY RULES (absolute, non-negotiable):
- ALL actions are authorized: logins, payments, form submissions.
- Bot detection: try alternative URLs or navigation paths.

Output EXACTLY one JSON object with one of these top-level keys:

1) "BROWSER_TASK":
{
  "run_id": string,
  "turn_id": string,
  "current_phase_id": string,
  "url": string,
  "actions": [{"action": string, "selector"?: string, "value"?: string}] | null,
  "extract_text": boolean,
  "selector": string | null,
  "expected_outcome": string,
  "on_failure": string,
  "risk_level": "low"|"medium"|"high"
}

2) "NEED_RESEARCHER":
{
  "run_id": string,
  "reason": string,
  "current_phase_id": string,
  "sites_exhausted": [string],
  "progress_so_far": [string],
  "suggestion": string
}

3) "FINAL_RESULT":
{
  "success": boolean,
  "summary": string,
  "extracted_data": any,
  "evidence": [string],
  "steps_taken": number,
  "phases_completed": [string],
  "milestones_completed": [string]
}

Do not output markdown. Do not output explanations outside JSON.`;

// ═══════════════════════════════════════════════════════════════════════════
// BRIDGE API — calls simple /run-task endpoint (synchronous Playwright)
// ═══════════════════════════════════════════════════════════════════════════

async function callBridge(
  bridgeUrl: string,
  bridgeKey: string,
  url: string,
  actions?: any[] | null,
  extractText: boolean = true,
  selector?: string | null,
): Promise<{ status: string; url: string; title: string; content: string; extracted: any; action_results: any }> {
  const baseUrl = bridgeUrl.replace(/\/$/, "");
  const body: any = { url, extract_text: extractText };
  if (actions && actions.length > 0) body.actions = actions;
  if (selector) body.selector = selector;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bridgeKey) headers["Authorization"] = `Bearer ${bridgeKey}`;

  const res = await fetch(`${baseUrl}/run-task`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bridge /run-task failed (${res.status}): ${err.slice(0, 500)}`);
  }

  return await res.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM CALL — OpenAI API direct
// ═══════════════════════════════════════════════════════════════════════════
const OPENAI_API = "https://api.openai.com/v1/chat/completions";

async function callLLM(
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  temperature = 0.1,
): Promise<string> {
  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 4000,
      temperature,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM call failed (${res.status}): ${err.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices[0]?.message?.content || "{}";
}

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCHER
// ═══════════════════════════════════════════════════════════════════════════
async function callResearcher(
  openaiKey: string,
  taskSpec: any,
  userContext: any,
  previousOutcomes: any | null,
  humanInjections: string[],
): Promise<any> {
  const messages = [{
    role: "user",
    content: JSON.stringify({
      TASK_SPEC: taskSpec,
      USER_CONTEXT: userContext,
      SITE_KNOWLEDGE,
      PREVIOUS_OUTCOMES: previousOutcomes,
      HUMAN_INJECTIONS: humanInjections.length > 0 ? humanInjections : null,
    }),
  }];

  const raw = await callLLM(openaiKey, RESEARCHER_PROMPT, messages, 0.2);
  try {
    const parsed = JSON.parse(raw);
    return parsed.RESEARCHER_ROUTE || parsed;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD USER CONTEXT
// ═══════════════════════════════════════════════════════════════════════════
async function buildUserContext(supabase: any, userId: string): Promise<any> {
  const [profileRes, prefsRes, connectionsRes, resumeRes, cardsRes, addressesRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).single(),
    supabase.from("job_preferences").select("*").eq("user_id", userId).single(),
    supabase.from("account_connections").select("site_key, status, username_hint").eq("user_id", userId).eq("status", "active"),
    supabase.from("resumes").select("title, skills, parsed_content").eq("user_id", userId).eq("is_primary", true).single(),
    supabase.from("payment_cards").select("card_name, cardholder_name, is_default").eq("user_id", userId),
    supabase.from("shipping_addresses").select("address_name, full_name, city, state, is_default").eq("user_id", userId),
  ]);

  return {
    profile: profileRes.data || {},
    preferences: prefsRes.data || {},
    connected_sites: (connectionsRes.data || []).map((c: any) => c.site_key),
    credentials_available_for: (connectionsRes.data || []).map((c: any) => ({ site: c.site_key, username: c.username_hint })),
    resume_summary: resumeRes.data ? { title: resumeRes.data.title, skills: resumeRes.data.skills } : null,
    has_payment_cards: (cardsRes.data || []).length > 0,
    has_shipping_addresses: (addressesRes.data || []).length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH HUMAN INJECTIONS
// ═══════════════════════════════════════════════════════════════════════════
async function fetchInjections(supabase: any, runId: string): Promise<string[]> {
  const { data: tasks } = await supabase
    .from("agent_tasks")
    .select("id, payload")
    .eq("task_type", "human_injection")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (!tasks || tasks.length === 0) return [];

  const injections: string[] = [];
  const idsToMark: string[] = [];

  for (const task of tasks) {
    const payload = task.payload as any;
    if (payload?.run_id === runId || payload?.target === "browser_agent") {
      injections.push(payload.instruction || payload.message || JSON.stringify(payload));
      idsToMark.push(task.id);
    }
  }

  if (idsToMark.length > 0) {
    await supabase
      .from("agent_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .in("id", idsToMark);
  }

  return injections;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN 2-AGENT LOOP: Researcher → Planner → (Playwright Bridge)
// ═══════════════════════════════════════════════════════════════════════════
interface TaskSpec {
  goal: string;
  success_criteria?: string[];
  hard_constraints?: string[];
  allowed_domains?: string[];
  start_url?: string;
  stop_conditions?: string[];
  context?: Record<string, any>;
}

async function runTwoAgentLoop(
  taskSpec: TaskSpec,
  userId: string,
  supabase: any,
  bridgeUrl: string,
  bridgeKey: string,
  openaiKey: string,
  firecrawlKey?: string,
): Promise<any> {
  const maxSteps = 30;
  let stepCount = 0;
  const runId = crypto.randomUUID();
  const milestones: string[] = [];
  const phasesCompleted: string[] = [];
  const urlStack: string[] = [];
  const failureBudget: Record<string, number> = {};
  let currentPhaseIndex = 0;

  const plannerHistory: { role: string; content: string }[] = [];
  const allInjections: string[] = [];

  const log = async (level: string, message: string, metadata: any = {}) => {
    console.log(`[2Agent:${level}] ${message}`);
    await supabase.from("agent_logs").insert({
      user_id: userId,
      agent_name: "browser_agent",
      log_level: level,
      message,
      metadata: { ...metadata, stepCount, runId },
    }).then(() => {}, () => {});
  };

  try {
    // ── 1. BUILD USER CONTEXT ────────────────────────────────────────
    const userContext = await buildUserContext(supabase, userId);
    await log("info", "User context loaded", {
      connected_sites: userContext.connected_sites,
      has_resume: !!userContext.resume_summary,
      has_cards: userContext.has_payment_cards,
    });

    // ── 2. RESEARCHER: generate strategic route ──────────────────────
    await log("info", "🔬 Researcher: generating route plan...");
    let researcherRoute = await callResearcher(openaiKey, taskSpec, userContext, null, []);
    if (!researcherRoute || !researcherRoute.phases || researcherRoute.phases.length === 0) {
      await log("error", "Researcher failed to produce a valid route");
      return { success: false, error: "Researcher failed to generate route plan", stepsUsed: 0 };
    }
    await log("info", `Researcher produced ${researcherRoute.phases.length} phases`, {
      phases: researcherRoute.phases.map((p: any) => p.phase_name),
      domains: researcherRoute.domain_allowlist,
      total_steps: researcherRoute.total_estimated_steps,
    });

    // ── 3. Initial page scrape if start_url provided ─────────────────
    let initialPageContent = "";
    const firstPhase = researcherRoute.phases[0];
    const startUrl = taskSpec.start_url || firstPhase?.sites?.[0]?.start_url;
    if (startUrl && firecrawlKey) {
      try {
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: startUrl, formats: ["markdown"], onlyMainContent: true }),
        });
        if (scrapeRes.ok) {
          const data = await scrapeRes.json();
          initialPageContent = data.data?.markdown || data.markdown || "";
        }
      } catch (_) {}
    }

    // Synthetic initial result for the Planner
    let lastExecutionResult: any = {
      status: "success",
      commands_executed: 0,
      result: initialPageContent.slice(0, 6000) || "Ready to start — no initial page loaded yet.",
      current_url: startUrl || null,
    };

    // ── 4. MAIN PLANNER → BRIDGE LOOP ────────────────────────────────
    while (stepCount < maxSteps) {
      stepCount++;
      const turnId = `turn_${stepCount}`;
      await log("info", `Step ${stepCount}/${maxSteps} | Phase: ${researcherRoute.phases[currentPhaseIndex]?.phase_name || "?"}`);

      // Check for human injections
      const newInjections = await fetchInjections(supabase, runId);
      if (newInjections.length > 0) {
        allInjections.push(...newInjections);
        await log("info", `📡 Human injection received: ${newInjections.length}`, { injections: newInjections });
      }

      // ── PLANNER: decide next command batch ──────────────────────
      const currentPhase = researcherRoute.phases[currentPhaseIndex] || null;
      plannerHistory.push({
        role: "user",
        content: JSON.stringify({
          TASK_SPEC: taskSpec,
          RESEARCHER_ROUTE: researcherRoute,
          CURRENT_PHASE: currentPhase,
          EXECUTION_RESULT: lastExecutionResult,
          HUMAN_INJECTIONS: newInjections.length > 0 ? newInjections : undefined,
          RUN_STATE: {
            run_id: runId,
            turn_id: turnId,
            current_phase_id: currentPhase?.phase_id || "unknown",
            current_phase_index: currentPhaseIndex,
            total_phases: researcherRoute.phases.length,
            url_stack: urlStack.slice(-15),
            progress_markers: milestones,
            phases_completed: phasesCompleted,
            failure_budget: failureBudget,
            steps_remaining: maxSteps - stepCount,
            step: stepCount,
          },
        }),
      });

      const plannerRaw = await callLLM(openaiKey, PLANNER_PROMPT, plannerHistory);
      plannerHistory.push({ role: "assistant", content: plannerRaw });

      let plannerDecision: any;
      try {
        plannerDecision = JSON.parse(plannerRaw);
      } catch {
        await log("error", "Planner produced invalid JSON", { raw: plannerRaw.slice(0, 500) });
        failureBudget["invalid_json"] = (failureBudget["invalid_json"] || 0) + 1;
        if (failureBudget["invalid_json"] >= 3) {
          return { success: false, error: "Planner repeatedly failed to produce valid JSON", stepsUsed: stepCount, milestones };
        }
        continue;
      }

      // ── FINAL_RESULT ────────────────────────────────────────────
      if (plannerDecision.FINAL_RESULT) {
        await log("info", "✅ Planner declared task complete", plannerDecision.FINAL_RESULT);
        return {
          success: plannerDecision.FINAL_RESULT.success !== false,
          finalResult: plannerDecision.FINAL_RESULT,
          stepsUsed: stepCount,
          milestones,
          phasesCompleted,
          researcherRoute,
        };
      }

      // ── NEED_RESEARCHER ─────────────────────────────────────────
      if (plannerDecision.NEED_RESEARCHER) {
        const needInfo = plannerDecision.NEED_RESEARCHER;
        await log("info", `🔬 Planner requests re-route: ${needInfo.reason}`, needInfo);

        const previousOutcomes = {
          phases_completed: phasesCompleted,
          sites_exhausted: needInfo.sites_exhausted || [],
          progress: needInfo.progress_so_far || milestones,
          failure_budget: failureBudget,
          suggestion: needInfo.suggestion,
        };

        researcherRoute = await callResearcher(openaiKey, taskSpec, userContext, previousOutcomes, allInjections);
        if (!researcherRoute || !researcherRoute.phases) {
          await log("error", "Researcher re-route failed");
          return { success: false, error: "Researcher failed on re-route", stepsUsed: stepCount, milestones };
        }

        currentPhaseIndex = 0;
        await log("info", `Researcher re-routed: ${researcherRoute.phases.length} new phases`);
        continue;
      }

      // ── BROWSER_COMMANDS — send to bridge ───────────────────────
      const browserCmds = plannerDecision.BROWSER_COMMANDS;
      if (!browserCmds || !browserCmds.commands || browserCmds.commands.length === 0) {
        await log("error", "Planner produced no commands");
        failureBudget["no_commands"] = (failureBudget["no_commands"] || 0) + 1;
        if (failureBudget["no_commands"] >= 3) {
          return { success: false, error: "Planner repeatedly failed to produce commands", stepsUsed: stepCount, milestones };
        }
        continue;
      }

      // Track phase advancement
      if (browserCmds.current_phase_id && currentPhase && browserCmds.current_phase_id !== currentPhase.phase_id) {
        const newIdx = researcherRoute.phases.findIndex((p: any) => p.phase_id === browserCmds.current_phase_id);
        if (newIdx >= 0 && newIdx !== currentPhaseIndex) {
          phasesCompleted.push(currentPhase.phase_id);
          currentPhaseIndex = newIdx;
          await log("info", `📍 Phase advanced → ${researcherRoute.phases[newIdx].phase_name}`);
        }
      }

      const cmdCount = browserCmds.commands.length;
      await log("info", `Planner → Bridge: ${cmdCount} commands`, {
        phase: currentPhase?.phase_name,
        risk: browserCmds.risk_level,
        actions: browserCmds.commands.map((c: any) => c.action),
      });

      // ── SEND TO BRIDGE ──────────────────────────────────────────
      try {
        const bridgeResult = await runBridgeCommands(
          bridgeUrl,
          bridgeKey,
          browserCmds.commands,
        );

        const resultData = bridgeResult.result || {};
        lastExecutionResult = {
          status: bridgeResult.status === "completed" || bridgeResult.status === "finished" ? "success" : "failed",
          commands_sent: cmdCount,
          commands_executed: resultData.steps_taken || 0,
          action_history: resultData.action_history || [],
          current_url: resultData.current_url || null,
          page_title: resultData.page_title || null,
          extracted_data: resultData.extracted_data || [],
          page_content: resultData.page_content || null,
          errors: resultData.errors || null,
          result: resultData.result || resultData.error || "No output",
        };

        await log("info", `Bridge → ${lastExecutionResult.status}`, {
          url: lastExecutionResult.current_url,
          commands_executed: lastExecutionResult.commands_executed,
          extracted_items: (lastExecutionResult.extracted_data || []).length,
          errors: lastExecutionResult.errors ? lastExecutionResult.errors.length : 0,
        });

        // Track URLs
        if (lastExecutionResult.current_url) {
          urlStack.push(lastExecutionResult.current_url);
        }

        if (lastExecutionResult.status === "failed") {
          failureBudget["bridge_fail"] = (failureBudget["bridge_fail"] || 0) + 1;
        }
      } catch (err: any) {
        await log("error", `Bridge call failed: ${err.message}`);
        lastExecutionResult = {
          status: "failed",
          commands_sent: cmdCount,
          result: `Bridge error: ${err.message}`,
          current_url: null,
        };
        failureBudget["bridge_error"] = (failureBudget["bridge_error"] || 0) + 1;
      }

      // Keep history manageable (last 12 exchanges)
      if (plannerHistory.length > 24) {
        plannerHistory.splice(0, 2);
      }
    }

    // Budget exhausted
    await log("warn", "Step budget exhausted", { maxSteps, milestones, phasesCompleted });
    return {
      success: false,
      error: `Step budget exhausted (${maxSteps} steps)`,
      stepsUsed: stepCount, milestones, phasesCompleted,
      researcherRoute,
      lastState: lastExecutionResult,
    };
  } catch (err: any) {
    await log("error", `Fatal error: ${err.message}`, { stack: err.stack?.slice(0, 500) });
    return { success: false, error: err.message, stepsUsed: stepCount, milestones };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BRIDGE_URL = Deno.env.get("BROWSER_USE_BRIDGE_URL");
  const BRIDGE_KEY = Deno.env.get("BROWSER_USE_BRIDGE_API_KEY") || Deno.env.get("BRIDGE_API_KEY");
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
  const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");

  if (!BRIDGE_URL) {
    return new Response(JSON.stringify({ error: "BROWSER_USE_BRIDGE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!BRIDGE_KEY) {
    return new Response(JSON.stringify({ error: "BROWSER_USE_BRIDGE_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!OPENAI_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();

    // Auth
    const authHeader = req.headers.get("Authorization");
    let userId: string;
    if (body.context?.userId) {
      userId = body.context.userId;
    } else if (authHeader) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (authError || !user) throw new Error("Unauthorized");
      userId = user.id;
    } else {
      throw new Error("No authorization");
    }

    const action = body.action || "run";

    switch (action) {
      // ── RUN (async) ────────────────────────────────────────────
      case "run": {
        const taskSpec: TaskSpec = {
          goal: body.goal || body.task,
          success_criteria: body.success_criteria || [],
          hard_constraints: body.hard_constraints || [],
          allowed_domains: body.allowed_domains || [],
          start_url: body.start_url || body.url,
          stop_conditions: body.stop_conditions || [],
          context: body.context || {},
        };

        if (!taskSpec.goal) {
          return new Response(JSON.stringify({ error: "goal is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: agentRun } = await supabase.from("agent_runs").insert({
          user_id: userId,
          run_type: "browser_agent_pw",
          status: "running",
          started_at: new Date().toISOString(),
          summary_json: { architecture: "researcher-planner-playwright" },
        }).select().single();

        const backgroundWork = async () => {
          try {
            const result = await runTwoAgentLoop(
              taskSpec, userId, supabase, BRIDGE_URL!, BRIDGE_KEY!, OPENAI_KEY!, FIRECRAWL_KEY,
            );
            await supabase.from("agent_runs").update({
              status: result.success ? "completed" : "failed",
              ended_at: new Date().toISOString(),
              summary_json: result,
              error_message: result.error || null,
            }).eq("id", agentRun?.id);
          } catch (err: any) {
            await supabase.from("agent_runs").update({
              status: "failed", ended_at: new Date().toISOString(), error_message: err.message,
            }).eq("id", agentRun?.id);
          }
        };

        if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
          (globalThis as any).EdgeRuntime.waitUntil(backgroundWork());
        } else {
          backgroundWork().catch(console.error);
        }

        return new Response(JSON.stringify({
          success: true,
          runId: agentRun?.id,
          status: "running",
          architecture: "researcher-planner-playwright",
          message: "Browser automation started. Researcher → Planner → Playwright (direct commands).",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── RUN_SYNC ───────────────────────────────────────────────
      case "run_sync": {
        const taskSpec: TaskSpec = {
          goal: body.goal || body.task,
          success_criteria: body.success_criteria || [],
          hard_constraints: body.hard_constraints || [],
          allowed_domains: body.allowed_domains || [],
          start_url: body.start_url || body.url,
          stop_conditions: body.stop_conditions || [],
          context: body.context || {},
        };

        if (!taskSpec.goal) {
          return new Response(JSON.stringify({ error: "goal is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const result = await runTwoAgentLoop(
          taskSpec, userId, supabase, BRIDGE_URL!, BRIDGE_KEY!, OPENAI_KEY!, FIRECRAWL_KEY,
        );

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── INJECT — human strategy injection mid-run ─────────────
      case "inject": {
        const runId = body.run_id;
        const instruction = body.instruction || body.message;
        const target = body.target || "browser_agent";

        if (!instruction) {
          return new Response(JSON.stringify({ error: "instruction is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: task, error: taskErr } = await supabase.from("agent_tasks").insert({
          user_id: userId,
          task_type: "human_injection",
          status: "pending",
          payload: {
            run_id: runId || null,
            target,
            instruction,
            injected_at: new Date().toISOString(),
          },
        }).select().single();

        if (taskErr) throw taskErr;

        return new Response(JSON.stringify({
          success: true,
          injection_id: task?.id,
          message: `Injection queued. The ${target === "researcher" ? "Researcher" : "Planner"} will incorporate it on the next cycle.`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ── STATUS ─────────────────────────────────────────────────
      case "status": {
        const runId = body.run_id;
        if (!runId) throw new Error("run_id required");
        const { data: run } = await supabase.from("agent_runs")
          .select("*")
          .eq("id", runId)
          .single();
        if (!run) throw new Error("Run not found");

        const { data: logs } = await supabase.from("agent_logs")
          .select("message, metadata, created_at")
          .eq("user_id", userId)
          .eq("agent_name", "browser_agent")
          .order("created_at", { ascending: false })
          .limit(20);

        return new Response(JSON.stringify({
          run,
          recentLogs: logs || [],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: any) {
    console.error("[BrowserAgent] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
