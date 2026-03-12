# LazyAss VPS Bridge

Self-hosted Playwright + Browser Use bridge for persistent browser automation.

## Quick Install (Ubuntu 22/24)

```bash
# Upload the vps-bridge/ folder to your VPS, then:
cd vps-bridge
sudo bash setup.sh
```

The script automatically:
- Installs Python, Playwright, Chromium, nginx
- Creates 2GB swap (critical for 2GB RAM VPS)
- Sets up a systemd service (auto-restart, boot-start)
- Configures nginx reverse proxy
- Generates a secure API key
- Configures UFW firewall

## After Install

### 1. Test the bridge
```bash
curl http://YOUR_VPS_IP/
# Should return: {"status":"ok","version":"2.0.0",...}
```

### 2. Set up HTTPS (required)
```bash
# Point a domain to your VPS IP first, then:
sudo certbot --nginx -d bridge.yourdomain.com
```

### 3. Update Lovable secrets
In your Lovable project, update these secrets:
- `BRIDGE_URL` → `https://bridge.yourdomain.com`
- `BROWSER_USE_BRIDGE_URL` → `https://bridge.yourdomain.com`
- `BRIDGE_API_KEY` → (the key from setup output)

## API Endpoints

### Health Check
```
GET /
```

### Run Task (Playwright)
```bash
curl -X POST https://bridge.yourdomain.com/run-task \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "url": "https://linkedin.com/feed",
    "user_id": "user-uuid",
    "profile_name": "linkedin",
    "actions": [
      {"action": "wait", "value": "3000"},
      {"action": "extract", "selector": ".feed-shared-update-v2"}
    ]
  }'
```

### Agent Task (Browser Use AI)
```bash
curl -X POST https://bridge.yourdomain.com/agent-task \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "task": "Search for Software Engineer jobs in San Francisco and save the top 5 results",
    "url": "https://linkedin.com/jobs",
    "user_id": "user-uuid",
    "profile_name": "linkedin",
    "max_steps": 30
  }'
```

### List Profiles
```
GET /profiles/{user_id}
```

### Check Login Status
```bash
curl -X POST https://bridge.yourdomain.com/profiles/check-login \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"user_id": "user-uuid", "profile_name": "linkedin"}'
```

### Delete Profile
```
DELETE /profiles/{user_id}/{profile_name}
```

## Architecture

```
Edge Function → HTTPS → Nginx → Uvicorn (port 8000) → Playwright/Browser Use
                                                          ↕
                                                    /opt/bridge/profiles/
                                                    └── {user_id}/
                                                        ├── linkedin/
                                                        │   ├── cookies.json
                                                        │   └── storage.json
                                                        └── amazon/
                                                            ├── cookies.json
                                                            └── storage.json
```

## Maintenance

```bash
# View logs
journalctl -u bridge -f

# Restart
systemctl restart bridge

# Update code
cd /opt/bridge && sudo -u bridge nano main.py && systemctl restart bridge

# Check disk usage for profiles
du -sh /opt/bridge/profiles/

# Add OpenAI key for agent mode
echo "OPENAI_API_KEY=sk-..." >> /opt/bridge/.env
systemctl restart bridge
```

## RAM Optimization (2GB VPS)

- `MAX_CONCURRENT=1` — only one browser at a time
- `--single-process` Chrome flag saves ~200MB
- 2GB swap prevents OOM kills
- Profiles auto-saved, browser closed after each task
