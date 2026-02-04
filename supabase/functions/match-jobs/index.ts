import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface JobPreferences {
  jobTitles: string[];
  locations: string[];
  remotePreference: string;
  salaryMin?: number;
  salaryMax?: number;
  industries: string[];
}

interface ResumeData {
  skills?: string[];
  experienceYears?: number;
  parsedContent?: {
    summary?: string;
    experience?: Array<{
      title?: string;
      company?: string;
      description?: string;
      duration?: string;
    }>;
    education?: Array<{
      degree?: string;
      institution?: string;
      field?: string;
    }>;
    certifications?: string[];
  };
  fullText?: string;
  atsScore?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { preferences, resume } = await req.json();

    if (!preferences) {
      return new Response(
        JSON.stringify({ error: "Job preferences are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Extract resume data with fallbacks
    const resumeData: ResumeData = resume || {};
    const skills = resumeData.skills || [];
    const experienceYears = resumeData.experienceYears || 0;
    const parsedContent = resumeData.parsedContent || {};
    const fullText = resumeData.fullText || "";

    // Build a comprehensive candidate profile from resume
    let candidateProfile = "";
    
    if (fullText) {
      candidateProfile += `\n=== FULL RESUME TEXT ===\n${fullText}\n`;
    }
    
    if (parsedContent.summary) {
      candidateProfile += `\n=== PROFESSIONAL SUMMARY ===\n${parsedContent.summary}\n`;
    }
    
    if (parsedContent.experience && parsedContent.experience.length > 0) {
      candidateProfile += `\n=== WORK EXPERIENCE ===\n`;
      parsedContent.experience.forEach((exp: any, i: number) => {
        candidateProfile += `${i + 1}. ${exp.title || 'Position'} at ${exp.company || 'Company'}`;
        if (exp.duration) candidateProfile += ` (${exp.duration})`;
        candidateProfile += `\n`;
        if (exp.description) candidateProfile += `   ${exp.description}\n`;
      });
    }
    
    if (parsedContent.education && parsedContent.education.length > 0) {
      candidateProfile += `\n=== EDUCATION ===\n`;
      parsedContent.education.forEach((edu: any) => {
        candidateProfile += `- ${edu.degree || 'Degree'} in ${edu.field || 'Field'} from ${edu.institution || 'Institution'}\n`;
      });
    }
    
    if (parsedContent.certifications && parsedContent.certifications.length > 0) {
      candidateProfile += `\n=== CERTIFICATIONS ===\n${parsedContent.certifications.join(', ')}\n`;
    }

    // Build the matching prompt
    const systemPrompt = `You are an expert job matching AI. Your task is to find the BEST job matches for a candidate based on their resume and preferences.

=== CANDIDATE'S JOB PREFERENCES ===
- Desired Job Titles: ${preferences.jobTitles?.join(', ') || 'Not specified'}
- Preferred Locations: ${preferences.locations?.join(', ') || 'Any location'}
- Remote Preference: ${preferences.remotePreference || 'any'}
- Salary Range: ${preferences.salaryMin ? `$${preferences.salaryMin.toLocaleString()}` : 'Open'} - ${preferences.salaryMax ? `$${preferences.salaryMax.toLocaleString()}` : 'Open'}
- Target Industries: ${preferences.industries?.join(', ') || 'Any industry'}

=== CANDIDATE'S PROFILE ===
- Skills: ${skills.length > 0 ? skills.join(', ') : 'See resume below'}
- Years of Experience: ${experienceYears || 'See resume below'}
- Current ATS Score: ${resumeData.atsScore || 'Not calculated'}
${candidateProfile}

=== YOUR TASK ===
1. Analyze the candidate's complete background (skills, experience, education, certifications)
2. Generate 15 highly targeted job listings that would be EXCELLENT matches
3. Calculate a precise match score (0-100) based on:
   - Skill alignment (40%): How well do their skills match job requirements?
   - Experience level (25%): Is their experience appropriate for the role?
   - Title/role fit (20%): Does the job title align with their career trajectory?
   - Location/salary fit (15%): Does it meet their stated preferences?

=== MATCHING CRITERIA ===
- 90-100%: Perfect match - skills, experience, and preferences all align
- 80-89%: Excellent match - strong alignment with minor gaps
- 70-79%: Good match - most requirements met
- 60-69%: Fair match - some alignment but gaps exist
- Below 60%: Poor match - don't include these

Only include jobs with 60%+ match scores. Prioritize quality over quantity.

=== OUTPUT FORMAT ===
Respond ONLY with valid JSON (no markdown, no explanation):
{
  "jobs": [
    {
      "externalId": "unique-id-string",
      "source": "company_careers_page",
      "title": "Exact Job Title",
      "company": "Real Company Name",
      "location": "City, State or Remote",
      "salaryMin": 80000,
      "salaryMax": 120000,
      "description": "2-3 sentence job description highlighting key responsibilities",
      "requirements": ["skill1", "skill2", "skill3", "skill4", "skill5"],
      "jobType": "full-time",
      "postedAt": "2025-02-01T00:00:00Z",
      "url": "https://company.com/careers/job-id",
      "matchScore": 85,
      "matchReason": "Strong TypeScript/React skills match, 5+ years experience aligns, remote preference satisfied"
    }
  ]
}`;

    console.log("Sending match request with full resume data...");
    console.log(`Skills: ${skills.length}, Experience: ${experienceYears}, Has parsed content: ${!!parsedContent}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Find the best job matches for this candidate. Be specific and accurate with match scores." },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a few seconds." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No response from AI");
    }

    let jobs = [];
    try {
      // Try to parse JSON directly first
      const cleanContent = content.trim();
      if (cleanContent.startsWith('{')) {
        const parsed = JSON.parse(cleanContent);
        jobs = parsed.jobs || [];
      } else {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1].trim());
          jobs = parsed.jobs || [];
        } else {
          // Last resort: find JSON object in text
          const objectMatch = content.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            const parsed = JSON.parse(objectMatch[0]);
            jobs = parsed.jobs || [];
          }
        }
      }
    } catch (parseError) {
      console.error("Failed to parse job listings:", parseError);
      console.error("Raw content:", content.substring(0, 500));
    }

    // Sort by match score descending
    jobs.sort((a: any, b: any) => (b.matchScore || 0) - (a.matchScore || 0));

    console.log(`Generated ${jobs.length} job matches. Top score: ${jobs[0]?.matchScore || 'N/A'}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs,
        matchedWith: {
          skillsCount: skills.length,
          experienceYears,
          hasFullResume: !!fullText,
          hasParsedContent: Object.keys(parsedContent).length > 0
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error matching jobs:", error);
    const message = error instanceof Error ? error.message : "Failed to match jobs";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
