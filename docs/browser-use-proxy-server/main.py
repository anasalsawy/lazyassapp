import os
import re
import uuid
import json
import shutil
import asyncio
import base64
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

BRIDGE_API_KEY = os.getenv("BRIDGE_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
RUNS_DIR = Path("./runs")
SESSIONS_DIR = Path("./sessions")
PROFILES_DIR = Path("./profiles")
RUNS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Browser-Use Bridge (AI Agent)")

# Import browser_use Agent
try:
    from browser_use import Agent, Browser, BrowserConfig
    from langchain_openai import ChatOpenAI
    HAVE_BROWSER_USE = True
except ImportError:
    HAVE_BROWSER_USE = False

# Fallback: playwright
try:
    from playwright.async_api import async_playwright
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False


def check_auth(request: Request):
    if not BRIDGE_API_KEY:
        return
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = auth.split(" ", 1)[1].strip()
    if token != BRIDGE_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


class ProxyModel(BaseModel):
    server: str
    username: Optional[str] = None
    password: Optional[str] = None


class RunTaskRequest(BaseModel):
    task: str
    max_steps: Optional[int] = 25
    start_url: Optional[str] = None
    profile_id: Optional[str] = None
    proxy: Optional[ProxyModel] = None
    model: Optional[str] = "gpt-4o"
    extract_schema: Optional[Dict[str, Any]] = None


# ═══════════════════════════════════════════════════════════════════════
# In-memory run store
# ═══════════════════════════════════════════════════════════════════════
runs_store: Dict[str, Dict[str, Any]] = {}


def write_run(run_id: str, data: Dict[str, Any]):
    """Write run status to both memory and disk."""
    runs_store[run_id] = data
    outdir = RUNS_DIR / run_id
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "status.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def read_run(run_id: str) -> Optional[Dict[str, Any]]:
    """Read run status from memory or disk."""
    if run_id in runs_store:
        return runs_store[run_id]
    sf = RUNS_DIR / run_id / "status.json"
    if sf.exists():
        try:
            return json.loads(sf.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


# ═══════════════════════════════════════════════════════════════════════
# Browser Use Agent Runner
# ═══════════════════════════════════════════════════════════════════════
async def run_browser_use_agent(
    run_id: str,
    task: str,
    max_steps: int = 25,
    start_url: Optional[str] = None,
    model_name: str = "gpt-4o",
    proxy: Optional[Dict[str, Any]] = None,
):
    """Run the Browser Use Agent with full AI loop."""
    write_run(run_id, {
        "status": "starting",
        "task": task,
        "steps_taken": 0,
        "action_history": [],
    })

    if not HAVE_BROWSER_USE:
        write_run(run_id, {
            "status": "error",
            "error": "browser_use package not installed",
            "task": task,
        })
        return

    openai_key = OPENAI_API_KEY
    if not openai_key:
        write_run(run_id, {
            "status": "error",
            "error": "OPENAI_API_KEY not configured on bridge server",
            "task": task,
        })
        return

    try:
        # Set up LLM
        llm = ChatOpenAI(
            model=model_name,
            api_key=openai_key,
            temperature=0.1,
        )

        # Set up browser config
        browser_config = BrowserConfig(headless=True)
        browser = Browser(config=browser_config)

        # Create the Agent
        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            max_steps=max_steps,
        )

        write_run(run_id, {
            "status": "running",
            "task": task,
            "steps_taken": 0,
            "action_history": [],
        })

        # Run the agent
        result = await agent.run()

        # Extract result data
        final_result = result.final_result() if hasattr(result, 'final_result') else None
        history = result.history if hasattr(result, 'history') else []
        
        # Build action history from agent steps
        action_history = []
        for i, step in enumerate(history):
            step_info = {
                "step": i + 1,
                "action": str(step) if step else "unknown",
            }
            action_history.append(step_info)

        # Try to get the last screenshot
        screenshot_path = RUNS_DIR / run_id / "screenshot.png"
        try:
            if hasattr(result, 'screenshot') and result.screenshot:
                screenshot_data = result.screenshot
                if isinstance(screenshot_data, str):
                    screenshot_data = base64.b64decode(screenshot_data)
                with open(screenshot_path, 'wb') as f:
                    f.write(screenshot_data)
        except Exception:
            pass

        # Get current page info
        current_url = None
        page_title = None
        try:
            if hasattr(agent, 'browser') and agent.browser:
                pages = agent.browser.contexts
                if pages:
                    current_url = str(pages[-1].url) if hasattr(pages[-1], 'url') else None
                    page_title = str(pages[-1].title) if hasattr(pages[-1], 'title') else None
        except Exception:
            pass

        write_run(run_id, {
            "status": "completed",
            "task": task,
            "result": final_result,
            "steps_taken": len(action_history),
            "action_history": action_history,
            "current_url": current_url,
            "page_title": page_title,
            "has_screenshot": screenshot_path.exists(),
        })

        # Clean up browser
        try:
            await browser.close()
        except Exception:
            pass

    except Exception as e:
        write_run(run_id, {
            "status": "error",
            "task": task,
            "error": str(e),
        })


# ═══════════════════════════════════════════════════════════════════════
# Fallback: simple Playwright navigation (no AI)
# ═══════════════════════════════════════════════════════════════════════
async def run_playwright_fallback(
    run_id: str,
    task: str,
    start_url: Optional[str] = None,
    proxy: Optional[Dict[str, Any]] = None,
):
    """Simple fallback: navigate + screenshot via Playwright."""
    write_run(run_id, {"status": "starting", "task": task})

    url = start_url
    if not url:
        m = re.search(r"https?://[\w-.~:/?#\[\]@!$&'()*+,;=%]+", task)
        url = m.group(0) if m else f"https://duckduckgo.com/?q={task.replace(' ', '+')}"

    screenshot_path = RUNS_DIR / run_id / "screenshot.png"

    if not HAVE_PLAYWRIGHT:
        write_run(run_id, {"status": "error", "error": "No browser backend available"})
        return

    try:
        async with async_playwright() as p:
            launch_kwargs = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            }
            if proxy:
                launch_kwargs["proxy"] = {"server": proxy.get("server")}
                if proxy.get("username"):
                    launch_kwargs["proxy"]["username"] = proxy["username"]
                if proxy.get("password"):
                    launch_kwargs["proxy"]["password"] = proxy["password"]

            browser = await p.chromium.launch(**launch_kwargs)
            context = await browser.new_context()
            page = await context.new_page()
            await page.goto(url)
            await asyncio.sleep(2)
            await page.screenshot(path=str(screenshot_path))

            content = await page.content()
            title = await page.title()
            current_url = page.url

            await browser.close()

            write_run(run_id, {
                "status": "completed",
                "task": task,
                "result": f"Navigated to {current_url}",
                "current_url": current_url,
                "page_title": title,
                "steps_taken": 1,
                "action_history": [{"step": 1, "action": f"navigate to {current_url}"}],
                "has_screenshot": True,
                "page_content": content[:5000] if content else None,
            })
    except Exception as e:
        write_run(run_id, {"status": "error", "error": str(e), "task": task})


