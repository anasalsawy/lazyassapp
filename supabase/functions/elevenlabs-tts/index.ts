import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * ElevenLabs TTS endpoint for Twilio <Play>.
 * Twilio fetches this URL and plays the returned audio.
 * 
 * Usage: GET ?text=Hello&voice_id=EXAVITQu4vr4xnSDxMaL
 */

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Sarah - warm, professional female

serve(async (req) => {
  const url = new URL(req.url);
  const text = url.searchParams.get("text") || "Hello";
  const voiceId = url.searchParams.get("voice_id") || DEFAULT_VOICE_ID;

  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY) {
    console.error("[elevenlabs-tts] ELEVENLABS_API_KEY not configured");
    return new Response("TTS not configured", { status: 500 });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
            speed: 1.05,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[elevenlabs-tts] ElevenLabs error:", response.status, errText);
      return new Response("TTS generation failed", { status: 500 });
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("[elevenlabs-tts] Error:", e);
    return new Response("TTS error", { status: 500 });
  }
});
