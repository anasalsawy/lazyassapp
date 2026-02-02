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
    const { resumeText, jobDescription } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are an expert resume analyst and career coach. Analyze the provided resume and provide:

1. **ATS Score** (0-100): Rate how well the resume would perform with Applicant Tracking Systems
2. **Key Strengths**: List 3-5 main strengths of the resume
3. **Areas for Improvement**: List 3-5 specific improvements needed
4. **Extracted Skills**: List all technical and soft skills found
5. **Experience Summary**: Brief summary of work experience
6. **Optimized Bullet Points**: Rewrite 3-5 bullet points to be more impactful with quantifiable achievements

${jobDescription ? `Also analyze how well this resume matches the following job description and provide specific keyword suggestions:\n\nJob Description: ${jobDescription}` : ''}

Respond in JSON format with this structure:
{
  "atsScore": number,
  "strengths": string[],
  "improvements": string[],
  "skills": string[],
  "experienceYears": number,
  "experienceSummary": string,
  "optimizedBullets": string[],
  "keywordSuggestions": string[],
  "matchScore": number | null
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
          { role: "user", content: `Analyze this resume:\n\n${resumeText}` },
        ],
        temperature: 0.3,
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

    // Parse JSON from response
    let analysis;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      console.error("Failed to parse AI response:", content);
      analysis = {
        atsScore: 70,
        strengths: ["Could not fully analyze resume"],
        improvements: ["Please try again with clearer formatting"],
        skills: [],
        experienceYears: 0,
        experienceSummary: content,
        optimizedBullets: [],
        keywordSuggestions: [],
        matchScore: null,
      };
    }

    console.log("Resume analysis completed successfully");

    return new Response(
      JSON.stringify({ success: true, analysis }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error analyzing resume:", error);
    const message = error instanceof Error ? error.message : "Failed to analyze resume";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
