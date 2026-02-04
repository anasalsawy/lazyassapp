# Browser-Use Bridge (Self-hosted)

This repository contains a self-hosted bridge to run Browser-Use / Playwright tasks on your own server with **custom proxy support**.

## Quick Start (Docker)

### 1. Build and run directly:
```bash
docker build -t browser-use-bridge .
docker run -e BRIDGE_API_KEY="your_key" -p 8000:8000 browser-use-bridge
```

### 2. Or with docker-compose:
```bash
BRIDGE_API_KEY=your_key docker-compose up --build -d
```

### 3. Test the health endpoint:
```bash
curl -X POST http://localhost:8000/health
```

### 4. Run a test task with proxy:
```bash
curl -X POST http://localhost:8000/run-task \
  -H "Authorization: Bearer your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "https://api.ipify.org?format=json",
    "proxy": {
      "server": "http://proxy.example.com:8080",
      "username": "user",
      "password": "pass"
    }
  }'
```

## Deploy to Render

1. Push this folder to a GitHub repository
2. Create a new Web Service on Render
3. Connect your GitHub repo
4. Set Environment Variables:
   - `BRIDGE_API_KEY` = create a secret key (e.g., `my-super-secret-key-123`)
5. Render will use the `render.yaml` for build/start commands

## API Endpoints

### POST /run-task
Run a browser automation task with optional proxy.

```json
{
  "task": "Go to amazon.com and search for 'laptop'",
  "profile_id": "optional-profile-id",
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "user",
    "password": "pass"
  }
}
```

**Response:**
```json
{
  "run_id": "abc123",
  "status_url": "/runs/abc123/status",
  "screenshot_url": "/runs/abc123/screenshot"
}
```

### GET /runs/{run_id}/status
Check the status of a running task.

### GET /runs/{run_id}/screenshot
Get the screenshot from a completed task.

### POST /sessions
Create an interactive session (human-in-the-loop).

### GET /sessions/{sid}/live
Get the live view screenshot of a session.

### POST /sessions/{sid}/complete
Complete a session and save the profile.

### GET /profiles/{profile_id}
Download a saved profile as a ZIP file.

### DELETE /profiles/{profile_id}
Delete a saved profile.

### POST /health
Health check endpoint.

## Connecting to Lovable

Once deployed, add these secrets to your Lovable project:

| Secret Name | Value |
|-------------|-------|
| `BROWSER_USE_BRIDGE_URL` | `https://your-bridge.onrender.com` |
| `BROWSER_USE_BRIDGE_API_KEY` | Your `BRIDGE_API_KEY` value |

The edge functions will automatically route tasks through this bridge when a custom proxy is configured.

## Notes

- **Profile Persistence**: Profiles are stored in `./profiles` and runs in `./runs`. When using docker-compose, these are mounted as volumes to persist across restarts.
- **Headless Mode**: The bridge runs in headless mode by default. For interactive sessions requiring a real desktop, consider running on a VM with X server / noVNC.
- **Playwright**: Falls back to raw Playwright if browser-use library has issues.