# ═══════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@app.post("/health")
@app.get("/health")
async def health():
    return JSONResponse({
        "status": "ok",
        "has_browser_use": HAVE_BROWSER_USE,
        "has_playwright": HAVE_PLAYWRIGHT,
        "has_openai_key": bool(OPENAI_API_KEY),
    })


@app.post("/run-task")
async def run_task(req: Request, body: RunTaskRequest, background: BackgroundTasks):
    check_auth(req)
    run_id = uuid.uuid4().hex

    proxy_dict = body.proxy.dict() if body.proxy else None

    if HAVE_BROWSER_USE and OPENAI_API_KEY:
        # Use full AI agent
        background.add_task(
            run_browser_use_agent,
            run_id=run_id,
            task=body.task,
            max_steps=body.max_steps or 25,
            start_url=body.start_url,
            model_name=body.model or "gpt-4o",
            proxy=proxy_dict,
        )
        mode = "browser_use_agent"
    else:
        # Fallback to simple Playwright
        background.add_task(
            run_playwright_fallback,
            run_id=run_id,
            task=body.task,
            start_url=body.start_url,
            proxy=proxy_dict,
        )
        mode = "playwright_fallback"

    write_run(run_id, {"status": "queued", "task": body.task})

    return JSONResponse({
        "run_id": run_id,
        "mode": mode,
        "status_url": f"/runs/{run_id}/status",
        "screenshot_url": f"/runs/{run_id}/screenshot",
    })


