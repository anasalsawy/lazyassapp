// VoiceOps Supervisor Bridge
// -----------------------------------------------------------------------------
// Bridges a Vapi call's live audio (`monitor.listenUrl`, 16-bit PCM 16 kHz mono)
// into a Twilio <Connect><Stream> media stream (mulaw 8 kHz mono) so the
// supervisor's phone hears the live call in real time.
//
// Monitor-only: supervisor's mic audio from Twilio is discarded here. It is
// never forwarded to Vapi. To add whisper/barge later, forward decoded
// supervisor audio to a Vapi control endpoint or a separate "coach" channel.
//
// Deploy anywhere that supports long-lived Node processes with public HTTPS/WSS
// (Render, Fly.io, Railway). Set the resulting wss:// URL as
// `SUPERVISOR_BRIDGE_URL` in the Lovable project secrets (e.g.
// wss://voiceops-bridge.onrender.com/twilio).
// -----------------------------------------------------------------------------

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, path: "/twilio" });

wss.on("connection", (twilioWs) => {
  console.log("[bridge] Twilio connected");
  let vapiWs = null;
  let streamSid = null;
  let vapiListenUrl = null;
  let callId = null;

  const closeAll = () => {
    try { vapiWs?.close(); } catch {}
    try { twilioWs?.close(); } catch {}
  };

  twilioWs.on("message", (data) => {
    let evt;
    try { evt = JSON.parse(data.toString()); } catch { return; }
    if (evt.event === "start") {
      streamSid = evt.start.streamSid;
      const params = evt.start.customParameters || {};
      vapiListenUrl = params.vapi_listen_url;
      callId = params.call_id;
      console.log(`[bridge] start streamSid=${streamSid} callId=${callId}`);
      if (!vapiListenUrl) {
        console.error("[bridge] no vapi_listen_url provided");
        return closeAll();
      }
      openVapi(vapiListenUrl, twilioWs, streamSid).then((ws) => { vapiWs = ws; }).catch((e) => {
        console.error("[bridge] vapi connect error", e);
        closeAll();
      });
    } else if (evt.event === "stop") {
      console.log(`[bridge] stop streamSid=${streamSid}`);
      closeAll();
    }
    // evt.event === "media" is supervisor mic audio — discarded (monitor-only).
  });

  twilioWs.on("close", () => { console.log("[bridge] Twilio closed"); closeAll(); });
  twilioWs.on("error", (e) => { console.error("[bridge] Twilio ws error", e); closeAll(); });
});

// -----------------------------------------------------------------------------
// Vapi audio → Twilio
// -----------------------------------------------------------------------------
// Vapi monitor listen socket streams raw binary L16 PCM 16 kHz mono little-endian.
// Twilio Media Stream expects base64 μ-law 8 kHz mono chunks in JSON:
//   { event: "media", streamSid, media: { payload: <base64> } }
// We downsample 16k→8k (simple decimation is fine for voice) then μ-law encode.

async function openVapi(listenUrl, twilioWs, streamSid) {
  const ws = new WebSocket(listenUrl);
  ws.binaryType = "arraybuffer";

  ws.on("open", () => console.log("[bridge] Vapi connected", listenUrl));
  ws.on("close", () => console.log("[bridge] Vapi closed"));
  ws.on("error", (e) => console.error("[bridge] Vapi ws error", e));

  ws.on("message", (data, isBinary) => {
    if (!isBinary) return; // Vapi occasionally sends JSON control frames
    const pcm16k = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
    const pcm8k = downsample16to8(pcm16k);
    const ulaw = pcm16ToMulaw(pcm8k);
    // Send in ~20ms chunks (160 samples @ 8kHz)
    const CHUNK = 160;
    for (let i = 0; i < ulaw.length; i += CHUNK) {
      const slice = ulaw.subarray(i, Math.min(i + CHUNK, ulaw.length));
      const payload = Buffer.from(slice).toString("base64");
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload } }));
      }
    }
  });

  return ws;
}

// Simple 2:1 decimation with a light averaging low-pass. Fine for narrowband voice.
function downsample16to8(pcm16k) {
  const out = new Int16Array(Math.floor(pcm16k.length / 2));
  for (let i = 0, j = 0; j < out.length; i += 2, j++) {
    out[j] = (pcm16k[i] + pcm16k[i + 1]) >> 1;
  }
  return out;
}

// Standard G.711 μ-law encoder.
function pcm16ToMulaw(pcm) {
  const MU = 0xff;
  const BIAS = 0x84;
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i];
    let sign = (sample >> 8) & 0x80;
    if (sign) sample = -sample;
    if (sample > 32635) sample = 32635;
    sample += BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & MU;
  }
  return out;
}

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT}  (ws path: /twilio, health: /health)`);
});
