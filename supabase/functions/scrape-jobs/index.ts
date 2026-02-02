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
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is not configured. Please connect Firecrawl in Settings.");
    }
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

    const { jobTitles, locations, jobBoards, remotePreference, salaryMin, salaryMax, industries } = await req.json();

    console.log("Scraping jobs with:", { jobTitles, locations, jobBoards, remotePreference });

    const allScrapedJobs: any[] = [];
    const searchQueries: string[] = [];

    // Build search queries
    const titles = jobTitles?.length ? jobTitles : ["Software Engineer"];
    const locs = locations?.length ? locations : ["Remote"];
    const boards = jobBoards?.length ? jobBoards : ["linkedin", "indeed"];

    for (const title of titles.slice(0, 3)) {
      for (const location of locs.slice(0, 2)) {
        // Build comprehensive search query
        let query = `${title} ${location} jobs`;
        if (remotePreference === "remote") query += " remote";
        if (salaryMin) query += ` $${salaryMin}+`;
        
        searchQueries.push(query);
      }
    }

    // Scrape from job boards using Firecrawl search
    for (const query of searchQueries) {
      try {
        console.log(`Searching: ${query}`);

        const response = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: query + " site:linkedin.com/jobs OR site:indeed.com OR site:glassdoor.com",
            limit: 15,
            scrapeOptions: {
              formats: ["markdown"],
              onlyMainContent: true,
            },
          }),
        });

        if (!response.ok) {
          console.error(`Firecrawl search failed: ${response.status}`);
          continue;
        }

        const data = await response.json();
        console.log(`Found ${data.data?.length || 0} results for: ${query}`);

        if (data.data) {
          for (const result of data.data) {
            allScrapedJobs.push({
              url: result.url,
              title: result.title,
              description: result.description,
              markdown: result.markdown?.substring(0, 3000),
              source: extractSource(result.url),
              searchQuery: query,
            });
          }
        }
      } catch (err) {
        console.error(`Error scraping: ${query}`, err);
      }
    }

    console.log(`Total scraped jobs: ${allScrapedJobs.length}`);

    if (allScrapedJobs.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          jobs: [],
          message: "No jobs found matching your criteria. Try broadening your search."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's resume for skill matching
    const { data: resume } = await supabase
      .from("resumes")
      .select("skills, parsed_content")
      .eq("user_id", user.id)
      .eq("is_primary", true)
      .single();

    const userSkills = resume?.skills || [];

    // Use AI to extract structured job data and calculate match scores
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
            content: `You are a job extraction expert. Parse the scraped job listings and extract structured data.

User's skills: ${userSkills.join(", ") || "General skills"}
User's preferences:
- Remote preference: ${remotePreference || "any"}
- Salary range: ${salaryMin || "Not specified"} - ${salaryMax || "Not specified"}
- Industries: ${industries?.join(", ") || "Any"}

For each job, calculate a match_score (0-100) based on:
- Skill match with user's skills
- Location/remote match
- Salary alignment
- Industry relevance

Return a JSON array of unique jobs (deduplicated by company+title):
[{
  "title": string,
  "company": string,
  "location": string,
  "salaryMin": number | null,
  "salaryMax": number | null,
  "description": string (2-3 sentences summary),
  "requirements": string[] (key requirements),
  "jobType": "full-time" | "part-time" | "contract" | "internship",
  "isRemote": boolean,
  "matchScore": number (0-100),
  "matchReasons": string[] (why it matches),
  "url": string,
  "source": string (e.g., "LinkedIn", "Indeed"),
  "postedDate": string | null (ISO date if available)
}]

IMPORTANT: Only include valid job postings with clear title and company. Skip generic search result pages.`,
          },
          {
            role: "user",
            content: `Extract jobs from these ${allScrapedJobs.length} scraped results:\n\n${JSON.stringify(allScrapedJobs.slice(0, 30))}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    let extractedJobs: any[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        extractedJobs = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error("Failed to parse AI response:", err);
      extractedJobs = [];
    }

    console.log(`Extracted ${extractedJobs.length} valid jobs`);

    // Save jobs to database
    const savedJobs = [];
    for (const job of extractedJobs) {
      const { data: savedJob, error } = await supabase
        .from("jobs")
        .upsert({
          user_id: user.id,
          external_id: job.url || `${job.company}-${job.title}`.toLowerCase().replace(/\s+/g, "-"),
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
          posted_at: job.postedDate ? new Date(job.postedDate).toISOString() : new Date().toISOString(),
        }, { 
          onConflict: "external_id",
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (!error && savedJob) {
        savedJobs.push({
          ...savedJob,
          matchReasons: job.matchReasons,
          isRemote: job.isRemote,
        });
      }
    }

    // Log the scraping activity
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      agent_name: "job_agent",
      log_level: "info",
      message: `Scraped and saved ${savedJobs.length} jobs`,
      metadata: { 
        queries: searchQueries,
        total_scraped: allScrapedJobs.length,
        extracted: extractedJobs.length,
        saved: savedJobs.length,
      },
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        jobs: savedJobs.sort((a, b) => (b.match_score || 0) - (a.match_score || 0)),
        stats: {
          scraped: allScrapedJobs.length,
          extracted: extractedJobs.length,
          saved: savedJobs.length,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error scraping jobs:", error);
    const message = error instanceof Error ? error.message : "Failed to scrape jobs";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractSource(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("linkedin")) return "LinkedIn";
    if (hostname.includes("indeed")) return "Indeed";
    if (hostname.includes("glassdoor")) return "Glassdoor";
    if (hostname.includes("ziprecruiter")) return "ZipRecruiter";
    if (hostname.includes("monster")) return "Monster";
    return hostname.replace("www.", "").split(".")[0];
  } catch {
    return "Unknown";
  }
}
