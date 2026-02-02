import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { jobId, generateCoverLetter, customMessage } = await req.json();

    if (!jobId) {
      throw new Error("Job ID is required");
    }

    console.log(`Submitting application for job: ${jobId}`);

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !job) {
      throw new Error("Job not found");
    }

    // Check if already applied
    const { data: existingApp } = await supabase
      .from("applications")
      .select("id")
      .eq("job_id", jobId)
      .eq("user_id", user.id)
      .single();

    if (existingApp) {
      return new Response(
        JSON.stringify({ error: "You have already applied to this job" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's primary resume
    const { data: resume } = await supabase
      .from("resumes")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_primary", true)
      .single();

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    let coverLetter = customMessage || null;

    // Generate cover letter if requested
    if (generateCoverLetter && resume) {
      console.log("Generating cover letter...");

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
              content: `You are an expert cover letter writer. Create a compelling, personalized cover letter.

Guidelines:
- Keep it concise: 3-4 paragraphs, under 400 words
- Match keywords from the job description
- Highlight relevant experience from the resume
- Show genuine enthusiasm for the specific role and company
- Include specific achievements with numbers when possible
- Avoid generic phrases like "I am writing to apply"
- Make it unique and memorable
- Professional but engaging tone`,
            },
            {
              role: "user",
              content: `Write a cover letter for:

Position: ${job.title}
Company: ${job.company}
Location: ${job.location || "Not specified"}
Job Description: ${job.description || "Not available"}
Requirements: ${job.requirements?.join(", ") || "Not specified"}

Candidate Profile:
Name: ${profile?.first_name || ""} ${profile?.last_name || ""}
Skills: ${resume.skills?.join(", ") || "Not specified"}
Experience: ${resume.experience_years || 0} years
Summary: ${resume.parsed_content?.text?.substring(0, 1500) || "Not available"}`,
            },
          ],
          temperature: 0.7,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        coverLetter = data.choices?.[0]?.message?.content?.trim();
        console.log("Cover letter generated successfully");
      } else if (response.status === 429) {
        console.warn("Rate limited while generating cover letter");
      }
    }

    // Create the application
    const { data: application, error: appError } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        job_id: jobId,
        resume_id: resume?.id || null,
        status: "applied",
        cover_letter: coverLetter,
        notes: `Applied via AutoApply${job.match_score ? ` (Match score: ${job.match_score}%)` : ""}`,
        applied_at: new Date().toISOString(),
      })
      .select(`
        *,
        job:jobs(title, company, location, url)
      `)
      .single();

    if (appError) {
      throw appError;
    }

    // Log the application
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "application_agent",
      log_level: "info",
      message: `Application submitted: ${job.title} at ${job.company}`,
      metadata: {
        job_id: jobId,
        application_id: application.id,
        cover_letter_generated: !!coverLetter,
        match_score: job.match_score,
      },
    });

    // Update automation settings if auto-apply
    const { data: settings } = await supabase
      .from("automation_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (settings) {
      await supabase
        .from("automation_settings")
        .update({
          applications_today: (settings.applications_today || 0) + 1,
          last_auto_apply_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
    }

    // Prepare application details for external submission (when job URL is available)
    const applicationPackage = {
      job: {
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
      },
      candidate: {
        name: `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim(),
        email: profile?.email || user.email,
        phone: profile?.phone,
        linkedin: profile?.linkedin_url,
      },
      resume: resume ? {
        id: resume.id,
        skills: resume.skills,
        experience_years: resume.experience_years,
        file_path: resume.file_path,
      } : null,
      coverLetter,
      applicationUrl: job.url,
      submittedAt: new Date().toISOString(),
    };

    console.log("Application submitted successfully:", application.id);

    return new Response(
      JSON.stringify({
        success: true,
        application,
        applicationPackage,
        message: `Successfully applied to ${job.title} at ${job.company}`,
        nextSteps: job.url ? [
          "Your application has been recorded.",
          `Click here to complete the application on ${extractDomain(job.url)}: ${job.url}`,
          "We've prepared your cover letter and details.",
        ] : [
          "Your application has been recorded.",
          "The employer will contact you if interested.",
        ],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error submitting application:", error);
    const message = error instanceof Error ? error.message : "Failed to submit application";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "the job board";
  }
}
