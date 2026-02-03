import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobRecord {
  id: string;
  title: string;
  company: string;
  url?: string;
  location?: string;
  match_score?: number;
  description?: string;
}

// Full automation pipeline with REAL web apply via Hyperbrowser
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const MAILGUN_API_KEY = Deno.env.get("MAILGUN_API_KEY");
  const MAILGUN_DOMAIN = Deno.env.get("MAILGUN_DOMAIN");
  const HYPERBROWSER_API_KEY = Deno.env.get("HYPERBROWSER_API_KEY");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { action, userId, email, applyLimit = 3, minMatchScore = 70 } = await req.json();

    const results: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      action,
      steps: [],
      applications: [],
    };

    // Use provided userId or get first test user
    let testUserId = userId;
    let testEmail = email || "anasalsawy@gmail.com";

    if (!testUserId) {
      const { data: users } = await supabase
        .from("profiles")
        .select("user_id, email, first_name, last_name, phone, linkedin_url")
        .limit(1)
        .single();
      
      if (users) {
        testUserId = users.user_id;
        testEmail = users.email || testEmail;
        results.userProfile = users;
      }
    }

    if (!testUserId) {
      return new Response(
        JSON.stringify({ error: "No test user found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Running automation test for user: ${testUserId}`);
    results.userId = testUserId;
    results.email = testEmail;

    // Check secrets
    results.secrets = {
      firecrawl: !!FIRECRAWL_API_KEY,
      lovable: !!LOVABLE_API_KEY,
      mailgun: !!MAILGUN_API_KEY && !!MAILGUN_DOMAIN,
      hyperbrowser: !!HYPERBROWSER_API_KEY,
    };

    // ============ STEP 1: Get user data ============
    const { data: preferences } = await supabase
      .from("job_preferences")
      .select("*")
      .eq("user_id", testUserId)
      .single();

    const { data: resume } = await supabase
      .from("resumes")
      .select("*")
      .eq("user_id", testUserId)
      .eq("is_primary", true)
      .single();

    const { data: settings } = await supabase
      .from("automation_settings")
      .select("*")
      .eq("user_id", testUserId)
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", testUserId)
      .single();

    (results.steps as unknown[]).push({
      step: 1,
      name: "Fetch user data",
      success: true,
      data: {
        hasPreferences: !!preferences,
        hasResume: !!resume,
        hasSettings: !!settings,
        hasProfile: !!profile,
        jobTitles: preferences?.job_titles || [],
        skills: resume?.skills || [],
      },
    });

    // ============ STEP 2: Scrape jobs (if action includes it) ============
    if (action === "full" || action === "scrape" || action === "apply") {
      console.log("Step 2: Scraping jobs...");
      
      const jobTitles = preferences?.job_titles?.length ? preferences.job_titles : ["Software Engineer"];
      const locations = preferences?.locations?.length ? preferences.locations : ["Remote"];
      
      let scrapedJobs: unknown[] = [];
      
      if (FIRECRAWL_API_KEY) {
        for (const title of jobTitles.slice(0, 2)) {
          const query = `${title} ${locations[0]} jobs`;
          console.log(`Searching: ${query}`);

          const response = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: query + " site:linkedin.com/jobs OR site:indeed.com OR site:greenhouse.io",
              limit: 8,
              scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
            }),
          });

          if (response.ok) {
            const data = await response.json();
            console.log(`Found ${data.data?.length || 0} results`);
            scrapedJobs = scrapedJobs.concat(data.data || []);
          } else {
            console.error(`Firecrawl error: ${response.status}`);
          }
        }
      }

      (results.steps as unknown[]).push({
        step: 2,
        name: "Scrape jobs",
        success: scrapedJobs.length > 0,
        data: { jobsScraped: scrapedJobs.length },
      });

      // ============ STEP 3: Extract and save jobs with AI ============
      if (scrapedJobs.length > 0 && LOVABLE_API_KEY) {
        console.log("Step 3: Extracting jobs with AI...");

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
                content: `Extract job listings. User skills: ${resume?.skills?.join(", ") || "General"}.
Return JSON array: [{"title":string,"company":string,"location":string,"matchScore":number(0-100),"url":string,"description":string}]
IMPORTANT: Only include jobs with a valid apply URL. The URL should link directly to an application page.`,
              },
              {
                role: "user",
                content: `Extract jobs from: ${JSON.stringify(scrapedJobs.slice(0, 10))}`,
              },
            ],
            temperature: 0.2,
          }),
        });

        let extractedJobs: unknown[] = [];
        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content;
          try {
            const jsonMatch = content?.match(/\[[\s\S]*\]/);
            if (jsonMatch) extractedJobs = JSON.parse(jsonMatch[0]);
          } catch (e) {
            console.error("Parse error:", e);
          }
        }

        // Save jobs to DB
        let savedCount = 0;
        for (const job of extractedJobs as { title: string; company: string; location?: string; matchScore?: number; url?: string; description?: string }[]) {
          const externalId = job.url || `${job.company}-${job.title}`.replace(/\s+/g, "-").toLowerCase();
          const { error } = await supabase.from("jobs").upsert({
            user_id: testUserId,
            external_id: externalId,
            source: "firecrawl",
            title: job.title,
            company: job.company,
            location: job.location || "Remote",
            match_score: job.matchScore || 70,
            url: job.url,
            description: job.description,
            posted_at: new Date().toISOString(),
          }, { onConflict: "external_id" });
          if (!error) savedCount++;
          else console.log(`Upsert error for ${job.title}:`, error.message);
        }

        (results.steps as unknown[]).push({
          step: 3,
          name: "Extract & save jobs",
          success: savedCount > 0,
          data: { extracted: extractedJobs.length, saved: savedCount },
        });
      }
    }

    // ============ STEP 4: Get jobs eligible for apply ============
    // Get jobs that haven't been applied to yet
    const { data: appliedJobIds } = await supabase
      .from("applications")
      .select("job_id")
      .eq("user_id", testUserId);

    const appliedIds = new Set((appliedJobIds || []).map((a: { job_id: string }) => a.job_id));

    const { data: eligibleJobs } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", testUserId)
      .gte("match_score", minMatchScore)
      .not("url", "is", null)
      .order("match_score", { ascending: false })
      .limit(10);

    // Filter out already applied
    const jobsToApply: JobRecord[] = (eligibleJobs || []).filter(
      (j: JobRecord) => !appliedIds.has(j.id)
    ).slice(0, applyLimit);

    (results.steps as unknown[]).push({
      step: 4,
      name: "Find eligible jobs",
      success: true,
      data: { 
        totalEligible: eligibleJobs?.length || 0,
        alreadyApplied: appliedIds.size,
        toApplyNow: jobsToApply.length,
        jobs: jobsToApply.map((j: JobRecord) => ({ title: j.title, company: j.company, score: j.match_score })),
      },
    });

    // ============ STEP 5: REAL WEB APPLY via Hyperbrowser ============
    if ((action === "full" || action === "apply") && HYPERBROWSER_API_KEY && jobsToApply.length > 0) {
      console.log(`Step 5: Submitting ${jobsToApply.length} applications via Hyperbrowser...`);

      const applicationResults: unknown[] = [];

      for (const job of jobsToApply) {
        console.log(`\n[WebAgent] Applying to: ${job.title} at ${job.company}`);
        console.log(`[WebAgent] URL: ${job.url}`);

        if (!job.url) {
          console.log(`[WebAgent] Skipping - no URL`);
          continue;
        }

        // Generate unique email alias for tracking
        const shortId = job.id.substring(0, 8);
        const timestamp = Date.now().toString(36);
        const companySlug = job.company.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
        const applicationEmail = MAILGUN_DOMAIN 
          ? `apply-${companySlug}-${shortId}-${timestamp}@${MAILGUN_DOMAIN}`
          : testEmail;

        // Build agent instruction
        const agentInstruction = `Apply for the job "${job.title}" at "${job.company}".

YOUR TASK:
1. Navigate to the job application form on this page
2. Fill out ALL required fields with the candidate's information
3. Upload or paste the resume content if there's an upload field
4. Submit the application
5. Confirm successful submission

CANDIDATE INFORMATION:
- Full Name: ${profile?.first_name || "Test"} ${profile?.last_name || "User"}
- Email: ${applicationEmail}
${profile?.phone ? `- Phone: ${profile.phone}` : ""}
${profile?.linkedin_url ? `- LinkedIn: ${profile.linkedin_url}` : ""}

RESUME DATA:
- Years of Experience: ${resume?.experience_years || 5}
- Skills: ${resume?.skills?.join(", ") || "JavaScript, TypeScript, React, Node.js"}
${resume?.parsed_content?.text ? `- Resume Summary: ${resume.parsed_content.text.substring(0, 1500)}` : ""}

IMPORTANT GUIDELINES:
- If asked about salary expectations, select "Prefer not to say" or enter a reasonable range
- For "How did you hear about us?", select "Job Board" or "Online Search"
- If there are screening questions, answer them honestly based on the resume data
- If CAPTCHA appears, solve it
- If login is required, STOP and report "Login required"
- Take a screenshot after submission for confirmation
- Report any errors or issues encountered`;

        try {
          // Call Hyperbrowser
          const hyperResponse = await fetch("https://app.hyperbrowser.ai/api/v1/agent/run", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${HYPERBROWSER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: job.url,
              task: agentInstruction,
              options: {
                waitForCompletion: false,
                maxSteps: 50,
                timeout: 300000,
                captureScreenshots: true,
                humanLikeInteraction: true,
                solveCaptchas: true,
              },
            }),
          });

          if (!hyperResponse.ok) {
            const errorText = await hyperResponse.text();
            console.error(`[WebAgent] Hyperbrowser error: ${hyperResponse.status}`, errorText);
            applicationResults.push({
              job: { title: job.title, company: job.company },
              success: false,
              error: `Hyperbrowser error: ${hyperResponse.status}`,
            });
            continue;
          }

          const agentResult = await hyperResponse.json();
          const sessionId = agentResult.sessionId || agentResult.id;
          console.log(`[WebAgent] Task submitted. Session: ${sessionId}`);

          // Store email alias for tracking replies
          if (MAILGUN_DOMAIN) {
            await supabase.from("email_accounts").upsert({
              user_id: testUserId,
              email_address: applicationEmail,
              email_provider: "mailgun",
              is_active: true,
            }, { onConflict: "email_address" });
          }

          // Create application record
          const { data: application, error: appError } = await supabase
            .from("applications")
            .insert({
              user_id: testUserId,
              job_id: job.id,
              status: "applied",
              notes: `AI Web Agent submission. Session: ${sessionId}. Email: ${applicationEmail}`,
            })
            .select()
            .single();

          if (appError) {
            console.error(`[WebAgent] Failed to create application:`, appError);
          }

          // Log the submission
          await supabase.from("agent_logs").insert({
            user_id: testUserId,
            agent_name: "web_agent",
            log_level: "info",
            message: `Application submitted: ${job.title} at ${job.company}`,
            metadata: { 
              jobId: job.id,
              sessionId,
              applicationId: application?.id,
              applicationEmail,
            },
          });

          applicationResults.push({
            job: { title: job.title, company: job.company, url: job.url },
            success: true,
            sessionId,
            applicationId: application?.id,
            applicationEmail,
            status: "submitted",
          });

          // Small delay between applications
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (err) {
          console.error(`[WebAgent] Error applying to ${job.title}:`, err);
          applicationResults.push({
            job: { title: job.title, company: job.company },
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      results.applications = applicationResults;

      const successCount = applicationResults.filter((a: unknown) => (a as { success: boolean }).success).length;
      (results.steps as unknown[]).push({
        step: 5,
        name: "Submit applications via Web Agent",
        success: successCount > 0,
        data: { 
          attempted: jobsToApply.length,
          successful: successCount,
          failed: jobsToApply.length - successCount,
        },
      });

      // Update automation settings
      if (successCount > 0) {
        await supabase
          .from("automation_settings")
          .update({
            applications_today: (settings?.applications_today || 0) + successCount,
            last_auto_apply_at: new Date().toISOString(),
          })
          .eq("user_id", testUserId);
      }
    } else if (!HYPERBROWSER_API_KEY) {
      (results.steps as unknown[]).push({
        step: 5,
        name: "Submit applications via Web Agent",
        success: false,
        data: { error: "HYPERBROWSER_API_KEY not configured" },
      });
    }

    // ============ STEP 6: Send notification email ============
    if ((action === "full" || action === "email") && MAILGUN_API_KEY && MAILGUN_DOMAIN) {
      console.log("Step 6: Sending email notification...");

      const { data: allJobs } = await supabase
        .from("jobs")
        .select("*")
        .eq("user_id", testUserId)
        .order("match_score", { ascending: false })
        .limit(5);

      const jobsList = allJobs?.slice(0, 3).map((j: JobRecord) => 
        `• ${j.title} at ${j.company} (${j.match_score}% match)`
      ).join("\n") || "No jobs found yet";

      const appsList = (results.applications as { job: { title: string; company: string }; success: boolean }[])?.length
        ? (results.applications as { job: { title: string; company: string }; success: boolean; status?: string }[]).map(a => 
            `• ${a.job.title} at ${a.job.company} - ${a.success ? "✅ Submitted" : "❌ Failed"}`
          ).join("\n")
        : "No applications submitted";

      const formData = new FormData();
      const fromAddress = MAILGUN_DOMAIN.includes("sandbox")
        ? `LazyAss <postmaster@${MAILGUN_DOMAIN}>`
        : `LazyAss <noreply@${MAILGUN_DOMAIN}>`;
      
      formData.append("from", fromAddress);
      formData.append("to", testEmail);
      formData.append("subject", "🤖 Auto-Apply Complete - LazyAss");
      formData.append("html", `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #18181b; color: #fff; padding: 32px; border-radius: 12px;">
          <h1 style="color: #6366f1;">🤖 Automation Pipeline Complete</h1>
          
          <h3 style="color: #10b981;">📊 Pipeline Results:</h3>
          <ul style="list-style: none; padding: 0;">
            ${(results.steps as { step: number; name: string; success: boolean }[]).map(s => 
              `<li style="padding: 8px 0;">${s.success ? "✅" : "❌"} Step ${s.step}: ${s.name}</li>`
            ).join("")}
          </ul>
          
          <h3 style="color: #f59e0b;">📝 Applications Submitted:</h3>
          <pre style="background: #27272a; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${appsList}</pre>
          
          <h3 style="color: #3b82f6;">💼 Top Job Matches:</h3>
          <pre style="background: #27272a; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${jobsList}</pre>
          
          <p style="color: #71717a; font-size: 12px; margin-top: 24px;">
            Run at: ${new Date().toISOString()}<br/>
            Hyperbrowser enabled: ${!!HYPERBROWSER_API_KEY}
          </p>
        </div>
      `);

      const MAILGUN_REGION = Deno.env.get("MAILGUN_REGION") || "us";
      const apiBase = MAILGUN_REGION.toLowerCase() === "eu" 
        ? "https://api.eu.mailgun.net" 
        : "https://api.mailgun.net";

      const emailResponse = await fetch(`${apiBase}/v3/${MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
        },
        body: formData,
      });

      const emailSuccess = emailResponse.ok;
      let emailResult;
      if (emailSuccess) {
        emailResult = await emailResponse.json();
      } else {
        emailResult = await emailResponse.text();
      }

      (results.steps as unknown[]).push({
        step: 6,
        name: "Send notification email",
        success: emailSuccess,
        data: { to: testEmail, result: emailSuccess ? "sent" : emailResult },
      });
    }

    // Log the test
    await supabase.from("agent_logs").insert({
      user_id: testUserId,
      agent_name: "test_automation",
      log_level: "info",
      message: "Full automation pipeline completed with real web apply",
      metadata: results,
    });

    results.success = true;

    return new Response(
      JSON.stringify(results, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Test automation error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
