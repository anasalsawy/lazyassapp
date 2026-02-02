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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate analytics
    const { data: applications, error: appError } = await supabase
      .from("applications")
      .select("id, status, applied_at, response_at")
      .eq("user_id", user.id);

    if (appError) {
      throw appError;
    }

    const totalApplications = applications?.length || 0;
    const responses = applications?.filter(a => 
      ["under_review", "interview", "offer", "rejected"].includes(a.status)
    ) || [];
    const totalResponses = responses.length;
    const totalInterviews = applications?.filter(a => a.status === "interview").length || 0;
    const totalOffers = applications?.filter(a => a.status === "offer").length || 0;
    const responseRate = totalApplications > 0 
      ? Math.round((totalResponses / totalApplications) * 100 * 100) / 100
      : 0;

    // Calculate average response time
    let avgResponseDays = null;
    const responsesWithTime = responses.filter(r => r.response_at && r.applied_at);
    if (responsesWithTime.length > 0) {
      const totalDays = responsesWithTime.reduce((sum, r) => {
        const applied = new Date(r.applied_at);
        const response = new Date(r.response_at);
        return sum + (response.getTime() - applied.getTime()) / (1000 * 60 * 60 * 24);
      }, 0);
      avgResponseDays = Math.round((totalDays / responsesWithTime.length) * 100) / 100;
    }

    // Get top skills from resumes
    const { data: resumes } = await supabase
      .from("resumes")
      .select("skills")
      .eq("user_id", user.id);

    const allSkills = resumes?.flatMap(r => r.skills || []) || [];
    const skillCounts = allSkills.reduce((acc: Record<string, number>, skill: string) => {
      acc[skill] = (acc[skill] || 0) + 1;
      return acc;
    }, {});
    const topSkills = Object.entries(skillCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 10)
      .map(([skill]) => skill);

    // Update analytics
    const { error: updateError } = await supabase
      .from("user_analytics")
      .upsert({
        user_id: user.id,
        total_applications: totalApplications,
        total_responses: totalResponses,
        total_interviews: totalInterviews,
        total_offers: totalOffers,
        response_rate: responseRate,
        avg_response_days: avgResponseDays,
        top_skills: topSkills,
        last_calculated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (updateError) {
      console.error("Error updating analytics:", updateError);
    }

    const analytics = {
      totalApplications,
      totalResponses,
      totalInterviews,
      totalOffers,
      responseRate,
      avgResponseDays,
      topSkills,
    };

    console.log("Analytics calculated:", analytics);

    return new Response(
      JSON.stringify({ success: true, analytics }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error calculating analytics:", error);
    const message = error instanceof Error ? error.message : "Failed to calculate analytics";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
