import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_USE_BASE_URL = "https://api.browser-use.com";

// Unified profile naming — shared between job-agent and auto-shop
const getProfileName = (userId: string) => `user-${userId.substring(0, 8)}`;

async function browserUseApi(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `${BROWSER_USE_BASE_URL}${path}`;
  const headers = {
    "X-Browser-Use-API-Key": apiKey,
    "Content-Type": "application/json",
    ...init.headers,
  };
  console.log(`[BrowserUse] ${init.method || "GET"} ${path}`);
  return fetch(url, { ...init, headers });
}

/**
 * JOB AGENT — Delegation Architecture
 *
 * Core principle: Our website is NOT a job scraper. It delegates intelligence
 * to ChatGPT Deep Research, which deeply analyzes the user's complete
 * professional profile and finds hyper-relevant opportunities no keyword
 * search or scraper could match.
 *
 * Actions:
 * - create_profile      : One-time Browser Use profile setup
 * - start_login         : Open live browser for user to log into ChatGPT/Gmail/etc.
 * - confirm_login       : Mark site as logged in, save profile state
 * - deep_research_jobs  : ★ THE CORE — delegate to ChatGPT Deep Research
 * - check_research      : Poll a running deep research task for completion
 * - get_status          : Profile health + recent activity
 * - cleanup_sessions    : Close stale sessions
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BROWSER_USE_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");

  if (!BROWSER_USE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "BROWSER_USE_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const action = body.action;

    const log = async (message: string, metadata: any = {}) => {
      console.log(`[JobAgent] ${message}`, metadata);
      await supabase.from("agent_logs").insert({
        user_id: user.id,
        agent_name: "job_agent",
        log_level: "info",
        message,
        metadata,
      });
    };

    switch (action) {
      // ============================================
      // CREATE PROFILE
      // ============================================
      case "create_profile": {
        await log("Creating Browser Use profile...");

        const { data: existingProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (existingProfile?.browser_use_profile_id) {
          return new Response(
            JSON.stringify({
              success: true,
              profileId: existingProfile.browser_use_profile_id,
              message: "Profile already exists",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const profileResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/profiles", {
          method: "POST",
          body: JSON.stringify({ name: getProfileName(user.id) }),
        });

        if (!profileResponse.ok) {
          const error = await profileResponse.text();
          throw new Error(`Failed to create profile (${profileResponse.status}): ${error}`);
        }

        const profileData = await profileResponse.json();
        const profileId = profileData.id;

        await supabase.from("browser_profiles").upsert({
          user_id: user.id,
          browser_use_profile_id: profileId,
          status: "created",
          sites_logged_in: [],
        });

        await log("Profile created", { profileId });

        return new Response(
          JSON.stringify({ success: true, profileId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // START LOGIN SESSION
      // ============================================
      case "start_login": {
        const { site } = body;
        await log("Starting login session...", { site });

        let { data: browserProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!browserProfile?.browser_use_profile_id) {
          await log("No profile found, creating one...");
          const profileResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/profiles", {
            method: "POST",
            body: JSON.stringify({ name: getProfileName(user.id) }),
          });
          if (!profileResponse.ok) throw new Error("Failed to create profile");
          const profileData = await profileResponse.json();
          await supabase.from("browser_profiles").upsert({
            user_id: user.id,
            browser_use_profile_id: profileData.id,
            status: "pending_login",
            sites_logged_in: [],
          });
          browserProfile = { browser_use_profile_id: profileData.id } as any;
        }

        const siteUrls: Record<string, string> = {
          chatgpt: "https://chatgpt.com",
          gmail: "https://mail.google.com",
          linkedin: "https://www.linkedin.com/login",
          indeed: "https://secure.indeed.com/account/login",
          glassdoor: "https://www.glassdoor.com/member/login",
        };

        const startUrl = siteUrls[site] || `https://${site}.com`;

        const sessionResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            profileId: browserProfile!.browser_use_profile_id,
            startUrl,
          }),
        });

        if (!sessionResponse.ok) {
          const error = await sessionResponse.text();
          throw new Error(`Session failed (${sessionResponse.status}): ${error}`);
        }

        const sessionData = await sessionResponse.json();

        await supabase
          .from("browser_profiles")
          .update({
            pending_login_site: site,
            pending_session_id: sessionData.id,
            status: "pending_login",
          })
          .eq("user_id", user.id);

        await log("Login session started", { site, sessionId: sessionData.id });

        return new Response(
          JSON.stringify({
            success: true,
            sessionId: sessionData.id,
            liveViewUrl: sessionData.liveUrl,
            site,
            message: `Browser opened for ${site}. Log in to save your session.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // CONFIRM LOGIN
      // ============================================
      case "confirm_login": {
        const { site } = body;

        const { data: profile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!profile) throw new Error("No profile found");

        if (profile.pending_session_id) {
          try {
            await browserUseApi(
              BROWSER_USE_API_KEY,
              `/api/v2/sessions/${profile.pending_session_id}`,
              { method: "PATCH", body: JSON.stringify({ action: "stop" }) }
            );
            await log("Session stopped, profile state saved");
          } catch (e) {
            console.error("Failed to stop session:", e);
          }
        }

        const sitesLoggedIn = [...new Set([...(profile.sites_logged_in || []), site])];

        await supabase
          .from("browser_profiles")
          .update({
            sites_logged_in: sitesLoggedIn,
            pending_login_site: null,
            pending_session_id: null,
            pending_task_id: null,
            last_login_at: new Date().toISOString(),
            status: "active",
          })
          .eq("user_id", user.id);

        await log("Login confirmed", { site, allSites: sitesLoggedIn });

        return new Response(
          JSON.stringify({ success: true, sitesLoggedIn }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // ★ DEEP RESEARCH JOBS — The Core Pipeline
      //
      // This is NOT a simple job scraper. The agent navigates to ChatGPT,
      // selects Deep Research mode, and provides the user's complete
      // professional profile. ChatGPT Deep Research then searches the web
      // exhaustively — analyzing compatibility at a deep level that no
      // keyword search could achieve.
      // ============================================
      case "deep_research_jobs": {
        await log("🔬 Starting ChatGPT Deep Research job search...");

        // 1. Validate ChatGPT is connected
        const { data: browserProfile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!browserProfile?.browser_use_profile_id) {
          throw new Error("No browser profile. Please set up your accounts first.");
        }

        if (!browserProfile.sites_logged_in?.includes("chatgpt")) {
          throw new Error(
            "ChatGPT is not connected. Please log in to ChatGPT first — it's required for Deep Research."
          );
        }

        // 2. Gather the user's complete professional identity
        const { data: userProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const { data: resume } = await supabase
          .from("resumes")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_primary", true)
          .single();

        if (!resume) {
          throw new Error("No resume found. Please upload your resume first.");
        }

        const { data: jobPrefs } = await supabase
          .from("job_preferences")
          .select("*")
          .eq("user_id", user.id)
          .single();

        // 3. Extract the fullest possible resume text
        const parsed = resume.parsed_content || {};
        const possibleTexts = [
          parsed?.rawText,
          parsed?.fullText,
          parsed?.text,
          parsed?.content,
          parsed?.resume_text,
          typeof parsed === "string" ? parsed : null,
        ].filter(Boolean);
        const fullResumeText =
          possibleTexts.sort((a: any, b: any) => (b?.length || 0) - (a?.length || 0))[0] || "";

        const skillsList = (resume.skills || []).join(", ");
        const experienceYears = resume.experience_years || 0;
        const atsScore = resume.ats_score;

        const targetTitles = jobPrefs?.job_titles?.join(", ") || "Not specified";
        const targetLocations = jobPrefs?.locations?.join(", ") || "Remote / Anywhere";
        const remotePreference = jobPrefs?.remote_preference || "any";
        const salaryMin = jobPrefs?.salary_min;
        const salaryMax = jobPrefs?.salary_max;
        const industries = jobPrefs?.industries?.join(", ") || "Any";
        const excludedCompanies = jobPrefs?.excluded_companies?.join(", ") || "None";

        // 4. Craft the Deep Research prompt
        // This is the most critical part — it must convey the full professional
        // identity so ChatGPT Deep Research understands WHO this person is at
        // a deep level before searching the web.
        const deepResearchPrompt = `I need you to conduct a comprehensive deep research to find job opportunities that are deeply compatible with the following professional profile. Do NOT just do a keyword search — analyze the person's complete background, career trajectory, skill combinations, and experience level to find roles where they would truly be an excellent fit.

═══════════════════════════════════════
COMPLETE PROFESSIONAL PROFILE
═══════════════════════════════════════

FULL RESUME:
${fullResumeText || "No detailed text available"}

EXTRACTED SKILLS: ${skillsList || "Not extracted"}
YEARS OF EXPERIENCE: ${experienceYears}
${atsScore ? `ATS SCORE: ${atsScore}/100` : ""}

PERSONAL INFO:
- Name: ${userProfile?.first_name || ""} ${userProfile?.last_name || ""}
- Location: ${userProfile?.location || "Not specified"}
${userProfile?.linkedin_url ? `- LinkedIn: ${userProfile.linkedin_url}` : ""}

═══════════════════════════════════════
JOB SEARCH PREFERENCES
═══════════════════════════════════════

- Target Roles: ${targetTitles}
- Preferred Locations: ${targetLocations}
- Remote Preference: ${remotePreference}
${salaryMin ? `- Minimum Salary: $${salaryMin.toLocaleString()}` : ""}
${salaryMax ? `- Maximum Salary: $${salaryMax.toLocaleString()}` : ""}
- Industries of Interest: ${industries}
- Companies to Exclude: ${excludedCompanies}

═══════════════════════════════════════
RESEARCH INSTRUCTIONS
═══════════════════════════════════════

1. DEEPLY ANALYZE the resume above. Understand the career arc, the progression of responsibilities, the unique combination of skills, domain expertise, and the seniority level.

2. SEARCH THE WEB thoroughly for current job openings (posted within the last 30 days) that align with this person's complete profile. Look across:
   - Major job boards (LinkedIn, Indeed, Glassdoor)
   - Company career pages
   - Startup job boards (Wellfound, Y Combinator Work at a Startup)
   - Industry-specific job boards
   - Remote job boards if applicable

3. EVALUATE each job opportunity for deep compatibility:
   - Does the role match the person's experience LEVEL? (Don't suggest junior roles for senior professionals or vice versa)
   - Does the skill overlap go beyond surface keywords?
   - Is the company culture/size likely a good fit based on their career history?
   - Is the compensation range appropriate for their experience?

4. Return EXACTLY this JSON format with 15-25 of the BEST matches:
{
  "research_summary": "A 2-3 sentence summary of your research findings and the job market landscape for this candidate",
  "candidate_analysis": "A brief analysis of the candidate's strongest qualifications and unique selling points",
  "jobs": [
    {
      "title": "Exact job title",
      "company": "Company name",
      "location": "City, State or Remote",
      "url": "Direct application URL",
      "salary_range": "e.g. $120k-$160k or null if not listed",
      "match_score": 85,
      "match_reason": "2-3 sentences explaining WHY this is a deep match — what specific aspects of their background make them uniquely qualified",
      "key_requirements": ["requirement1", "requirement2", "requirement3"],
      "posted_date": "When the job was posted, if available",
      "job_type": "full-time/contract/part-time"
    }
  ],
  "market_insights": "Any relevant observations about the job market for this candidate's profile"
}

CRITICAL: Only include jobs where match_score >= 70. Quality over quantity. Each match_reason must reference SPECIFIC parts of the resume that align with SPECIFIC job requirements.`;

        // 5. Build the Browser Use agent instruction
        // The agent navigates ChatGPT, selects Deep Research, inputs the prompt,
        // waits for completion, and extracts the output
        const agentInstruction = `You are an automation agent. Your ONLY job is to interact with ChatGPT to run a Deep Research query and bring back the results. Follow these steps EXACTLY:

STEP 1: Navigate to https://chatgpt.com
- You should already be logged in via the saved profile
- If you see a login page, try refreshing. If still not logged in, report failure.

STEP 2: Start a NEW chat
- Click on "New chat" or the compose button to start a fresh conversation
- Wait for the chat input to be ready

STEP 3: Select Deep Research mode
- Look for the model selector / dropdown (it may say "ChatGPT" or show a model name)
- Click on it and select "Deep Research" from the available options
- If Deep Research is not available, look for "Research" or similar option
- Confirm Deep Research mode is active before proceeding

STEP 4: Enter the research prompt
- Click on the message input field
- Paste the following prompt EXACTLY (do not modify it):

---START PROMPT---
${deepResearchPrompt}
---END PROMPT---

STEP 5: Submit and wait
- Press Enter or click Send to submit the prompt
- Deep Research takes several minutes to complete (typically 3-10 minutes)
- Wait patiently — DO NOT click anything else while it's researching
- You'll see a progress indicator showing the research is ongoing
- Wait until the FULL response has been generated and displayed

STEP 6: Extract the output
- Once the research is complete, the response will contain a JSON block
- Select ALL the text in the response
- Copy it exactly as displayed
- Return the COMPLETE response text as your task output

IMPORTANT:
- Do NOT interrupt the Deep Research while it's running
- Do NOT start a new message before the research completes
- If you encounter any errors or the research fails, report the exact error
- The research may take up to 10 minutes — this is normal for Deep Research
- Make sure to capture the ENTIRE response, including the JSON block`;

        // 6. Create agent run record
        const { data: run } = await supabase
          .from("agent_runs")
          .insert({
            user_id: user.id,
            run_type: "deep_research",
            status: "running",
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        // 7. Create Browser Use session with the ChatGPT-authenticated profile
        const sessionResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            profileId: browserProfile.browser_use_profile_id,
          }),
        });

        if (!sessionResponse.ok) {
          const error = await sessionResponse.text();
          await supabase
            .from("agent_runs")
            .update({ status: "failed", error_message: `Session creation failed: ${error}` })
            .eq("id", run?.id);
          throw new Error(`Failed to create session: ${error}`);
        }

        const sessionData = await sessionResponse.json();

        // 8. Create the task
        const taskResponse = await browserUseApi(BROWSER_USE_API_KEY, "/api/v2/tasks", {
          method: "POST",
          body: JSON.stringify({
            task: agentInstruction,
            sessionId: sessionData.id,
            maxSteps: 50,
          }),
        });

        if (!taskResponse.ok) {
          const error = await taskResponse.text();
          await supabase
            .from("agent_runs")
            .update({ status: "failed", error_message: `Task creation failed: ${error}` })
            .eq("id", run?.id);
          throw new Error(`Failed to create task: ${error}`);
        }

        const taskData = await taskResponse.json();

        // 9. Store references for polling
        await supabase
          .from("agent_runs")
          .update({
            summary_json: {
              browser_use_task_id: taskData.id,
              session_id: sessionData.id,
              pipeline: "deep_research",
              resume_skills: resume.skills,
              resume_experience: experienceYears,
            },
          })
          .eq("id", run?.id);

        await log("Deep Research task dispatched", {
          runId: run?.id,
          taskId: taskData.id,
          sessionId: sessionData.id,
          resumeTextLength: fullResumeText.length,
          skillsCount: (resume.skills || []).length,
        });

        return new Response(
          JSON.stringify({
            success: true,
            runId: run?.id,
            taskId: taskData.id,
            sessionId: sessionData.id,
            message:
              "Deep Research is running. ChatGPT is analyzing your profile and searching the web for deeply compatible jobs. This typically takes 5-10 minutes.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // CHECK RESEARCH — Poll a running deep research task
      // ============================================
      case "check_research": {
        const { runId } = body;

        if (!runId) throw new Error("runId is required");

        const { data: run } = await supabase
          .from("agent_runs")
          .select("*")
          .eq("id", runId)
          .eq("user_id", user.id)
          .single();

        if (!run) throw new Error("Run not found");

        const summary = run.summary_json as any;
        if (!summary?.browser_use_task_id) {
          throw new Error("No task associated with this run");
        }

        // Check task status in Browser Use
        const taskResponse = await browserUseApi(
          BROWSER_USE_API_KEY,
          `/api/v2/tasks/${summary.browser_use_task_id}`,
          { method: "GET" }
        );

        if (!taskResponse.ok) {
          throw new Error("Failed to check task status");
        }

        const taskData = await taskResponse.json();
        const taskStatus = taskData.status; // started | paused | finished | stopped

        if (taskStatus === "started" || taskStatus === "paused") {
          // Still running
          const stepCount = taskData.steps?.length || 0;
          return new Response(
            JSON.stringify({
              success: true,
              status: "running",
              stepCount,
              message: `Deep Research in progress... (${stepCount} steps completed)`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (taskStatus === "finished") {
          const output = taskData.output || "";

          // Try to parse the JSON from the output
          let parsedJobs: any = null;
          try {
            // Look for JSON in the output — it could be wrapped in markdown code blocks
            const jsonMatch = output.match(/\{[\s\S]*"jobs"\s*:\s*\[[\s\S]*\]\s*[\s\S]*\}/);
            if (jsonMatch) {
              parsedJobs = JSON.parse(jsonMatch[0]);
            }
          } catch (e) {
            console.error("Failed to parse Deep Research output JSON:", e);
          }

          // Store jobs in the database if we got valid results
          let jobsStored = 0;
          if (parsedJobs?.jobs && Array.isArray(parsedJobs.jobs)) {
            for (const job of parsedJobs.jobs) {
              try {
                await supabase.from("jobs").insert({
                  user_id: user.id,
                  title: job.title || "Untitled",
                  company: job.company || "Unknown",
                  location: job.location || null,
                  url: job.url || null,
                  match_score: job.match_score || null,
                  description: job.match_reason || null,
                  requirements: job.key_requirements || [],
                  salary_min: job.salary_range
                    ? parseInt(job.salary_range.replace(/[^0-9]/g, "")) * 1000 || null
                    : null,
                  source: "deep_research",
                  job_type: job.job_type || "full-time",
                  posted_at: job.posted_date || null,
                });
                jobsStored++;
              } catch (e) {
                console.error("Failed to store job:", e);
              }
            }
          }

          // Update run as completed
          await supabase
            .from("agent_runs")
            .update({
              status: "completed",
              ended_at: new Date().toISOString(),
              summary_json: {
                ...summary,
                research_output: parsedJobs,
                raw_output_length: output.length,
                jobs_stored: jobsStored,
                is_success: taskData.isSuccess,
              },
            })
            .eq("id", runId);

          // Stop the session
          if (summary.session_id) {
            try {
              await browserUseApi(
                BROWSER_USE_API_KEY,
                `/api/v2/sessions/${summary.session_id}`,
                { method: "PATCH", body: JSON.stringify({ action: "stop" }) }
              );
            } catch (e) {
              console.error("Failed to stop session:", e);
            }
          }

          await log("Deep Research completed", {
            runId,
            jobsFound: parsedJobs?.jobs?.length || 0,
            jobsStored,
            isSuccess: taskData.isSuccess,
          });

          return new Response(
            JSON.stringify({
              success: true,
              status: "completed",
              jobsFound: parsedJobs?.jobs?.length || 0,
              jobsStored,
              researchSummary: parsedJobs?.research_summary || null,
              candidateAnalysis: parsedJobs?.candidate_analysis || null,
              marketInsights: parsedJobs?.market_insights || null,
              rawOutput: output.substring(0, 500), // preview
              message: `Deep Research complete! Found ${parsedJobs?.jobs?.length || 0} deeply matched jobs.`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Task stopped/failed
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            ended_at: new Date().toISOString(),
            error_message: `Task ${taskStatus}`,
            summary_json: { ...summary, raw_output: taskData.output || "" },
          })
          .eq("id", runId);

        return new Response(
          JSON.stringify({
            success: false,
            status: "failed",
            message: `Research task ${taskStatus}. The agent may have encountered an issue.`,
            rawOutput: taskData.output || null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // GET STATUS
      // ============================================
      case "get_status": {
        const { data: profile } = await supabase
          .from("browser_profiles")
          .select("*")
          .eq("user_id", user.id)
          .single();

        const { data: recentRuns } = await supabase
          .from("agent_runs")
          .select("*")
          .eq("user_id", user.id)
          .in("run_type", ["job_agent", "deep_research"])
          .order("created_at", { ascending: false })
          .limit(5);

        const { data: recentJobs } = await supabase
          .from("jobs")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        const { data: recentApps } = await supabase
          .from("applications")
          .select("*, jobs(*)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        // Check for any running research tasks
        const activeRun = recentRuns?.find(
          (r: any) => r.status === "running" && r.run_type === "deep_research"
        );

        return new Response(
          JSON.stringify({
            success: true,
            profile: {
              hasProfile: !!profile?.browser_use_profile_id,
              sitesLoggedIn: profile?.sites_logged_in || [],
              lastLoginAt: profile?.last_login_at,
              status: profile?.status || "not_setup",
            },
            recentRuns,
            recentJobs,
            recentApplications: recentApps,
            activeResearch: activeRun
              ? { runId: activeRun.id, status: activeRun.status }
              : null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ============================================
      // CLEANUP SESSIONS
      // ============================================
      case "cleanup_sessions": {
        await log("Cleaning up active Browser Use sessions...");

        const listResponse = await browserUseApi(
          BROWSER_USE_API_KEY,
          "/api/v2/sessions?filterBy=active",
          { method: "GET" }
        );

        if (!listResponse.ok) {
          throw new Error(`Failed to list sessions: ${await listResponse.text()}`);
        }

        const sessionsData = await listResponse.json();
        const activeSessions = sessionsData.items || [];

        let closedCount = 0;
        for (const session of activeSessions) {
          try {
            await browserUseApi(BROWSER_USE_API_KEY, `/api/v2/sessions/${session.id}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "stop" }),
            });
            closedCount++;
          } catch (e) {
            console.error(`Failed to close session ${session.id}:`, e);
          }
        }

        await supabase
          .from("browser_profiles")
          .update({ pending_session_id: null, pending_task_id: null })
          .eq("user_id", user.id);

        await log("Sessions cleaned up", { closedCount });

        return new Response(
          JSON.stringify({
            success: true,
            closedCount,
            message: `Closed ${closedCount} active session(s).`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    console.error("[JobAgent] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
