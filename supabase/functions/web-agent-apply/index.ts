import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ApplicationPayload {
  jobId: string;
  jobUrl: string;
  jobTitle: string;
  company: string;
  resumeData: {
    skills: string[];
    experience_years: number;
    parsed_content: any;
  };
  coverLetter?: string;
  userProfile: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    linkedin?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const BROWSER_USE_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!BROWSER_USE_API_KEY) {
      throw new Error("BROWSER_USE_API_KEY is not configured. Please add your Browser Use API key.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const payload: ApplicationPayload = await req.json();
    const { jobId, jobUrl, jobTitle, company, resumeData, coverLetter, userProfile } = payload;

    if (!jobUrl) {
      throw new Error("Job URL is required for AI web agent application");
    }

    console.log(`[WebAgent] Starting Browser Use application for: ${jobTitle} at ${company}`);
    console.log(`[WebAgent] Target URL: ${jobUrl}`);

    // Generate a unique email alias for this application using Mailgun
    let applicationEmail = userProfile.email;
    const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");
    
    if (MAILGUN_DOMAIN) {
      const shortId = jobId.substring(0, 8);
      const timestamp = Date.now().toString(36);
      const companySlug = company 
        ? company.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10)
        : 'app';
      applicationEmail = `apply-${companySlug}-${shortId}-${timestamp}@${MAILGUN_DOMAIN}`;
      
      console.log(`[WebAgent] Using Mailgun email alias: ${applicationEmail}`);
      
      // Store the email alias for tracking
      await supabase.from("email_accounts").upsert({
        user_id: user.id,
        email_address: applicationEmail,
        email_provider: "mailgun",
        is_active: true,
      }, { onConflict: "user_id,email_address" }).select();
    }

    // Log the start of the web agent task
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "web_agent",
      log_level: "info",
      message: `Starting Browser Use application: ${jobTitle} at ${company}`,
      metadata: { jobId, jobUrl, jobTitle, company },
    });

    // Create an agent task to track progress
    const { data: task, error: taskError } = await supabase
      .from("agent_tasks")
      .insert({
        user_id: user.id,
        task_type: "web_agent_apply",
        status: "running",
        payload: {
          jobId,
          jobUrl,
          jobTitle,
          company,
          userProfile,
          hasResume: !!resumeData,
          hasCoverLetter: !!coverLetter,
        },
      })
      .select()
      .single();

    if (taskError) {
      console.error("[WebAgent] Failed to create task:", taskError);
    }

    // Build the natural language instruction for the AI agent
    const agentInstruction = buildAgentInstruction({ 
      ...payload, 
      userProfile: { ...userProfile, email: applicationEmail } 
    });

    console.log(`[WebAgent] Sending task to Browser Use Cloud...`);

    // Call Browser Use Cloud API v2
    const browserUseResponse = await fetch("https://api.browser-use.com/api/v2/tasks", {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: agentInstruction,
        startUrl: jobUrl,
        llm: "browser-use-llm",
        maxSteps: 50,
        highlightElements: true,
      }),
    });

    if (!browserUseResponse.ok) {
      const errorData = await browserUseResponse.text();
      console.error("[WebAgent] Browser Use API error:", errorData);
      
      // Update task status
      if (task) {
        await supabase
          .from("agent_tasks")
          .update({
            status: "failed",
            error_message: `Browser Use API error: ${browserUseResponse.status} - ${errorData}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      }

      throw new Error(`Web agent service error: ${browserUseResponse.status}`);
    }

    const agentResult = await browserUseResponse.json();
    console.log("[WebAgent] Task submitted successfully:", agentResult);

    // Store the task ID for status polling
    const taskId = agentResult.id || agentResult.task_id;

    // Update task with Browser Use task ID
    if (task) {
      await supabase
        .from("agent_tasks")
        .update({
          payload: {
            ...task.payload,
            browser_use_task_id: taskId,
          },
        })
        .eq("id", task.id);
    }

    // Create a pending application record
    const { data: application, error: appError } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        job_id: jobId,
        status: "pending",
        cover_letter: coverLetter,
        notes: `Browser Use submission in progress. Task: ${taskId}`,
      })
      .select()
      .single();

    if (appError) {
      console.error("[WebAgent] Failed to create application record:", appError);
    }

    // Log success
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "web_agent",
      log_level: "info",
      message: `Browser Use task submitted. Task ID: ${taskId}`,
      metadata: { 
        taskId, 
        internalTaskId: task?.id,
        applicationId: application?.id,
        status: "submitted" 
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Browser Use agent is submitting your application",
        taskId,
        internalTaskId: task?.id,
        applicationId: application?.id,
        status: "in_progress",
        estimatedTime: "1-3 minutes",
        details: {
          jobTitle,
          company,
          url: jobUrl,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[WebAgent] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to start web agent";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildAgentInstruction(payload: ApplicationPayload): string {
  const { jobTitle, company, resumeData, coverLetter, userProfile } = payload;
  
  // Generate a secure password for any account creation
  const generatedPassword = `Apply${Date.now().toString(36)}!${Math.random().toString(36).substring(2, 8)}`;
  
  let instruction = `Apply for the job "${jobTitle}" at "${company}".

YOUR MISSION: Complete the job application 100% autonomously. The user will NOT intervene.

AUTHENTICATION HANDLING (CRITICAL):
- If the site requires login/signup to apply, CREATE A NEW ACCOUNT using these credentials:
  - Email: ${userProfile.email}
  - Password: ${generatedPassword}
  - First Name: ${userProfile.firstName}
  - Last Name: ${userProfile.lastName}
- If you see a login page and already have an account, try signing in with the email above
- If signup requires email verification, check if there's a "continue without verification" option or proceed anyway
- Handle any OAuth prompts by choosing email/password signup instead
- NEVER stop or ask for user help - figure it out yourself

APPLICATION STEPS:
1. Navigate to the job listing and find the "Apply" button
2. If login/signup is required, handle it using the credentials above
3. Fill out ALL form fields with the candidate's information
4. Upload or paste resume content if there's an upload field
5. Submit the application
6. Confirm successful submission

CANDIDATE INFORMATION:
- Full Name: ${userProfile.firstName} ${userProfile.lastName}
- Email: ${userProfile.email}
- Password (for new accounts): ${generatedPassword}`;

  if (userProfile.phone) {
    instruction += `\n- Phone: ${userProfile.phone}`;
  }
  if (userProfile.linkedin) {
    instruction += `\n- LinkedIn: ${userProfile.linkedin}`;
  }

  if (resumeData) {
    instruction += `\n\nRESUME DATA:
- Years of Experience: ${resumeData.experience_years || 'Not specified'}
- Skills: ${resumeData.skills?.join(", ") || 'Not specified'}`;
    
    if (resumeData.parsed_content?.text) {
      instruction += `\n- Resume Content: ${resumeData.parsed_content.text.substring(0, 3000)}`;
    }
  }

  if (coverLetter) {
    instruction += `\n\nCOVER LETTER (use if there's a cover letter field):
${coverLetter}`;
  }

  instruction += `

FORM FILLING GUIDELINES:
- For salary expectations: Select "Prefer not to say" or enter a reasonable range based on the role
- For "How did you hear about us?": Select "Job Board" or "Online Search"
- For work authorization: Select "Yes" if asked (assume authorized)
- For start date: Select "Immediately" or "2 weeks notice"
- For screening questions: Answer based on resume data, be positive and professional
- If a field is optional and you don't have the info, skip it
- If a field is required and you don't have the info, make a reasonable choice

PROBLEM SOLVING:
- If CAPTCHA appears, solve it
- If email verification is required, note it but continue with the application if possible
- If multi-factor auth is required, report it as a blocker
- If the application has multiple pages/steps, complete ALL of them
- If there are errors, try to fix them and resubmit

SUCCESS CRITERIA:
- Application must be SUBMITTED, not just filled out
- Take a screenshot of the confirmation page
- Report the final status: "SUCCESS: Application submitted" or "BLOCKED: [reason]"

DO NOT STOP. DO NOT ASK FOR HELP. COMPLETE THE APPLICATION.`;

  return instruction;
}
