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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { resumeId, resumeText: providedText, jobDescription } = await req.json();

    let resumeText = providedText;
    let existingParsedContent: any = null;

    // If resumeId is provided but no text, fetch and parse the resume
    if (resumeId && !resumeText) {
      console.log(`Fetching resume with ID: ${resumeId}`);
      
      // Get resume record
      const { data: resume, error: resumeError } = await supabase
        .from("resumes")
        .select("*")
        .eq("id", resumeId)
        .single();

      if (resumeError || !resume) {
        console.error("Resume not found:", resumeError);
        return new Response(
          JSON.stringify({ error: "Resume not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      existingParsedContent = resume.parsed_content ?? null;

      // If resume already has extracted text saved, use it
      if (resume.parsed_content?.rawText) {
        resumeText = resume.parsed_content.rawText;
      } else if (resume.parsed_content?.fullText) {
        resumeText = resume.parsed_content.fullText;
      } else if (resume.parsed_content?.text) {
        resumeText = resume.parsed_content.text;
      } else if (resume.file_path) {
        // Download the file from storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("resumes")
          .download(resume.file_path);

        if (downloadError || !fileData) {
          console.error("Failed to download resume file:", downloadError);
          return new Response(
            JSON.stringify({ error: "Failed to download resume file" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // For PDF files, we'll extract basic text (simplified approach)
        // In production, you'd use a PDF parsing library
        const arrayBuffer = await fileData.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Try to extract text content from PDF
        // This is a simplified extraction - for production, use a proper PDF library
        let extractedText = "";
        try {
          // Convert bytes to string and look for text patterns
          const textDecoder = new TextDecoder("utf-8", { fatal: false });
          const rawText = textDecoder.decode(bytes);
          
          // Extract readable text portions (simplified PDF text extraction)
          const textMatches = rawText.match(/\(([^)]+)\)/g);
          if (textMatches) {
            extractedText = textMatches
              .map(m => m.slice(1, -1))
              .filter(t => t.length > 2 && /[a-zA-Z]/.test(t))
              .join(" ");
          }
          
          // If we couldn't extract much, use filename as context
          if (extractedText.length < 100) {
            extractedText = `Resume document: ${resume.original_filename || resume.title}. Please analyze this as a professional resume and provide general optimization suggestions.`;
          }
        } catch (e) {
          console.error("Text extraction error:", e);
          extractedText = `Resume document: ${resume.original_filename || resume.title}. Please analyze this as a professional resume and provide general optimization suggestions.`;
        }
        
        resumeText = extractedText;
        
        // Store extracted text for future use (without clobbering other fields)
        await supabase
          .from("resumes")
          .update({
            parsed_content: {
              ...(existingParsedContent ?? {}),
              rawText: resumeText,
              fullText: resumeText,
              text: resumeText,
              extractedAt: new Date().toISOString(),
            },
          })
          .eq("id", resumeId);
      }
    }

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required. Please provide resumeText or a valid resumeId with an uploaded file." }),
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

    // If we have a resumeId, update the resume record with analysis
    if (resumeId) {
      // If we didn't load the resume earlier (e.g., caller provided resumeText), fetch existing parsed_content to merge safely.
      if (!existingParsedContent) {
        const { data: existing } = await supabase
          .from("resumes")
          .select("parsed_content")
          .eq("id", resumeId)
          .single();
        existingParsedContent = existing?.parsed_content ?? null;
      }

      await supabase
        .from("resumes")
        .update({
          ats_score: analysis.atsScore,
          skills: analysis.skills,
          experience_years: analysis.experienceYears,
          parsed_content: {
            ...(existingParsedContent ?? {}),
            ...analysis,
            // Persist the full extracted resume text so job matching can use it reliably.
            rawText: resumeText,
            fullText: resumeText,
            text: resumeText,
            analyzedAt: new Date().toISOString(),
          },
        })
        .eq("id", resumeId);
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
