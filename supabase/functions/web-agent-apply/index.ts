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
    const HYPERBROWSER_API_KEY = Deno.env.get("HYPERBROWSER_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!HYPERBROWSER_API_KEY) {
      throw new Error("HYPERBROWSER_API_KEY is not configured. Please add your Hyperbrowser API key.");
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

    console.log(`[WebAgent] Starting AI-powered application for: ${jobTitle} at ${company}`);
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
      message: `Starting AI web agent application: ${jobTitle} at ${company}`,
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
    // Use the generated email alias for the application
    const agentInstruction = buildAgentInstruction({ 
      ...payload, 
      userProfile: { ...userProfile, email: applicationEmail } 
    });

    console.log(`[WebAgent] Sending task to Hyperbrowser...`);

    // Call Hyperbrowser's HyperAgent API
    const hyperbrowserResponse = await fetch("https://app.hyperbrowser.ai/api/v1/agent/run", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HYPERBROWSER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: jobUrl,
        task: agentInstruction,
        // Configuration for better job application handling
        options: {
          waitForCompletion: false, // Async mode - we'll poll for status
          maxSteps: 50,
          timeout: 300000, // 5 minutes max
          captureScreenshots: true,
          humanLikeInteraction: true,
          solveCaptchas: true,
        },
      }),
    });

    if (!hyperbrowserResponse.ok) {
      const errorData = await hyperbrowserResponse.text();
      console.error("[WebAgent] Hyperbrowser API error:", errorData);
      
      // Update task status
      if (task) {
        await supabase
          .from("agent_tasks")
          .update({
            status: "failed",
            error_message: `Hyperbrowser API error: ${hyperbrowserResponse.status}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      }

      throw new Error(`Web agent service error: ${hyperbrowserResponse.status}`);
    }

    const agentResult = await hyperbrowserResponse.json();
    console.log("[WebAgent] Task submitted successfully:", agentResult);

    // Store the session ID for status polling
    const sessionId = agentResult.sessionId || agentResult.id;

    // Update task with session ID
    if (task) {
      await supabase
        .from("agent_tasks")
        .update({
          payload: {
            ...task.payload,
            hyperbrowser_session_id: sessionId,
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
        status: "pending", // Will be updated when agent completes
        cover_letter: coverLetter,
        notes: `AI Web Agent submission in progress. Session: ${sessionId}`,
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
      message: `Web agent task submitted. Session ID: ${sessionId}`,
      metadata: { 
        sessionId, 
        taskId: task?.id,
        applicationId: application?.id,
        status: "submitted" 
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "AI web agent is submitting your application",
        sessionId,
        taskId: task?.id,
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
  
  let instruction = `Apply for the job "${jobTitle}" at "${company}".

YOUR TASK:
1. Navigate to the job application form on this page
2. Fill out ALL required fields with the candidate's information
3. Upload or paste the resume content if there's an upload field
4. Submit the application
5. Confirm successful submission

CANDIDATE INFORMATION:
- Full Name: ${userProfile.firstName} ${userProfile.lastName}
- Email: ${userProfile.email}`;

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
      // Include first 2000 chars of resume for context
      instruction += `\n- Resume Summary: ${resumeData.parsed_content.text.substring(0, 2000)}...`;
    }
  }

  if (coverLetter) {
    instruction += `\n\nCOVER LETTER (use if there's a cover letter field):
${coverLetter}`;
  }

  instruction += `

IMPORTANT GUIDELINES:
- If asked about salary expectations, select "Prefer not to say" or enter a reasonable range
- For "How did you hear about us?", select "Job Board" or "Online Search"
- If there are screening questions, answer them honestly based on the resume data
- If CAPTCHA appears, solve it
- If login is required, STOP and report "Login required"
- Take a screenshot after submission for confirmation
- Report any errors or issues encountered`;

  return instruction;
}