@app.get("/runs/{run_id}/status")
def run_status(run_id: str, req: Request):
    check_auth(req)
    data = read_run(run_id)
    if data:
        return JSONResponse(data)
    raise HTTPException(status_code=404, detail="run not found")


@app.get("/runs/{run_id}/screenshot")
def run_screenshot(run_id: str):
    p = RUNS_DIR / run_id / "screenshot.png"
    if p.exists():
        return FileResponse(str(p), media_type="image/png")
    raise HTTPException(status_code=404, detail="screenshot not found")


# ═══════════════════════════════════════════════════════════════════════
# Sessions (kept for human-in-the-loop compatibility)
# ═══════════════════════════════════════════════════════════════════════

@app.post("/sessions")
async def create_session(req: Request, background: BackgroundTasks, profile_id: Optional[str] = None):
    check_auth(req)
    sid = uuid.uuid4().hex
    sdir = SESSIONS_DIR / sid
    sdir.mkdir(parents=True, exist_ok=True)
    base = str(req.base_url).rstrip("/")
    return JSONResponse({"session_id": sid, "liveViewUrl": f"{base}/sessions/{sid}/live"})


@app.get("/sessions/{sid}/live")
def session_live(sid: str):
    p = SESSIONS_DIR / sid / "screenshot.png"
    if p.exists():
        return FileResponse(str(p), media_type="image/png")
    sf = SESSIONS_DIR / sid / "status.json"
    if sf.exists():
        try:
            return JSONResponse(json.loads(sf.read_text(encoding="utf-8")))
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="session not ready")


@app.post("/sessions/{sid}/complete")
def complete_session(sid: str, req: Request):
    check_auth(req)
    sdir = SESSIONS_DIR / sid
    if not sdir.exists():
        raise HTTPException(status_code=404, detail="session not found")
    profile_id = uuid.uuid4().hex
    target = PROFILES_DIR / profile_id
    try:
        shutil.copytree(sdir / "profile", target)
    except Exception:
        target.mkdir(parents=True, exist_ok=True)
    return JSONResponse({"profile_id": profile_id})


# ═══════════════════════════════════════════════════════════════════════
# Profiles
# ═══════════════════════════════════════════════════════════════════════

@app.get("/profiles/{profile_id}")
def get_profile(profile_id: str, req: Request):
    check_auth(req)
    pdir = PROFILES_DIR / profile_id
    if not pdir.exists() or not pdir.is_dir():
        raise HTTPException(status_code=404, detail="profile not found")
    zip_base = PROFILES_DIR / f"{profile_id}"
    zip_path = PROFILES_DIR / f"{profile_id}.zip"
    try:
        if zip_path.exists():
            zip_path.unlink()
        shutil.make_archive(str(zip_base), "zip", root_dir=str(pdir))
        return FileResponse(str(zip_path), media_type="application/zip", filename=f"profile_{profile_id}.zip")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to create zip: {e}")


@app.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str, req: Request):
    check_auth(req)
    pdir = PROFILES_DIR / profile_id
    if not pdir.exists() or not pdir.is_dir():
        raise HTTPException(status_code=404, detail="profile not found")
    try:
        shutil.rmtree(pdir)
        z = PROFILES_DIR / f"{profile_id}.zip"
        if z.exists():
            z.unlink()
        return JSONResponse({"deleted": profile_id})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to delete profile: {e}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
