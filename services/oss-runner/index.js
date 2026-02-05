import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || "0.0.0.0";
const LOGS_DIR = path.join(__dirname, "logs");
const PROFILES_DIR = path.join(__dirname, "profiles");

const defaultProxyFromEnv = () => {
  if (!process.env.OSS_PROXY_SERVER) return null;
  return {
    server: process.env.OSS_PROXY_SERVER,
    username: process.env.OSS_PROXY_USERNAME || null,
    password: process.env.OSS_PROXY_PASSWORD || null,
  };
};

const jobs = new Map();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeUserId(userId) {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function appendLog(jobId, message) {
  await ensureDir(LOGS_DIR);
  const logPath = path.join(LOGS_DIR, `${jobId}.log`);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(logPath, line, "utf-8");
}

async function persistJob(job) {
  await ensureDir(LOGS_DIR);
  const jobPath = path.join(LOGS_DIR, `${job.jobId}.json`);
  await writeJson(jobPath, job);
}

async function getProfile(userId) {
  const safeUserId = sanitizeUserId(userId);
  const profileDir = path.join(PROFILES_DIR, safeUserId);
  await ensureDir(profileDir);
  const profilePath = path.join(profileDir, "profile.json");
  return (await readJsonIfExists(profilePath)) || {
    userId: safeUserId,
    hasProfile: false,
    status: "not_configured",
    lastLoginAt: null,
    sitesLoggedIn: [],
    proxy: null,
  };
}

async function saveProfile(userId, profile) {
  const safeUserId = sanitizeUserId(userId);
  const profileDir = path.join(PROFILES_DIR, safeUserId);
  await ensureDir(profileDir);
  const profilePath = path.join(profileDir, "profile.json");
  await writeJson(profilePath, profile);
}

function buildStatusPayload(profile) {
  return {
    profile: {
      hasProfile: Boolean(profile.hasProfile),
      sitesLoggedIn: profile.sitesLoggedIn || [],
      lastLoginAt: profile.lastLoginAt || null,
      status: profile.status || "not_configured",
      proxyServer: profile.proxy?.server || null,
      proxyUsername: profile.proxy?.username || null,
    },
    tracking: [],
  };
}

async function handleRun(body) {
  const { userId, action = "start_order", payload = {}, proxy } = body || {};
  if (!userId) {
    return { status: 400, data: { success: false, error: "userId is required" } };
  }

  const jobId = crypto.randomUUID();
  const profile = await getProfile(userId);
  const payloadProxy = payload.proxy || (payload.proxyServer
    ? {
      server: payload.proxyServer,
      username: payload.proxyUsername || null,
      password: payload.proxyPassword || null,
    }
    : null);
  const effectiveProxy = proxy || payloadProxy || profile.proxy || defaultProxyFromEnv();

  const job = {
    jobId,
    userId,
    action,
    status: "completed",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    proxy: effectiveProxy,
    result: null,
  };

  let result = { success: true };

  switch (action) {
    case "get_status": {
      result = { success: true, ...buildStatusPayload(profile) };
      break;
    }
    case "create_profile": {
      const updated = {
        ...profile,
        hasProfile: true,
        status: "ready",
        lastLoginAt: new Date().toISOString(),
      };
      await saveProfile(userId, updated);
      result = { success: true };
      break;
    }
    case "start_login": {
      const site = payload.site || "gmail";
      result = {
        success: true,
        sessionId: jobId,
        taskId: jobId,
        liveViewUrl: `oss://local/${jobId}`,
        site,
      };
      break;
    }
    case "confirm_login": {
      const site = payload.site || "gmail";
      const updated = {
        ...profile,
        sitesLoggedIn: Array.from(new Set([...(profile.sitesLoggedIn || []), site])),
        lastLoginAt: new Date().toISOString(),
      };
      await saveProfile(userId, updated);
      result = { success: true };
      break;
    }
    case "cancel_login":
    case "restart_session":
    case "cleanup_sessions": {
      result = { success: true };
      break;
    }
    case "sync_all_orders": {
      result = { success: true, synced: 0 };
      break;
    }
    case "sync_order_emails": {
      result = { success: true, inserted: 0, totalFound: 0, skipped: 0 };
      break;
    }
    case "set_proxy": {
      const nextProxy = {
        server: payload.proxyServer || null,
        username: payload.proxyUsername || null,
        password: payload.proxyPassword || null,
      };
      const updated = { ...profile, proxy: nextProxy };
      await saveProfile(userId, updated);
      result = { success: true };
      break;
    }
    case "test_proxy": {
      const proxyServer = effectiveProxy?.server || null;
      const proxyWorking = Boolean(proxyServer);
      result = {
        success: true,
        tested: true,
        proxyWorking,
        baselineConsistent: true,
        allTestsPassed: proxyWorking,
        baseline1Ip: "0.0.0.0",
        proxyIp: proxyWorking ? "proxy-ip" : "0.0.0.0",
        baseline2Ip: "0.0.0.0",
      };
      break;
    }
    case "start_order": {
      result = { success: true, orderId: payload.orderId || null };
      break;
    }
    case "check_order_status": {
      result = { success: true, status: "pending" };
      break;
    }
    default: {
      result = { success: true };
    }
  }

  if (effectiveProxy) {
    const updated = { ...profile, proxy: effectiveProxy };
    await saveProfile(userId, updated);
  }

  job.result = result;
  jobs.set(jobId, job);

  await appendLog(jobId, `Action: ${action}`);
  await appendLog(jobId, `User: ${userId}`);
  if (effectiveProxy?.server) {
    await appendLog(jobId, `Proxy: ${effectiveProxy.server}`);
  }
  await persistJob(job);

  return { status: 200, data: { jobId, status: job.status, ...result } };
}

async function handleStatus(jobId) {
  if (!jobId) {
    return { status: 400, data: { success: false, error: "jobId is required" } };
  }
  const jobPath = path.join(LOGS_DIR, `${jobId}.json`);
  const job = (await readJsonIfExists(jobPath)) || jobs.get(jobId);
  if (!job) {
    return { status: 404, data: { success: false, error: "job not found" } };
  }
  return { status: 200, data: job };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, corsHeaders);
    res.end();
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "POST" && url.pathname === "/run") {
      const body = await parseBody(req);
      const result = await handleRun(body);
      res.writeHead(result.status, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify(result.data));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const jobId = url.pathname.replace("/status/", "");
      const result = await handleStatus(jobId);
      res.writeHead(result.status, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify(result.data));
      return;
    }

    res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not found" }));
  } catch (error) {
    res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: error.message || "Server error" }));
  }
});

await ensureDir(LOGS_DIR);
await ensureDir(PROFILES_DIR);

server.listen(PORT, HOST, () => {
  console.log(`OSS runner listening on http://${HOST}:${PORT}`);
});
