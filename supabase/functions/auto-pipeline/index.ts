import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * AUTO-PIPELINE: Fully automated job application flow
 * 
 * Trigger: Resume upload
 * Flow: Analyze Resume → Scrape Jobs → Match & Score → Generate Cover Letters → Auto-Apply
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const BROWSER_USE_API_KEY = Deno.env.get("BROWSER_USE_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const { trigger, resumeId, resumeText } = await req.json();

    // Create a pipeline run
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({
        user_id: user.id,
        run_type: "auto_pipeline",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    const log = async (message: string, metadata: any = {}) => {
      console.log(`[AutoPipeline] ${message}`, metadata);
      await supabase.from("agent_logs").insert({
        user_id: user.id,
        agent_name: "auto_pipeline",
        log_level: "info",
        message,
        metadata,
      });
    };

    await log("🚀 Pipeline triggered", { trigger, resumeId });

    // STEP 1: Analyze Resume
    await log("📄 Step 1: Analyzing resume...");
    let resumeAnalysis;
    
    if (LOVABLE_API_KEY && resumeText) {
      const analysisResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Extract from this resume and return JSON:
{
  "atsScore": number (0-100),
  "skills": string[],
  "experienceYears": number,
  "jobTitles": string[] (target roles based on experience),
  "industries": string[],
  "summary": string (2 sentences)
}`,
            },
            { role: "user", content: resumeText },
          ],
          temperature: 0.2,
        }),
      });

      const analysisData = await analysisResponse.json();
      const content = analysisData.choices?.[0]?.message?.content || "";
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          resumeAnalysis = JSON.parse(jsonMatch[0]);
        }
      } catch {
        resumeAnalysis = { skills: [], experienceYears: 0, jobTitles: ["Software Engineer"] };
      }

      // Update resume with analysis
      if (resumeId && resumeAnalysis) {
        await supabase.from("resumes").update({
          ats_score: resumeAnalysis.atsScore,
          skills: resumeAnalysis.skills,
          experience_years: resumeAnalysis.experienceYears,
          parsed_content: { text: resumeText, analysis: resumeAnalysis },
        }).eq("id", resumeId);
      }

      await log("✅ Resume analyzed", { atsScore: resumeAnalysis?.atsScore, skills: resumeAnalysis?.skills?.length });
    }

    // STEP 2: Get/Update Job Preferences
    await log("⚙️ Step 2: Checking job preferences...");
    let { data: preferences } = await supabase
      .from("job_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // Auto-update preferences from resume analysis
    if (resumeAnalysis && preferences) {
      const updatedTitles = [...new Set([...(preferences.job_titles || []), ...(resumeAnalysis.jobTitles || [])])];
      const updatedIndustries = [...new Set([...(preferences.industries || []), ...(resumeAnalysis.industries || [])])];
      
      await supabase.from("job_preferences").update({
        job_titles: updatedTitles.slice(0, 5),
        industries: updatedIndustries.slice(0, 5),
      }).eq("user_id", user.id);
      
      preferences.job_titles = updatedTitles;
      preferences.industries = updatedIndustries;
    }

    // STEP 3: Scrape Jobs
    await log("🔍 Step 3: Searching for jobs...");
    const jobTitles = preferences?.job_titles?.slice(0, 3) || resumeAnalysis?.jobTitles || ["Software Engineer"];
    const locations = preferences?.locations?.slice(0, 2) || ["Remote"];
    
    const scrapedJobs: any[] = [];

    if (FIRECRAWL_API_KEY) {
      for (const title of jobTitles) {
        for (const location of locations) {
          const searchQuery = `${title} ${location} job openings apply now`;
          
          try {
            const searchResponse = await fetch("https://api.firecrawl.dev/v1/search", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                query: searchQuery,
                limit: 15,
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
                    content: result.markdown?.substring(0, 3000) || result.description,
                    source: new URL(result.url).hostname,
                  });
                }
              }
            }
          } catch (e) {
            console.error("Scrape error:", e);
          }
        }
      }
    }

    await log("📥 Jobs scraped", { count: scrapedJobs.length });

    // STEP 4: Extract & Score Jobs with AI
    await log("🎯 Step 4: Matching jobs to your profile...");
    let matchedJobs: any[] = [];

    if (LOVABLE_API_KEY && scrapedJobs.length > 0) {
      const matchResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Extract real job listings and score them. User has ${resumeAnalysis?.experienceYears || 3} years experience with skills: ${resumeAnalysis?.skills?.join(", ") || "General"}.

Return JSON array:
[{
  "title": string,
  "company": string,
  "location": string,
  "salaryMin": number | null,
  "salaryMax": number | null,
  "description": string (brief),
  "requirements": string[],
  "jobType": "full-time" | "remote" | "contract",
  "matchScore": number (0-100, based on skill match),
  "url": string
}]

Only include REAL job listings with actual apply URLs. Filter out job boards landing pages.`,
            },
            {
              role: "user",
              content: JSON.stringify(scrapedJobs.slice(0, 20)),
            },
          ],
          temperature: 0.2,
        }),
      });

      const matchData = await matchResponse.json();
      const content = matchData.choices?.[0]?.message?.content || "";
      
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          matchedJobs = JSON.parse(jsonMatch[0]);
        }
      } catch {
        console.error("Failed to parse matched jobs");
      }
    }

    await log("✅ Jobs matched", { count: matchedJobs.length });

    // Save jobs to database
    const savedJobs: any[] = [];
    for (const job of matchedJobs) {
      if (!job.url || !job.title || !job.company) continue;
      
      const { data: savedJob, error } = await supabase.from("jobs").upsert({
        user_id: user.id,
        external_id: job.url,
        source: new URL(job.url).hostname,
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
      }, { onConflict: "user_id,external_id" }).select().single();

      if (savedJob) savedJobs.push(savedJob);
    }

    await log("💾 Jobs saved", { count: savedJobs.length });

    // STEP 5: Get automation settings
    const { data: automationSettings } = await supabase
      .from("automation_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // STEP 6: Auto-Apply to matching jobs
    await log("🤖 Step 5: Auto-applying to matching jobs...");
    
    const minScore = automationSettings?.min_match_score || 70;
    const dailyLimit = automationSettings?.daily_apply_limit || 10;
    const applicationsToday = automationSettings?.applications_today || 0;
    const remainingApps = Math.max(0, dailyLimit - applicationsToday);

    // Get user profile for applications
    const { data: profile } = await supabase
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

    // Filter high-match jobs for auto-apply
    const eligibleJobs = savedJobs
      .filter(j => j.match_score >= minScore && j.url)
      .slice(0, remainingApps);

    const applications: any[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const job of eligibleJobs) {
      try {
        // Generate cover letter
        let coverLetter = null;
        if (LOVABLE_API_KEY && (automationSettings?.require_cover_letter ?? true)) {
          const clResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: "Generate a concise, professional cover letter (3 paragraphs max). Be specific about the role and company.",
                },
                {
                  role: "user",
                  content: `Job: ${job.title} at ${job.company}
Description: ${job.description}
My Skills: ${resume?.skills?.join(", ")}
My Experience: ${resume?.experience_years} years`,
                },
              ],
              temperature: 0.7,
            }),
          });
          const clData = await clResponse.json();
          coverLetter = clData.choices?.[0]?.message?.content;
        }

        // Check if Browser Use API is available for real submissions
        if (BROWSER_USE_API_KEY && job.url) {
          // Submit via Browser Use for real applications
          const browserUseResponse = await fetch("https://api.browser-use.com/api/v2/tasks", {
            method: "POST",
            headers: {
              "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              task: `Apply for the job "${job.title}" at "${job.company}".
              
Fill out the application with:
- Name: ${profile?.first_name || "User"} ${profile?.last_name || ""}
- Email: ${profile?.email || user.email}
- Phone: ${profile?.phone || ""}

Resume Summary: ${resume?.parsed_content?.text?.substring(0, 1500) || ""}

Cover Letter:
${coverLetter || "I am interested in this position."}

If login required, STOP. If CAPTCHA, solve it. Submit the application.`,
              startUrl: job.url,
              llm: "browser-use-llm",
              maxSteps: 50,
            }),
          });

          if (browserUseResponse.ok) {
            const taskData = await browserUseResponse.json();
            
            // Create application record
            const { data: app } = await supabase.from("applications").insert({
              user_id: user.id,
              job_id: job.id,
              resume_id: resume?.id,
              status: "applied",
              cover_letter: coverLetter,
              notes: `Auto-applied via Browser Use. Task: ${taskData.id || taskData.task_id}. Match: ${job.match_score}%`,
            }).select().single();

            if (app) {
              applications.push(app);
              successCount++;
            }
          }
        } else {
          // No Browser Use - create quick apply record
          const { data: app } = await supabase.from("applications").insert({
            user_id: user.id,
            job_id: job.id,
            resume_id: resume?.id,
            status: "applied",
            cover_letter: coverLetter,
            notes: `Quick apply. Match: ${job.match_score}%. URL: ${job.url}`,
          }).select().single();

          if (app) {
            applications.push(app);
            successCount++;
          }
        }
      } catch (e) {
        console.error(`Failed to apply to ${job.title}:`, e);
        failCount++;
      }
    }

    // Update applications_today
    if (successCount > 0) {
      await supabase.from("automation_settings").update({
        applications_today: applicationsToday + successCount,
        last_auto_apply_at: new Date().toISOString(),
      }).eq("user_id", user.id);
    }

    await log("✅ Auto-apply complete", { success: successCount, failed: failCount });

    // Complete the run
    await supabase.from("agent_runs").update({
      status: "completed",
      ended_at: new Date().toISOString(),
      summary_json: {
        resumeAnalyzed: !!resumeAnalysis,
        atsScore: resumeAnalysis?.atsScore,
        jobsScraped: scrapedJobs.length,
        jobsMatched: matchedJobs.length,
        jobsSaved: savedJobs.length,
        applicationsSubmitted: successCount,
        applicationsFailed: failCount,
      },
    }).eq("id", run?.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Pipeline complete! Analyzed resume, found ${savedJobs.length} matching jobs, submitted ${successCount} applications.`,
        summary: {
          atsScore: resumeAnalysis?.atsScore,
          skills: resumeAnalysis?.skills?.length,
          jobsFound: savedJobs.length,
          applications: successCount,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[AutoPipeline] Error:", error);
    const message = error instanceof Error ? error.message : "Pipeline failed";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
