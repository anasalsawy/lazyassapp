# Playwright Bridge (Command Executor)

This is a lightweight self-hosted bridge that executes **structured Playwright commands** sent from edge functions. No AI runs on the bridge — all intelligence lives in the edge function's Planner/Researcher agents.

## Architecture

```
Edge Function (Planner LLM)  →  Playwright Bridge  →  Headless Chromium
       ↑                              ↓
   OpenAI GPT-4o              Execute commands:
   generates CSS              navigate, click, type,
   selectors &                extract_text, screenshot...
   command sequences
```

## Quick Start (Docker)

```bash
docker build -t playwright-bridge .
docker run -e BRIDGE_API_KEY="your_key" -p 8000:8000 playwright-bridge
```

Or with docker-compose:
```bash
BRIDGE_API_KEY=your_key docker-compose up --build -d
```

## API Endpoints

### POST /execute (Primary)
Execute a sequence of Playwright commands.

```json
{
  "commands": [
    { "action": "navigate", "url": "https://example.com" },
    { "action": "click", "selector": "#search-button" },
    { "action": "type", "selector": "#search-input", "value": "query" },
    { "action": "press", "value": "Enter" },
    { "action": "wait", "value": "2000" },
    { "action": "extract_text", "selector": ".results .item" },
    { "action": "screenshot" }
  ],
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "user",
    "password": "pass"
  }
}
```

### Supported Commands

| Action | Params | Description |
|--------|--------|-------------|
| `navigate` | `url` | Go to URL |
| `click` | `selector` | Click element |
| `type` | `selector`, `value` | Fill input field |
| `press` | `value`, `selector?` | Press keyboard key |
| `select` | `selector`, `value` | Select dropdown option |
| `wait` | `value` (ms) | Wait N milliseconds |
| `wait_for_selector` | `selector`, `timeout?` | Wait for element to appear |
| `scroll` | `value` (down/up/bottom/top) | Scroll page |
| `screenshot` | `value?` ("full" for full page) | Capture screenshot |
| `extract_text` | `selector?` | Extract text from elements |
| `extract_html` | `selector?` | Extract HTML |
| `extract_attribute` | `selector`, `value` (attr name) | Extract attribute values |
| `evaluate` | `value` (JS code) | Run JavaScript |
| `hover` | `selector` | Hover over element |
| `check` | `selector` | Check checkbox |
| `uncheck` | `selector` | Uncheck checkbox |
| `get_url` | — | Get current URL |
| `get_title` | — | Get page title |

### POST /run-task (Legacy)
Accepts either new `commands` format or legacy `task` string (auto-converts to navigate+screenshot).

### GET /runs/{run_id}/status
Check execution progress and results.

### GET /runs/{run_id}/screenshot
Get screenshot (latest or `?step=N` for specific step).

### POST /health
Health check.

## Deploy to Render

1. Push to GitHub
2. Create Web Service on Render
3. Set `BRIDGE_API_KEY` environment variable
4. Render uses `render.yaml` for build/start

## Connecting to Lovable

Add these secrets:

| Secret | Value |
|--------|-------|
| `BROWSER_USE_BRIDGE_URL` | `https://your-bridge.onrender.com` |
| `BROWSER_USE_BRIDGE_API_KEY` | Your `BRIDGE_API_KEY` value |

## Key Differences from Previous Version

- **No browser-use dependency** — removed AI agent loop from bridge
- **No OpenAI key needed on bridge** — all LLM calls happen in edge functions
- **Faster cold starts** — smaller Docker image without browser-use + langchain
- **Deterministic execution** — commands run exactly as specified
- **Better debugging** — each command result is individually tracked
