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

interface Job {
  title: string;
  company: string;
  location: string;
  salaryMin?: number;
  salaryMax?: number;
  description: string;
  requirements?: string[];
  jobType?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { preferences, skills, experienceYears } = await req.json();

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

    // Generate mock job listings using AI
    const systemPrompt = `You are a job search agent. Based on the user's preferences, generate 10 realistic job listings that would match their criteria.

User Preferences:
- Desired Titles: ${preferences.jobTitles?.join(', ') || 'Software Engineer'}
- Locations: ${preferences.locations?.join(', ') || 'Remote'}
- Remote Preference: ${preferences.remotePreference || 'any'}
- Salary Range: ${preferences.salaryMin ? `$${preferences.salaryMin}` : 'Not specified'} - ${preferences.salaryMax ? `$${preferences.salaryMax}` : 'Not specified'}
- Industries: ${preferences.industries?.join(', ') || 'Technology'}

User Profile:
- Skills: ${skills?.join(', ') || 'Not specified'}
- Experience: ${experienceYears || 0} years

Generate realistic job listings from well-known companies. For each job, calculate a match score (0-100) based on how well it matches the user's profile.

Respond in JSON format:
{
  "jobs": [
    {
      "externalId": "unique-id",
      "source": "company_website",
      "title": "Job Title",
      "company": "Company Name",
      "location": "City, State or Remote",
      "salaryMin": number,
      "salaryMax": number,
      "description": "Job description (2-3 sentences)",
      "requirements": ["requirement1", "requirement2"],
      "jobType": "full-time|part-time|contract",
      "postedAt": "ISO date string",
      "url": "https://example.com/jobs/id",
      "matchScore": number
    }
  ]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate job listings based on my preferences." },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    let jobs = [];
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        jobs = parsed.jobs || [];
      }
    } catch {
      console.error("Failed to parse job listings:", content);
    }

    console.log(`Generated ${jobs.length} job matches`);

    return new Response(
      JSON.stringify({ success: true, jobs }),
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
