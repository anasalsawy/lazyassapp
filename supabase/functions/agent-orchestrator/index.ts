import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AgentTask {
  id: string;
  user_id: string;
  task_type: string;
  status: string;
  payload: any;
  result: any;
}

// Agent definitions
const AGENTS = {
  resume_agent: {
    name: "Resume Agent",
    description: "Analyzes and optimizes resumes for ATS compatibility",
    capabilities: ["analyze_resume", "optimize_resume", "extract_skills", "generate_pdf"],
  },
  job_agent: {
    name: "Job Search Agent", 
    description: "Scrapes and matches jobs from multiple boards",
    capabilities: ["scrape_jobs", "match_jobs", "score_jobs", "filter_jobs"],
  },
  application_agent: {
    name: "Application Agent",
    description: "Automates job application submissions",
    capabilities: ["prepare_application", "submit_application", "track_status"],
  },
  cover_letter_agent: {
    name: "Cover Letter Agent",
    description: "Generates personalized cover letters",
    capabilities: ["generate_cover_letter", "customize_letter", "match_keywords"],
  },
  email_agent: {
    name: "Email Agent",
    description: "Manages email communications with recruiters",
    capabilities: ["check_inbox", "analyze_email", "draft_reply", "send_reply"],
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Get user from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { action, taskType, payload } = await req.json();

    // Log orchestrator activity
    const logAgent = async (agentName: string, message: string, metadata: any = {}, taskId?: string) => {
      await supabase.from("agent_logs").insert({
        user_id: user.id,
        task_id: taskId,
        agent_name: agentName,
        log_level: "info",
        message,
        metadata,
      });
    };

    await logAgent("orchestrator", `Received action: ${action}`, { taskType, payload });

    switch (action) {
      case "start_workflow": {
        // Create a comprehensive job search workflow
        const tasks = [];
        
        // 1. First analyze resume if user has one
        const { data: resumes } = await supabase
          .from("resumes")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_primary", true)
          .single();

        if (resumes) {
          const { data: resumeTask } = await supabase
            .from("agent_tasks")
            .insert({
              user_id: user.id,
              task_type: "analyze_resume",
              status: "pending",
              priority: 1,
              payload: { resume_id: resumes.id },
            })
            .select()
            .single();
          tasks.push(resumeTask);
        }

        // 2. Get job preferences and scrape jobs
        const { data: preferences } = await supabase
          .from("job_preferences")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (preferences) {
          const { data: scrapeTask } = await supabase
            .from("agent_tasks")
            .insert({
              user_id: user.id,
              task_type: "scrape_jobs",
              status: "pending",
              priority: 2,
              payload: { preferences },
            })
            .select()
            .single();
          tasks.push(scrapeTask);
        }

        await logAgent("orchestrator", "Workflow started", { task_count: tasks.length });

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Workflow started",
            tasks,
            agents: AGENTS 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "execute_task": {
        const { taskId } = payload;
        
        // Get the task
        const { data: task, error: taskError } = await supabase
          .from("agent_tasks")
          .select("*")
          .eq("id", taskId)
          .eq("user_id", user.id)
          .single();

        if (taskError || !task) {
          throw new Error("Task not found");
        }

        // Update task status to in_progress
        await supabase
          .from("agent_tasks")
          .update({ status: "in_progress", started_at: new Date().toISOString() })
          .eq("id", taskId);

        // Route to appropriate agent
        let result;
        let agentName;

        switch (task.task_type) {
          case "analyze_resume":
            agentName = "resume_agent";
            result = await executeResumeAgent(supabase, user.id, task.payload);
            break;
          case "scrape_jobs":
            agentName = "job_agent";
            result = await executeJobAgent(supabase, user.id, task.payload);
            break;
          case "generate_cover_letter":
            agentName = "cover_letter_agent";
            result = await executeCoverLetterAgent(supabase, user.id, task.payload);
            break;
          case "submit_application":
            agentName = "application_agent";
            result = await executeApplicationAgent(supabase, user.id, task.payload);
            break;
          case "check_email":
            agentName = "email_agent";
            result = await executeEmailAgent(supabase, user.id, task.payload);
            break;
          default:
            throw new Error(`Unknown task type: ${task.task_type}`);
        }

        // Update task with result
        await supabase
          .from("agent_tasks")
          .update({ 
            status: "completed", 
            result, 
            completed_at: new Date().toISOString() 
          })
          .eq("id", taskId);

        await logAgent(agentName!, "Task completed", { taskId, result }, taskId);

        return new Response(
          JSON.stringify({ success: true, result }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_status": {
        // Get all pending and in-progress tasks
        const { data: tasks } = await supabase
          .from("agent_tasks")
          .select("*")
          .eq("user_id", user.id)
          .in("status", ["pending", "in_progress"])
          .order("priority", { ascending: true });

        const { data: logs } = await supabase
          .from("agent_logs")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20);

        return new Response(
          JSON.stringify({ success: true, tasks, logs, agents: AGENTS }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "auto_apply": {
        // Get automation settings
        const { data: settings } = await supabase
          .from("automation_settings")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (!settings?.auto_apply_enabled) {
          return new Response(
            JSON.stringify({ success: false, error: "Auto-apply is not enabled" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (settings.applications_today >= settings.daily_apply_limit) {
          return new Response(
            JSON.stringify({ success: false, error: "Daily apply limit reached" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get eligible jobs
        const { data: jobs } = await supabase
          .from("jobs")
          .select("*")
          .eq("user_id", user.id)
          .gte("match_score", settings.min_match_score)
          .not("id", "in", `(SELECT job_id FROM applications WHERE user_id = '${user.id}')`)
          .order("match_score", { ascending: false })
          .limit(settings.daily_apply_limit - settings.applications_today);

        // Create application tasks for each job
        const applicationTasks = [];
        for (const job of jobs || []) {
          const { data: task } = await supabase
            .from("agent_tasks")
            .insert({
              user_id: user.id,
              task_type: "submit_application",
              status: "pending",
              priority: 3,
              payload: { job_id: job.id, require_cover_letter: settings.require_cover_letter },
            })
            .select()
            .single();
          applicationTasks.push(task);
        }

        await logAgent("orchestrator", "Auto-apply workflow initiated", { 
          jobs_count: jobs?.length || 0,
          tasks_created: applicationTasks.length 
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: `Created ${applicationTasks.length} application tasks`,
            tasks: applicationTasks 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    console.error("Orchestrator error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Resume Agent - Analyzes and optimizes resumes
async function executeResumeAgent(supabase: any, userId: string, payload: any) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const { resume_id } = payload;
  
  // Get resume
  const { data: resume } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", resume_id)
    .single();

  if (!resume) throw new Error("Resume not found");

  const resumeText = resume.parsed_content?.text || "";

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { 
          role: "system", 
          content: `You are the Resume Agent, an expert at analyzing and optimizing resumes for ATS systems.
          
Analyze the resume and return a JSON object with:
{
  "atsScore": number (0-100),
  "strengths": string[],
  "improvements": string[],
  "skills": string[],
  "experienceYears": number,
  "experienceSummary": string,
  "optimizedBullets": string[],
  "keywordDensity": { keyword: string, count: number }[],
  "formattingIssues": string[],
  "missingKeywords": string[]
}` 
        },
        { role: "user", content: `Analyze this resume:\n\n${resumeText}` },
      ],
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  
  let analysis;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[0]);
    }
  } catch {
    analysis = { error: "Failed to parse analysis", raw: content };
  }

  // Update resume with analysis
  await supabase
    .from("resumes")
    .update({
      ats_score: analysis.atsScore || 0,
      skills: analysis.skills || [],
      experience_years: analysis.experienceYears || 0,
      parsed_content: { ...resume.parsed_content, analysis },
    })
    .eq("id", resume_id);

  return analysis;
}

// Job Agent - Scrapes and matches jobs
async function executeJobAgent(supabase: any, userId: string, payload: any) {
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const { preferences } = payload;
  const jobTitles = preferences.job_titles || ["Software Engineer"];
  const locations = preferences.locations || ["Remote"];
  
  const scrapedJobs: any[] = [];

  // Scrape jobs from multiple sources using Firecrawl
  for (const title of jobTitles.slice(0, 3)) {
    for (const location of locations.slice(0, 2)) {
      const searchQuery = `${title} ${location} jobs`;
      
      // Use Firecrawl to search for jobs
      const searchResponse = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: searchQuery,
          limit: 10,
          scrapeOptions: { formats: ["markdown"] },
        }),
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        
        if (searchData.data) {
          for (const result of searchData.data) {
            scrapedJobs.push({
              url: result.url,
              title: result.title,
              content: result.markdown?.substring(0, 2000) || result.description,
              source: new URL(result.url).hostname,
            });
          }
        }
      }
    }
  }

  // Use AI to extract and score jobs
  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are the Job Agent. Extract job details from scraped content and score them based on user preferences.

User preferences:
- Job Titles: ${preferences.job_titles?.join(", ") || "Any"}
- Locations: ${preferences.locations?.join(", ") || "Any"}
- Remote: ${preferences.remote_preference || "any"}
- Salary Range: ${preferences.salary_min || "Not specified"} - ${preferences.salary_max || "Not specified"}
- Industries: ${preferences.industries?.join(", ") || "Any"}

Return a JSON array of jobs:
[{
  "title": string,
  "company": string,
  "location": string,
  "salaryMin": number | null,
  "salaryMax": number | null,
  "description": string (brief, 2-3 sentences),
  "requirements": string[],
  "jobType": "full-time" | "part-time" | "contract" | "remote",
  "matchScore": number (0-100),
  "matchReasons": string[],
  "url": string,
  "source": string
}]`,
        },
        {
          role: "user",
          content: `Extract jobs from this scraped data:\n\n${JSON.stringify(scrapedJobs)}`,
        },
      ],
      temperature: 0.3,
    }),
  });

  const aiData = await aiResponse.json();
  const content = aiData.choices?.[0]?.message?.content;

  let jobs: any[] = [];
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jobs = JSON.parse(jsonMatch[0]);
    }
  } catch {
    console.error("Failed to parse jobs:", content);
  }

  // Save jobs to database
  for (const job of jobs) {
    await supabase.from("jobs").upsert({
      user_id: userId,
      external_id: job.url,
      source: job.source || "firecrawl",
      title: job.title,
      company: job.company,
      location: job.location,
      salary_min: job.salaryMin,
      salary_max: job.salaryMax,
      description: job.description,
      requirements: job.requirements,
      job_type: job.jobType,
      match_score: job.matchScore,
      url: job.url,
      posted_at: new Date().toISOString(),
    }, { onConflict: "user_id,external_id" });
  }

  return { jobs_found: jobs.length, jobs };
}

// Cover Letter Agent
async function executeCoverLetterAgent(supabase: any, userId: string, payload: any) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const { job_id, resume_id } = payload;

  const { data: job } = await supabase.from("jobs").select("*").eq("id", job_id).single();
  const { data: resume } = await supabase.from("resumes").select("*").eq("id", resume_id).single();

  if (!job || !resume) throw new Error("Job or resume not found");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are the Cover Letter Agent. Generate compelling, personalized cover letters.
          
Guidelines:
- Keep it 3-4 paragraphs, under 400 words
- Match keywords from the job description
- Highlight relevant experience from the resume
- Show genuine enthusiasm for the specific role
- Include quantifiable achievements
- Avoid generic phrases like "I am writing to apply"`,
        },
        {
          role: "user",
          content: `Generate a cover letter for:

Job: ${job.title} at ${job.company}
Description: ${job.description}
Requirements: ${job.requirements?.join(", ")}

Resume Summary: ${resume.parsed_content?.text?.substring(0, 1500)}
Skills: ${resume.skills?.join(", ")}`,
        },
      ],
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  return { cover_letter: data.choices?.[0]?.message?.content };
}

// Application Agent - Handles job application submission
async function executeApplicationAgent(supabase: any, userId: string, payload: any) {
  const { job_id, require_cover_letter } = payload;

  // Get job, resume, and user profile
  const { data: job } = await supabase.from("jobs").select("*").eq("id", job_id).single();
  const { data: resume } = await supabase.from("resumes").select("*").eq("user_id", userId).eq("is_primary", true).single();
  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", userId).single();

  if (!job) throw new Error("Job not found");

  let coverLetter = null;
  if (require_cover_letter && resume) {
    const coverLetterResult = await executeCoverLetterAgent(supabase, userId, { job_id, resume_id: resume.id });
    coverLetter = coverLetterResult.cover_letter;
  }

  // Create the application record
  const { data: application, error } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      job_id: job_id,
      resume_id: resume?.id,
      status: "applied",
      cover_letter: coverLetter,
      notes: `Auto-applied by Application Agent. Match score: ${job.match_score}%`,
    })
    .select()
    .single();

  if (error) throw error;

  // Update automation settings
  await supabase.rpc("increment_applications_today", { user_id_input: userId }).catch(() => {
    // If RPC doesn't exist, update directly
    supabase
      .from("automation_settings")
      .update({ 
        applications_today: supabase.raw("applications_today + 1"),
        last_auto_apply_at: new Date().toISOString() 
      })
      .eq("user_id", userId);
  });

  return {
    success: true,
    application_id: application.id,
    job: { title: job.title, company: job.company },
    cover_letter_generated: !!coverLetter,
    message: `Successfully applied to ${job.title} at ${job.company}`,
  };
}

// Email Agent - Handles email communications
async function executeEmailAgent(supabase: any, userId: string, payload: any) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const { action: emailAction } = payload;

  switch (emailAction) {
    case "analyze_emails": {
      // Get unread emails
      const { data: emails } = await supabase
        .from("incoming_emails")
        .select("*")
        .eq("user_id", userId)
        .is("ai_summary", null)
        .limit(10);

      for (const email of emails || []) {
        // Analyze each email with AI
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: `You are the Email Agent. Analyze recruiter emails and extract insights.

Return JSON:
{
  "summary": string (2-3 sentences),
  "sentiment": "positive" | "neutral" | "negative" | "rejection" | "interview_request",
  "suggestedReply": string (if response needed),
  "actionItems": string[],
  "isUrgent": boolean
}`,
              },
              {
                role: "user",
                content: `Analyze this email:
From: ${email.from_name} <${email.from_email}>
Subject: ${email.subject}
Body: ${email.body_text}`,
              },
            ],
            temperature: 0.3,
          }),
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            await supabase
              .from("incoming_emails")
              .update({
                ai_summary: analysis.summary,
                ai_sentiment: analysis.sentiment,
                ai_suggested_reply: analysis.suggestedReply,
              })
              .eq("id", email.id);
          }
        } catch {
          console.error("Failed to parse email analysis");
        }
      }

      return { analyzed: emails?.length || 0 };
    }

    default:
      return { message: "Email agent action not implemented" };
  }
}
