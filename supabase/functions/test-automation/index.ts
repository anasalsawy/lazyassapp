import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Test endpoint to run the full automation pipeline
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { action, userId, email } = await req.json();

    const results: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      action,
      steps: [],
    };

    // Use provided userId or get first test user
    let testUserId = userId;
    let testEmail = email || "anasalsawy@gmail.com";

    if (!testUserId) {
      const { data: users } = await supabase
        .from("profiles")
        .select("user_id, email")
        .limit(1)
        .single();
      
      if (users) {
        testUserId = users.user_id;
        testEmail = users.email || testEmail;
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

    (results.steps as unknown[]).push({
      step: 1,
      name: "Fetch user data",
      success: true,
      data: {
        hasPreferences: !!preferences,
        hasResume: !!resume,
        hasSettings: !!settings,
        jobTitles: preferences?.job_titles || [],
        skills: resume?.skills || [],
      },
    });

    // ============ STEP 2: Scrape jobs (if action includes it) ============
    if (action === "full" || action === "scrape") {
      console.log("Step 2: Scraping jobs...");
      
      const jobTitles = preferences?.job_titles?.length ? preferences.job_titles : ["Software Engineer"];
      const locations = preferences?.locations?.length ? preferences.locations : ["Remote"];
      
      let scrapedJobs: unknown[] = [];
      
      if (FIRECRAWL_API_KEY) {
        // Scrape jobs from Firecrawl
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
              query: query + " site:linkedin.com/jobs OR site:indeed.com",
              limit: 5,
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
Return JSON array: [{"title":string,"company":string,"location":string,"matchScore":number(0-100),"url":string,"description":string}]`,
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
          const { error } = await supabase.from("jobs").upsert({
            user_id: testUserId,
            external_id: job.url || `${job.company}-${job.title}`.replace(/\s+/g, "-"),
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
        }

        (results.steps as unknown[]).push({
          step: 3,
          name: "Extract & save jobs",
          success: savedCount > 0,
          data: { extracted: extractedJobs.length, saved: savedCount },
        });
      }
    }

    // ============ STEP 4: Get existing jobs ============
    const { data: existingJobs } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", testUserId)
      .order("match_score", { ascending: false })
      .limit(5);

    (results.steps as unknown[]).push({
      step: 4,
      name: "Fetch existing jobs",
      success: true,
      data: { 
        count: existingJobs?.length || 0,
        jobs: existingJobs?.map(j => ({ title: j.title, company: j.company, score: j.match_score })),
      },
    });

    // ============ STEP 5: Send notification email ============
    if ((action === "full" || action === "email") && MAILGUN_API_KEY && MAILGUN_DOMAIN) {
      console.log("Step 5: Sending email notification...");

      const jobsList = existingJobs?.slice(0, 3).map(j => 
        `• ${j.title} at ${j.company} (${j.match_score}% match)`
      ).join("\n") || "No jobs found yet";

      const formData = new FormData();
      const fromAddress = MAILGUN_DOMAIN.includes("sandbox")
        ? `LazyAss <postmaster@${MAILGUN_DOMAIN}>`
        : `LazyAss <noreply@${MAILGUN_DOMAIN}>`;
      
      formData.append("from", fromAddress);
      formData.append("to", testEmail);
      formData.append("subject", "🚀 Automation Test Complete - LazyAss");
      formData.append("html", `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #18181b; color: #fff; padding: 32px; border-radius: 12px;">
          <h1 style="color: #6366f1;">✅ Automation Pipeline Test</h1>
          <p>The full automation pipeline has been tested successfully!</p>
          
          <h3 style="color: #10b981;">📊 Test Results:</h3>
          <ul>
            ${(results.steps as { step: number; name: string; success: boolean }[]).map((s) => 
              `<li>${s.success ? "✅" : "❌"} Step ${s.step}: ${s.name}</li>`
            ).join("")}
          </ul>
          
          <h3 style="color: #f59e0b;">💼 Top Job Matches:</h3>
          <pre style="background: #27272a; padding: 16px; border-radius: 8px;">${jobsList}</pre>
          
          <p style="color: #71717a; font-size: 12px; margin-top: 24px;">
            Tested at: ${new Date().toISOString()}
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
        step: 5,
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
      message: "Automation pipeline test completed",
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
