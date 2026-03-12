#!/bin/bash
set -euo pipefail

# ╔══════════════════════════════════════════════════════════════════════╗
# ║  LazyAss VPS Bridge — Automated Setup Script                       ║
# ║  Ubuntu 22.04/24.04 — 2GB+ RAM                                    ║
# ║                                                                    ║
# ║  Usage: curl -sSL <your-host>/setup.sh | sudo bash                ║
# ║  Or:    sudo bash setup.sh                                        ║
# ╚══════════════════════════════════════════════════════════════════════╝

echo "╔══════════════════════════════════════════════════╗"
echo "║  LazyAss VPS Bridge Installer v2.0              ║"
echo "╚══════════════════════════════════════════════════╝"

# ── 1. System dependencies ─────────────────────────────────────────────
echo "[1/8] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    curl wget gnupg2 unzip \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libxss1 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libgtk-3-0 libasound2 libpangocairo-1.0-0 \
    libxshmfence1 fonts-liberation libpci3 libdrm2 \
    xvfb dbus-x11 \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban

# ── 2. Swap (critical for 2GB RAM) ─────────────────────────────────────
echo "[2/8] Setting up swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # Optimize swap for low-RAM
    sysctl vm.swappiness=60
    echo 'vm.swappiness=60' >> /etc/sysctl.conf
    echo "  → 2GB swap created"
else
    echo "  → Swap already exists"
fi

# ── 3. Create bridge user ──────────────────────────────────────────────
echo "[3/8] Creating bridge user..."
if ! id -u bridge &>/dev/null; then
    useradd -r -s /bin/false -m -d /opt/bridge bridge
fi

# ── 4. Install bridge application ──────────────────────────────────────
echo "[4/8] Installing bridge application..."
BRIDGE_DIR="/opt/bridge"
mkdir -p "$BRIDGE_DIR/profiles"

# Copy application files (assumes they're in the current directory)
if [ -f "main.py" ]; then
    cp main.py "$BRIDGE_DIR/main.py"
    cp requirements.txt "$BRIDGE_DIR/requirements.txt"
elif [ -f "vps-bridge/main.py" ]; then
    cp vps-bridge/main.py "$BRIDGE_DIR/main.py"
    cp vps-bridge/requirements.txt "$BRIDGE_DIR/requirements.txt"
else
    echo "ERROR: main.py not found. Run this script from the project directory."
    exit 1
fi

# Create virtual environment
python3 -m venv "$BRIDGE_DIR/venv"
"$BRIDGE_DIR/venv/bin/pip" install --upgrade pip -q
"$BRIDGE_DIR/venv/bin/pip" install -r "$BRIDGE_DIR/requirements.txt" -q

# Install Playwright browsers
"$BRIDGE_DIR/venv/bin/python" -m playwright install chromium
"$BRIDGE_DIR/venv/bin/python" -m playwright install-deps 2>/dev/null || true

# ── 5. Configure environment ───────────────────────────────────────────
echo "[5/8] Configuring environment..."
ENV_FILE="$BRIDGE_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    # Generate a random API key
    GENERATED_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    cat > "$ENV_FILE" << EOF
BRIDGE_API_KEY=$GENERATED_KEY
PROFILES_DIR=/opt/bridge/profiles
MAX_CONCURRENT=1
# OPENAI_API_KEY=your-key-here
# PROXY_SERVER=http://user:pass@proxy:8080
EOF
    echo "  → Generated API key: $GENERATED_KEY"
    echo "  → SAVE THIS KEY! You'll need it for your Lovable project secrets."
else
    echo "  → .env already exists, keeping existing config"
    GENERATED_KEY=$(grep BRIDGE_API_KEY "$ENV_FILE" | cut -d= -f2)
fi

# ── 6. Set permissions ─────────────────────────────────────────────────
echo "[6/8] Setting permissions..."
chown -R bridge:bridge "$BRIDGE_DIR"
chmod 600 "$ENV_FILE"

# ── 7. Install systemd service ─────────────────────────────────────────
echo "[7/8] Installing systemd service..."
if [ -f "bridge.service" ]; then
    cp bridge.service /etc/systemd/system/bridge.service
elif [ -f "vps-bridge/bridge.service" ]; then
    cp vps-bridge/bridge.service /etc/systemd/system/bridge.service
fi

systemctl daemon-reload
systemctl enable bridge
systemctl start bridge

# Wait for service to start
sleep 3
if systemctl is-active --quiet bridge; then
    echo "  → Bridge service is running!"
else
    echo "  → WARNING: Bridge failed to start. Check: journalctl -u bridge -f"
fi

# ── 8. Configure firewall + nginx ──────────────────────────────────────
echo "[8/8] Configuring firewall and nginx..."

# UFW
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable

# Nginx reverse proxy (HTTP for now, add HTTPS with certbot later)
VPS_IP=$(curl -s4 ifconfig.me || echo "YOUR_VPS_IP")

cat > /etc/nginx/sites-available/bridge << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        
        # Important for long-running browser tasks
        client_max_body_size 50M;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/bridge /etc/nginx/sites-enabled/bridge
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── Done! ───────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ Bridge installed successfully!                          ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
echo "║  Bridge URL:  http://$VPS_IP                    ║"
echo "║  API Key:     $GENERATED_KEY  ║"
echo "║                                                            ║"
echo "║  NEXT STEPS:                                               ║"
echo "║  1. Test: curl http://$VPS_IP/              ║"
echo "║  2. For HTTPS (required for production):                   ║"
echo "║     Point a domain to this IP, then run:                   ║"
echo "║     certbot --nginx -d bridge.yourdomain.com               ║"
echo "║  3. Update Lovable project secrets:                        ║"
echo "║     BRIDGE_URL = https://bridge.yourdomain.com             ║"
echo "║     BRIDGE_API_KEY = (the key above)                       ║"
echo "║     BROWSER_USE_BRIDGE_URL = https://bridge.yourdomain.com ║"
echo "║                                                            ║"
echo "║  USEFUL COMMANDS:                                          ║"
echo "║  • Logs:     journalctl -u bridge -f                      ║"
echo "║  • Restart:  systemctl restart bridge                      ║"
echo "║  • Status:   systemctl status bridge                       ║"
echo "║  • Edit env: nano /opt/bridge/.env                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
