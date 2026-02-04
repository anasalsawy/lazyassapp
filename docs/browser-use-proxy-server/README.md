# Browser Use Proxy Bridge Server

This server allows the Lovable edge function to run browser automation with **custom proxy support** by hosting Browser Use on Replit or Render.

## Deploy to Replit

1. Create a new Replit → Choose "Python" template
2. Upload `main.py` and `requirements.txt`
3. In Replit Shell, run: `playwright install chromium`
4. Set these **Secrets** in Replit:
   - `OPENAI_API_KEY` = your OpenAI API key
   - `BRIDGE_API_KEY` = create a secret key (e.g., `my-super-secret-key-123`)
5. Click **Run** - your server will be live at `https://your-repl-name.replit.app`

## Deploy to Render

1. Create a new Web Service on Render
2. Connect your GitHub repo (or use manual deploy)
3. Set Environment Variables:
   - `OPENAI_API_KEY` = your OpenAI API key
   - `BRIDGE_API_KEY` = create a secret key
4. Build Command: `pip install -r requirements.txt && playwright install chromium`
5. Start Command: `python main.py`

## API Endpoints

### POST /run-task
Run a browser automation task with optional proxy.

```json
{
  "task": "Go to amazon.com and search for 'laptop'",
  "proxy": {
    "server": "http://proxy.example.com:8080",
    "username": "user",
    "password": "pass"
  },
  "max_steps": 50
}
```

Headers: `Authorization: Bearer YOUR_BRIDGE_API_KEY`

### POST /test-proxy
Test if a proxy is working by checking IP.

```json
{
  "server": "http://proxy.example.com:8080",
  "username": "user",
  "password": "pass"
}
```

### GET /health
Health check endpoint.

## Connecting to Lovable

Once deployed, add your server URL as a secret in Lovable:
- Secret name: `BROWSER_USE_BRIDGE_URL`
- Value: `https://your-repl-name.replit.app`

Also add:
- Secret name: `BROWSER_USE_BRIDGE_API_KEY`
- Value: your `BRIDGE_API_KEY`

Then update the edge function to call your bridge server instead of the Browser Use Cloud API when a custom proxy is configured.
