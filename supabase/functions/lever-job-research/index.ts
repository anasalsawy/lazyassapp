import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// =============================================
// LEVER JOB RESEARCH AGENT
// =============================================
// 1. Receives optimized resume data
// 2. AI infers optimal search queries from the CV
// 3. Scrapes Lever job boards via Firecrawl
// 4. Scores each job for compatibility (80+ threshold)
// 5. Returns URL list ready for Skyvern application
// =============================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth - support both bearer token and service-role internal calls
    const authHeader = req.headers.get("Authorization");
    let userId: string;

    const { resumeId, userId: internalUserId } = await req.json();

    if (internalUserId) {
      // Internal call from redesign-resume (service-role context)
      userId = internalUserId;
    } else {
      if (!authHeader) throw new Error("No authorization header");
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (authError || !user) throw new Error("Unauthorized");
      userId = user.id;
    }

    if (!resumeId) throw new Error("resumeId is required");

    console.log(`[LeverResearch] Starting for resume: ${resumeId}, user: ${userId}`);

    // Create agent run record
    const { data: agentRun } = await supabase
      .from("agent_runs")
      .insert({
        user_id: userId,
        run_type: "lever_job_research",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    const runId = agentRun?.id;

    try {
      // ---- STEP 1: Fetch optimized resume ----
      const { data: resume, error: resumeError } = await supabase
        .from("resumes")
        .select("*")
        .eq("id", resumeId)
        .eq("user_id", userId)
        .single();

      if (resumeError || !resume) throw new Error("Resume not found");

      const redesigned = resume.parsed_content?.redesigned;
      const rawText =
        resume.parsed_content?.rawText ||
        resume.parsed_content?.fullText ||
        resume.parsed_content?.text ||
        "";

      const skills = [
        ...(redesigned?.skills?.technical || resume.skills || []),
        ...(redesigned?.skills?.soft || []),
      ];
      const experienceSummary = redesigned
        ? redesigned.experience
            ?.map(
              (e: any) =>
                `${e.title} at ${e.company}: ${(e.bullets || []).slice(0, 2).join("; ")}`
            )
            .join("\n")
        : "";
      const title = redesigned?.header?.title || resume.title || "";

      console.log(`[LeverResearch] CV title: "${title}", Skills: ${skills.length}`);

      // ---- STEP 2: AI infers search queries ----
      const queryResponse = await callOpenAI(OPENAI_API_KEY, {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert job market researcher. Given a candidate's resume data, infer the BEST search queries to find compatible jobs on Lever job boards.

Return a JSON object:
{
  "queries": string[] (3-5 search queries, each 2-4 words, optimized for job title matching),
  "targetRoles": string[] (3-5 specific job titles this candidate is best suited for),
  "keySkills": string[] (top 5-8 differentiating skills),
  "seniorityLevel": string ("entry" | "mid" | "senior" | "lead" | "executive"),
  "industries": string[] (2-3 best-fit industries)
}

Focus on REALISTIC job titles the candidate can get hired for. Be specific, not generic.`,
          },
          {
            role: "user",
            content: `Resume Title: ${title}
Skills: ${skills.join(", ")}
Experience: ${experienceSummary || rawText.substring(0, 2000)}
Years of Experience: ${resume.experience_years || "unknown"}`,
          },
        ],
        temperature: 0.3,
      });

      const queryData = parseJSON(queryResponse);
      if (!queryData?.queries?.length) throw new Error("AI failed to generate search queries");

      console.log(
        `[LeverResearch] AI inferred queries: ${queryData.queries.join(", ")}`
      );

      await logAgent(supabase, userId, runId, "query_inference", queryData);

      // ---- STEP 3: Scrape Lever jobs ----
      const allJobs: LeverJob[] = [];
      const seenUrls = new Set<string>();

      for (const query of queryData.queries) {
        try {
          const leverUrl = `https://jobs.lever.co/?search=${encodeURIComponent(query)}`;
          console.log(`[LeverResearch] Scraping: ${leverUrl}`);

          const scrapeResult = await fetch(
            "https://api.firecrawl.dev/v1/scrape",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: leverUrl,
                formats: ["links", "markdown"],
                onlyMainContent: true,
                waitFor: 3000,
              }),
            }
          );

          if (!scrapeResult.ok) {
            console.error(`[LeverResearch] Firecrawl error for "${query}": ${scrapeResult.status}`);
            continue;
          }

          const scrapeData = await scrapeResult.json();
          const links: string[] = scrapeData.data?.links || scrapeData.links || [];
          const markdown: string = scrapeData.data?.markdown || scrapeData.markdown || "";

          // Extract Lever job URLs (format: https://jobs.lever.co/company/job-id)
          const leverJobLinks = links.filter(
            (l: string) =>
              l.match(/^https:\/\/jobs\.lever\.co\/[^/]+\/[a-f0-9-]+/) && !seenUrls.has(l)
          );

          for (const link of leverJobLinks) {
            seenUrls.add(link);
            // Extract company from URL
            const urlParts = link.match(/jobs\.lever\.co\/([^/]+)\//);
            const company = urlParts ? urlParts[1].replace(/-/g, " ") : "Unknown";

            allJobs.push({
              url: link,
              company,
              title: "", // Will be enriched
              description: "",
              searchQuery: query,
            });
          }

          // Also try to extract job info from markdown
          const jobBlocks = markdown.split(/\n(?=#{1,3}\s)/).filter(Boolean);
          for (const block of jobBlocks) {
            const titleMatch = block.match(/#{1,3}\s*\[?([^\]\n]+)\]?\(?([^)]*lever\.co[^)]*)\)?/);
            if (titleMatch && titleMatch[2] && !seenUrls.has(titleMatch[2])) {
              seenUrls.add(titleMatch[2]);
              const urlParts = titleMatch[2].match(/jobs\.lever\.co\/([^/]+)\//);
              allJobs.push({
                url: titleMatch[2],
                company: urlParts ? urlParts[1].replace(/-/g, " ") : "Unknown",
                title: titleMatch[1].trim(),
                description: block.substring(0, 500),
                searchQuery: query,
              });
            }
          }

          console.log(
            `[LeverResearch] Query "${query}" found ${leverJobLinks.length} job links`
          );
        } catch (e) {
          console.error(`[LeverResearch] Error scraping query "${query}":`, e);
        }
      }

      console.log(`[LeverResearch] Total unique jobs found: ${allJobs.length}`);

      if (allJobs.length === 0) {
        await updateRun(supabase, runId, "completed", {
          jobs_found: 0,
          jobs_qualified: 0,
          message: "No jobs found on Lever for the inferred queries",
        });

        return new Response(
          JSON.stringify({
            success: true,
            jobs: [],
            stats: { found: 0, qualified: 0, queries: queryData.queries },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ---- STEP 4: Enrich jobs with details (batch scrape top jobs) ----
      const jobsToEnrich = allJobs.slice(0, 20); // Cap at 20 to avoid timeout
      const enrichedJobs: LeverJob[] = [];

      for (const job of jobsToEnrich) {
        try {
          const detailResult = await fetch(
            "https://api.firecrawl.dev/v1/scrape",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: job.url,
                formats: ["markdown"],
                onlyMainContent: true,
                waitFor: 2000,
              }),
            }
          );

          if (detailResult.ok) {
            const detailData = await detailResult.json();
            const md = detailData.data?.markdown || detailData.markdown || "";

            // Extract title from markdown
            const titleMatch = md.match(/^#\s+(.+)/m);
            if (titleMatch) job.title = titleMatch[1].trim();

            // Extract location
            const locMatch = md.match(/(?:Location|📍|🌍)[:\s]*([^\n]+)/i);
            if (locMatch) job.location = locMatch[1].trim();

            job.description = md.substring(0, 2000);
            enrichedJobs.push(job);
          } else {
            // Use what we have
            enrichedJobs.push(job);
          }
        } catch (e) {
          enrichedJobs.push(job);
        }
      }

      // ---- STEP 5: AI scores compatibility ----
      const scoringPrompt = `You are a job compatibility scorer. Score each job against the candidate's profile.

CANDIDATE PROFILE:
- Title: ${title}
- Key Skills: ${queryData.keySkills.join(", ")}
- Seniority: ${queryData.seniorityLevel}
- Target Roles: ${queryData.targetRoles.join(", ")}
- Industries: ${queryData.industries.join(", ")}
- Experience: ${resume.experience_years || "unknown"} years

JOBS TO SCORE (return JSON array):
${enrichedJobs
  .map(
    (j, i) => `
JOB ${i + 1}:
- URL: ${j.url}
- Title: ${j.title || "Unknown"}
- Company: ${j.company}
- Description snippet: ${(j.description || "").substring(0, 400)}
`
  )
  .join("\n")}

Return a JSON array of objects:
[{
  "index": number (0-based),
  "score": number (0-100, compatibility score),
  "matchReasons": string[] (2-3 specific reasons for compatibility),
  "concerns": string[] (0-2 potential mismatches),
  "recommendation": "apply" | "review" | "skip"
}]

Score HONESTLY. 80+ means strong match. Consider: skill overlap, seniority fit, role alignment, industry relevance.`;

      const scoringResponse = await callOpenAI(OPENAI_API_KEY, {
        model: "gpt-4o",
        messages: [
          { role: "system", content: scoringPrompt },
          { role: "user", content: "Score all jobs now." },
        ],
        temperature: 0.2,
      });

      const scores = parseJSON(scoringResponse);
      if (!Array.isArray(scores)) throw new Error("Scoring failed - invalid response");

      await logAgent(supabase, userId, runId, "job_scoring", {
        total_scored: scores.length,
      });

      // ---- STEP 6: Filter 80+ and build result ----
      const qualifiedJobs: ScoredJob[] = [];

      for (const score of scores) {
        const job = enrichedJobs[score.index];
        if (!job) continue;

        if (score.score >= 80) {
          qualifiedJobs.push({
            url: job.url,
            title: job.title || "Unknown Position",
            company: job.company,
            location: job.location,
            score: score.score,
            matchReasons: score.matchReasons || [],
            concerns: score.concerns || [],
            recommendation: score.recommendation || "apply",
            searchQuery: job.searchQuery,
          });
        }
      }

      // Sort by score descending
      qualifiedJobs.sort((a, b) => b.score - a.score);

      console.log(
        `[LeverResearch] Qualified jobs (80+): ${qualifiedJobs.length} out of ${enrichedJobs.length}`
      );

      // ---- STEP 7: Save qualified jobs to DB ----
      for (const job of qualifiedJobs) {
        try {
          await supabase.from("jobs").insert({
            user_id: userId,
            title: job.title,
            company: job.company,
            location: job.location || null,
            url: job.url,
            match_score: job.score,
            source: "lever_research_agent",
            platform: "lever",
            description: `Match reasons: ${job.matchReasons.join("; ")}`,
          });
        } catch (e) {
          console.error(`[LeverResearch] Error saving job:`, e);
        }
      }

      // Update agent run
      await updateRun(supabase, runId, "completed", {
        jobs_found: allJobs.length,
        jobs_enriched: enrichedJobs.length,
        jobs_qualified: qualifiedJobs.length,
        queries_used: queryData.queries,
        target_roles: queryData.targetRoles,
        seniority: queryData.seniorityLevel,
      });

      const result = {
        success: true,
        jobs: qualifiedJobs,
        stats: {
          found: allJobs.length,
          enriched: enrichedJobs.length,
          qualified: qualifiedJobs.length,
          queries: queryData.queries,
          targetRoles: queryData.targetRoles,
          seniorityLevel: queryData.seniorityLevel,
        },
        skyvernUrls: qualifiedJobs
          .filter((j) => j.recommendation === "apply")
          .map((j) => j.url),
      };

      console.log(
        `[LeverResearch] Complete. ${result.skyvernUrls.length} URLs ready for Skyvern`
      );

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (innerError: unknown) {
      const msg =
        innerError instanceof Error ? innerError.message : "Research failed";
      console.error(`[LeverResearch] Error:`, innerError);
      await updateRun(supabase, runId, "failed", { error: msg });
      throw innerError;
    }
  } catch (error: unknown) {
    console.error("[LeverResearch] Fatal error:", error);
    const message =
      error instanceof Error ? error.message : "Job research failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =============================================
// Types
// =============================================

interface LeverJob {
  url: string;
  company: string;
  title: string;
  description: string;
  location?: string;
  searchQuery: string;
}

interface ScoredJob {
  url: string;
  title: string;
  company: string;
  location?: string;
  score: number;
  matchReasons: string[];
  concerns: string[];
  recommendation: string;
  searchQuery: string;
}

// =============================================
// Helpers
// =============================================

async function callOpenAI(
  apiKey: string,
  body: any
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJSON(text: string): any {
  try {
    // Try direct parse
    return JSON.parse(text);
  } catch {
    // Extract JSON from markdown code blocks or mixed text
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error("No valid JSON found in response");
  }
}

async function logAgent(
  supabase: any,
  userId: string,
  runId: string | undefined,
  step: string,
  data: any
) {
  await supabase.from("agent_logs").insert({
    user_id: userId,
    agent_name: "lever_research_agent",
    log_level: "info",
    task_id: runId || null,
    message: `Step: ${step}`,
    metadata: data,
  });
}

async function updateRun(
  supabase: any,
  runId: string | undefined,
  status: string,
  summary: any
) {
  if (!runId) return;
  await supabase
    .from("agent_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      summary_json: summary,
    })
    .eq("id", runId);
}
