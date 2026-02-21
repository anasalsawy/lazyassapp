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
    rawText?: string;
    fullText?: string;
  };
  fullText?: string;
  atsScore?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { preferences, resume, batchNumber = 1 } = await req.json();

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
    
    // Get full resume text from multiple sources
    const fullText = resumeData.fullText || 
                     parsedContent.fullText || 
                     parsedContent.rawText || 
                     "";

    // Build a comprehensive candidate profile from resume
    let candidateProfile = "";
    
    // CRITICAL: Include the full resume text first for complete context
    if (fullText && fullText.length > 50) {
      candidateProfile += `\n=== COMPLETE RESUME TEXT ===\n${fullText}\n`;
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

    // Calculate how many jobs to generate per batch
    const jobsPerBatch = 25;
    const startIndex = (batchNumber - 1) * jobsPerBatch + 1;
    const endIndex = batchNumber * jobsPerBatch;
    const maxBatches = 10; // Support up to 250 jobs

    // Build the matching prompt
    const locationsStr = preferences.locations?.length > 0 
      ? preferences.locations.join(', ') 
      : '';
    const hasLocationPreference = locationsStr.length > 0;

    const systemPrompt = `You are an expert job matching AI. Your task is to find the BEST job matches for a candidate based on their COMPLETE RESUME and preferences.

CRITICAL: You MUST analyze the candidate's FULL resume text below to understand their actual skills, experience, and career trajectory. DO NOT ignore any part of the resume.

=== CANDIDATE'S JOB PREFERENCES ===
- Desired Job Titles: ${preferences.jobTitles?.join(', ') || 'Based on resume experience'}
- Preferred Locations: ${locationsStr || 'Any location'}
- Remote Preference: ${preferences.remotePreference || 'any'}
- Salary Range: ${preferences.salaryMin ? `$${preferences.salaryMin.toLocaleString()}` : 'Open'} - ${preferences.salaryMax ? `$${preferences.salaryMax.toLocaleString()}` : 'Open'}
- Target Industries: ${preferences.industries?.join(', ') || 'Based on resume experience'}

=== CANDIDATE'S EXTRACTED DATA ===
- Identified Skills: ${skills.length > 0 ? skills.join(', ') : 'Extract from resume below'}
- Years of Experience: ${experienceYears || 'Determine from resume below'}
- Current ATS Score: ${resumeData.atsScore || 'Not calculated'}

=== CANDIDATE'S COMPLETE RESUME ===
${candidateProfile || 'No resume text provided - use preferences only'}

=== YOUR TASK ===
1. CAREFULLY READ the candidate's complete resume above
2. IDENTIFY their actual skills, experience level, and career focus from the resume
3. Generate job listings ${startIndex} through ${endIndex} (batch ${batchNumber}) - exactly ${jobsPerBatch} highly targeted jobs
4. Each job MUST be relevant to what's actually in their resume, not generic jobs
5. Calculate precise match scores based on resume-job alignment
6. Generate REAL-looking job listings from REAL companies that actually hire for these roles

=== MATCHING CRITERIA ===
- 90-100%: Perfect match - skills, experience, and preferences all align with resume
- 80-89%: Excellent match - strong alignment with the resume content
- 70-79%: Good match - most resume skills/experience apply
- 60-69%: Fair match - some resume alignment but gaps exist
- Below 60%: Poor match - don't include these

=== LOCATION RULES (CRITICAL) ===
${hasLocationPreference 
  ? `The candidate STRONGLY prefers jobs in these locations: ${locationsStr}.
- At LEAST 80% of jobs MUST be in or near these locations (same city, metro area, or state).
- Remote jobs that allow working from these locations are also acceptable.
- If remote preference is "remote", you may include fully remote positions but still prefer companies based in the preferred locations.
- Do NOT include random jobs from states/cities the candidate did not list.` 
  : `No location preference specified. Include a mix of remote and on-site jobs in major tech/business hubs.`}

${preferences.remotePreference === 'remote' 
  ? '- Strongly prefer REMOTE positions. At least 60% should be remote or hybrid-remote.' 
  : preferences.remotePreference === 'onsite' 
  ? '- Only include ON-SITE positions in the preferred locations.' 
  : '- Include a healthy mix of remote, hybrid, and on-site positions.'}

IMPORTANT: 
- Generate EXACTLY ${jobsPerBatch} diverse job matches
- Each job should be from a DIFFERENT company that ACTUALLY EXISTS and hires for these roles
- Jobs should span the match score range (90%+ down to 60%)
- Include mix of job levels appropriate for their experience
- Only include jobs with 60%+ match scores
- Include a SPECIFIC, REAL apply URL (e.g. company careers page, lever, greenhouse, workday)
- The "matchReason" should be 2-3 sentences explaining SPECIFIC alignment with the resume

=== OUTPUT FORMAT ===
Respond ONLY with valid JSON (no markdown, no explanation):
{
  "jobs": [
    {
      "externalId": "unique-id-string",
      "source": "company_careers_page",
      "title": "Exact Job Title Based on Resume Skills",
      "company": "Real Company Name",
      "location": "City, State or Remote",
      "salaryMin": 80000,
      "salaryMax": 120000,
      "description": "2-3 sentence job description highlighting key responsibilities relevant to candidate's resume",
      "requirements": ["skill1_from_resume", "skill2_from_resume", "skill3", "skill4", "skill5"],
      "jobType": "full-time",
      "postedAt": "2025-02-01T00:00:00Z",
      "url": "https://company.com/careers/job-id",
      "matchScore": 85,
      "matchReason": "Specific reason based on candidate's actual resume content"
    }
  ],
  "hasMore": true,
  "nextBatch": ${batchNumber + 1}
}`;

    console.log(`Batch ${batchNumber}: Sending match request with full resume data...`);
    console.log(`Resume text length: ${fullText.length} chars, Skills: ${skills.length}, Experience: ${experienceYears}yrs`);

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
          { role: "user", content: `Generate batch ${batchNumber} of job matches (jobs ${startIndex}-${endIndex}). Base all matches on the candidate's ACTUAL resume content provided above. Be specific about why each job matches their resume.` },
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
    // Continue batching as long as we haven't hit the max
    let hasMore = batchNumber < maxBatches;
    let nextBatch = batchNumber + 1;

    try {
      // Try to parse JSON directly first
      const cleanContent = content.trim();
      if (cleanContent.startsWith('{')) {
        const parsed = JSON.parse(cleanContent);
        jobs = parsed.jobs || [];
        hasMore = parsed.hasMore ?? hasMore;
        nextBatch = parsed.nextBatch ?? nextBatch;
      } else {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1].trim());
          jobs = parsed.jobs || [];
          hasMore = parsed.hasMore ?? hasMore;
          nextBatch = parsed.nextBatch ?? nextBatch;
        } else {
          // Last resort: find JSON object in text
          const objectMatch = content.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            const parsed = JSON.parse(objectMatch[0]);
            jobs = parsed.jobs || [];
            hasMore = parsed.hasMore ?? hasMore;
            nextBatch = parsed.nextBatch ?? nextBatch;
          }
        }
      }
    } catch (parseError) {
      console.error("Failed to parse job listings:", parseError);
      console.error("Raw content:", content.substring(0, 500));
    }

    // Sort by match score descending
    jobs.sort((a: any, b: any) => (b.matchScore || 0) - (a.matchScore || 0));

    console.log(`Batch ${batchNumber}: Generated ${jobs.length} job matches. Top score: ${jobs[0]?.matchScore || 'N/A'}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs,
        batchNumber,
        hasMore: hasMore && jobs.length >= 20, // Only continue if we got enough jobs
        nextBatch,
        matchedWith: {
          skillsCount: skills.length,
          experienceYears,
          hasFullResume: fullText.length > 50,
          resumeTextLength: fullText.length,
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
