FROM python:3.11-slim

# Install dependencies for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget gnupg2 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libxss1 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libgtk-3-0 libasound2 libpangocairo-1.0-0 libxshmfence1 fonts-liberation \
    libpci3 libdrm2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

RUN python -m venv /opt/venv && /opt/venv/bin/pip install --upgrade pip
RUN /opt/venv/bin/pip install -r requirements.txt

# Install playwright browsers
RUN /opt/venv/bin/python -m playwright install chromium

ENV PATH="/opt/venv/bin:$PATH"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
