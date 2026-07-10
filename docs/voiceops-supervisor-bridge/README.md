# VoiceOps Supervisor Bridge

Tiny Node WebSocket relay that lets your phone hear a live Vapi call in
real time (monitor-only, phase 1 of the supervisor mode).

```
Vapi call audio (PCM 16 kHz)
        │  wss  (monitor.listenUrl)
        ▼
┌──────────────────────┐
│  this worker         │  downsample + μ-law encode
└──────────────────────┘
        │  wss  (Twilio Media Streams)
        ▼
Twilio Programmable Voice
        │  PSTN
        ▼
Your phone (+1 209 933 2395)
```

Your mic audio from Twilio is discarded. Whisper/barge will be added in
phase 2.

## Deploy to Render (fastest, 5 minutes, free tier is fine)

1. Push this folder to a new GitHub repo (or use Render's "Deploy from
   local").
2. Create a new **Web Service** on https://render.com.
3. Runtime: **Node**. Build command: `npm install`. Start: `npm start`.
4. Health check path: `/health`.
5. Once deployed, take the service URL (e.g. `https://voiceops-bridge-xxxx.onrender.com`)
   and add it as a Lovable secret named **`SUPERVISOR_BRIDGE_URL`** with the
   `wss://` scheme and `/twilio` path:
   ```
   wss://voiceops-bridge-xxxx.onrender.com/twilio
   ```

## Other required Lovable secrets

| Secret | Purpose |
| --- | --- |
| `SUPERVISOR_PHONE` | E.164 number to dial (already set to +12099332395) |
| `TWILIO_VOICE_NUMBER` | E.164 Twilio voice-capable "From" number |
| `TWILIO_ACCOUNT_SID` | already set |
| `TWILIO_AUTH_TOKEN` | already set |
| `SUPERVISOR_BRIDGE_URL` | `wss://…/twilio` from the deploy above |

## Test locally

```
npm install
PORT=8080 npm start
# Then expose with ngrok:
ngrok http 8080
# Use  wss://<ngrok>.ngrok.io/twilio  as SUPERVISOR_BRIDGE_URL
```

## Notes / limits

- Uses simple 2:1 decimation. Voice quality is fine; music won't be.
- Render free tier sleeps after 15 min idle — first call after idle
  takes ~30 s cold start. Upgrade to Starter ($7/mo) for production.
- Twilio charges per-minute for the outbound voice leg to your phone.
