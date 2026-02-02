import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Resume Redesign Agent - Generates optimized, ATS-friendly resume content

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

    const { resumeId, targetJobId, style, optimizeFor } = await req.json();

    if (!resumeId) {
      throw new Error("Resume ID is required");
    }

    console.log(`Redesigning resume: ${resumeId}`);

    // Get resume
    const { data: resume, error: resumeError } = await supabase
      .from("resumes")
      .select("*")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .single();

    if (resumeError || !resume) {
      throw new Error("Resume not found");
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // Get target job if specified
    let targetJob = null;
    if (targetJobId) {
      const { data: job } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", targetJobId)
        .single();
      targetJob = job;
    }

    const resumeText = resume.parsed_content?.text || "";
    const stylePreference = style || "modern_professional";
    const optimizationType = optimizeFor || "ats";

    // Generate optimized resume content
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
            content: `You are an expert Resume Designer Agent. Your task is to redesign and optimize resumes for maximum impact.

Style: ${stylePreference}
Optimization Target: ${optimizationType}

${targetJob ? `Target Job: ${targetJob.title} at ${targetJob.company}
Job Requirements: ${targetJob.requirements?.join(", ")}
Job Description: ${targetJob.description}` : ""}

Return a JSON object with the redesigned resume structure:
{
  "header": {
    "name": string,
    "title": string (professional title),
    "email": string,
    "phone": string,
    "linkedin": string,
    "location": string,
    "summary": string (3-4 sentences, keyword-rich professional summary)
  },
  "skills": {
    "technical": string[] (technical skills, frameworks, tools),
    "soft": string[] (soft skills),
    "certifications": string[]
  },
  "experience": [{
    "company": string,
    "title": string,
    "location": string,
    "startDate": string,
    "endDate": string | "Present",
    "bullets": string[] (action verbs, quantified achievements, keywords)
  }],
  "education": [{
    "institution": string,
    "degree": string,
    "field": string,
    "graduationDate": string,
    "gpa": string | null,
    "honors": string[]
  }],
  "projects": [{
    "name": string,
    "description": string,
    "technologies": string[],
    "highlights": string[]
  }],
  "atsScore": number (estimated ATS score 0-100),
  "improvements": string[] (list of improvements made),
  "keywordsAdded": string[],
  "formattingNotes": string[] (tips for PDF formatting)
}

ATS Optimization Guidelines:
- Use standard section headers (Experience, Education, Skills)
- Include relevant keywords from job description
- Use consistent date formats
- Avoid tables, graphics, headers/footers
- Use bullet points with action verbs
- Quantify achievements with numbers/percentages
- Keep formatting simple and scannable`,
          },
          {
            role: "user",
            content: `Redesign this resume:

Original Resume:
${resumeText.substring(0, 4000)}

Current Skills: ${resume.skills?.join(", ") || "Not extracted"}
Experience Years: ${resume.experience_years || "Unknown"}

Profile Info:
Name: ${profile?.first_name || ""} ${profile?.last_name || ""}
Email: ${profile?.email || user.email}
Phone: ${profile?.phone || ""}
LinkedIn: ${profile?.linkedin_url || ""}
Location: ${profile?.location || ""}`,
          },
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add more credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    let redesignedResume;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        redesignedResume = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      console.error("Failed to parse redesigned resume:", content);
      throw new Error("Failed to generate redesigned resume");
    }

    // Generate HTML version for preview
    const htmlContent = generateResumeHTML(redesignedResume, stylePreference);

    // Update resume with redesigned content
    await supabase
      .from("resumes")
      .update({
        ats_score: redesignedResume.atsScore,
        skills: [
          ...(redesignedResume.skills?.technical || []),
          ...(redesignedResume.skills?.soft || []),
        ],
        parsed_content: {
          ...resume.parsed_content,
          redesigned: redesignedResume,
          htmlPreview: htmlContent,
          redesignedAt: new Date().toISOString(),
        },
      })
      .eq("id", resumeId);

    // Log activity
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "resume_agent",
      log_level: "info",
      message: `Resume redesigned successfully`,
      metadata: {
        resume_id: resumeId,
        style: stylePreference,
        target_job: targetJobId,
        ats_score: redesignedResume.atsScore,
        improvements: redesignedResume.improvements?.length || 0,
      },
    });

    console.log("Resume redesigned successfully");

    return new Response(
      JSON.stringify({
        success: true,
        redesignedResume,
        htmlPreview: htmlContent,
        stats: {
          atsScore: redesignedResume.atsScore,
          improvementsMade: redesignedResume.improvements?.length || 0,
          keywordsAdded: redesignedResume.keywordsAdded?.length || 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error redesigning resume:", error);
    const message = error instanceof Error ? error.message : "Failed to redesign resume";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateResumeHTML(resume: any, style: string): string {
  const styles: Record<string, string> = {
    modern_professional: `
      body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 40px; }
      .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #2563eb; padding-bottom: 20px; }
      .name { font-size: 28px; font-weight: bold; color: #1e40af; margin-bottom: 5px; }
      .title { font-size: 18px; color: #4b5563; margin-bottom: 10px; }
      .contact { font-size: 14px; color: #6b7280; }
      .section { margin-bottom: 25px; }
      .section-title { font-size: 16px; font-weight: bold; color: #1e40af; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px; }
      .summary { font-style: italic; color: #4b5563; margin-bottom: 20px; }
      .skills { display: flex; flex-wrap: wrap; gap: 8px; }
      .skill { background: #eff6ff; color: #1e40af; padding: 4px 12px; border-radius: 20px; font-size: 13px; }
      .job { margin-bottom: 20px; }
      .job-header { display: flex; justify-content: space-between; margin-bottom: 5px; }
      .job-title { font-weight: bold; color: #111827; }
      .job-company { color: #4b5563; }
      .job-date { color: #6b7280; font-size: 14px; }
      .bullets { margin-left: 20px; }
      .bullets li { margin-bottom: 5px; }
    `,
    minimal: `
      body { font-family: Georgia, serif; line-height: 1.7; color: #222; max-width: 750px; margin: 0 auto; padding: 50px; }
      .header { margin-bottom: 40px; }
      .name { font-size: 32px; font-weight: normal; letter-spacing: 2px; margin-bottom: 10px; }
      .section-title { font-size: 14px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 15px; border-bottom: 1px solid #222; padding-bottom: 5px; }
    `,
    executive: `
      body { font-family: 'Times New Roman', serif; line-height: 1.5; color: #1a1a1a; max-width: 850px; margin: 0 auto; padding: 40px; }
      .header { text-align: center; margin-bottom: 35px; }
      .name { font-size: 26px; font-weight: bold; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 10px; }
      .section-title { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1a1a1a; margin-bottom: 15px; }
    `,
  };

  const css = styles[style] || styles.modern_professional;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <div class="name">${resume.header?.name || "Your Name"}</div>
    <div class="title">${resume.header?.title || "Professional Title"}</div>
    <div class="contact">
      ${resume.header?.email || ""} ${resume.header?.phone ? `| ${resume.header.phone}` : ""} 
      ${resume.header?.location ? `| ${resume.header.location}` : ""}
      ${resume.header?.linkedin ? `| <a href="${resume.header.linkedin}">LinkedIn</a>` : ""}
    </div>
  </div>

  ${resume.header?.summary ? `
  <div class="section">
    <div class="summary">${resume.header.summary}</div>
  </div>
  ` : ""}

  ${resume.skills ? `
  <div class="section">
    <div class="section-title">Skills</div>
    <div class="skills">
      ${[...(resume.skills.technical || []), ...(resume.skills.soft || [])].map((s: string) => 
        `<span class="skill">${s}</span>`
      ).join("")}
    </div>
  </div>
  ` : ""}

  ${resume.experience?.length ? `
  <div class="section">
    <div class="section-title">Experience</div>
    ${resume.experience.map((job: any) => `
      <div class="job">
        <div class="job-header">
          <div>
            <span class="job-title">${job.title}</span>
            <span class="job-company"> | ${job.company}</span>
          </div>
          <span class="job-date">${job.startDate} - ${job.endDate}</span>
        </div>
        <ul class="bullets">
          ${(job.bullets || []).map((b: string) => `<li>${b}</li>`).join("")}
        </ul>
      </div>
    `).join("")}
  </div>
  ` : ""}

  ${resume.education?.length ? `
  <div class="section">
    <div class="section-title">Education</div>
    ${resume.education.map((edu: any) => `
      <div class="job">
        <div class="job-header">
          <div>
            <span class="job-title">${edu.degree} in ${edu.field}</span>
            <span class="job-company"> | ${edu.institution}</span>
          </div>
          <span class="job-date">${edu.graduationDate}</span>
        </div>
      </div>
    `).join("")}
  </div>
  ` : ""}

  ${resume.projects?.length ? `
  <div class="section">
    <div class="section-title">Projects</div>
    ${resume.projects.map((proj: any) => `
      <div class="job">
        <div class="job-title">${proj.name}</div>
        <p>${proj.description}</p>
        ${proj.technologies?.length ? `<div class="skills">${proj.technologies.map((t: string) => `<span class="skill">${t}</span>`).join("")}</div>` : ""}
      </div>
    `).join("")}
  </div>
  ` : ""}
</body>
</html>`;
}
