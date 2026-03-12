"""
LazyAss VPS Bridge — Persistent Browser Automation Server
Runs on Ubuntu VPS with Browser Use OSS + Playwright.
Supports persistent per-user browser profiles for LinkedIn, Amazon, etc.
"""

import asyncio
import json
import os
import shutil
import time
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from playwright.async_api import async_playwright, Browser, BrowserContext

# ── Config ──────────────────────────────────────────────────────────────
PROFILES_DIR = Path(os.getenv("PROFILES_DIR", "/opt/bridge/profiles"))
API_KEY = os.getenv("BRIDGE_API_KEY", "")
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "1"))  # 1 for 2GB RAM
PROXY_DEFAULT = os.getenv("PROXY_SERVER", None)

PROFILES_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LazyAss VPS Bridge", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Semaphore for concurrency control ───────────────────────────────────
browser_semaphore = asyncio.Semaphore(MAX_CONCURRENT)

# ── Auth ────────────────────────────────────────────────────────────────
async def verify_api_key(x_api_key: str = Header(None, alias="X-API-Key")):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


# ── Models ──────────────────────────────────────────────────────────────
class ActionStep(BaseModel):
    action: str  # click, type, press, wait, scroll, select, wait_for_selector, screenshot, extract
    selector: Optional[str] = None
    value: Optional[str] = None
    timeout: Optional[int] = None


class TaskRequest(BaseModel):
    url: str
    user_id: Optional[str] = None  # for persistent profiles
    profile_name: Optional[str] = None  # e.g. "linkedin", "amazon"
    extract_text: Optional[bool] = True
    selector: Optional[str] = None
    actions: Optional[List[ActionStep]] = None
    proxy: Optional[Dict[str, str]] = None  # {"server":"...", "username":"...", "password":"..."}
    timeout_ms: Optional[int] = 120000
    wait_after_load_ms: Optional[int] = 2000
    user_agent: Optional[str] = None
    viewport: Optional[Dict[str, int]] = None  # {"width": 1920, "height": 1080}
    save_profile: Optional[bool] = True  # auto-save cookies after run


class ProfileRequest(BaseModel):
    user_id: str
    profile_name: str


class BrowserUseTaskRequest(BaseModel):
    """For Browser Use OSS agent-driven tasks"""
    task: str  # natural language task description
    url: Optional[str] = None
    user_id: Optional[str] = None
    profile_name: Optional[str] = None
    max_steps: Optional[int] = 50
    proxy: Optional[Dict[str, str]] = None
    save_profile: Optional[bool] = True


# ── Profile helpers ─────────────────────────────────────────────────────
def get_profile_dir(user_id: str, profile_name: str) -> Path:
    safe_user = user_id.replace("-", "")[:32]
    safe_profile = "".join(c for c in profile_name if c.isalnum() or c in "-_")
    return PROFILES_DIR / safe_user / safe_profile


def profile_exists(user_id: str, profile_name: str) -> bool:
    return get_profile_dir(user_id, profile_name).exists()


async def create_context_with_profile(
    browser: Browser,
    user_id: Optional[str],
    profile_name: Optional[str],
    proxy: Optional[Dict[str, str]] = None,
    user_agent: Optional[str] = None,
    viewport: Optional[Dict[str, int]] = None,
) -> BrowserContext:
    """Create browser context, loading persistent profile if available."""
    
    ua = user_agent or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    vp = viewport or {"width": 1920, "height": 1080}
    
    context_opts: Dict[str, Any] = {
        "user_agent": ua,
        "viewport": vp,
        "locale": "en-US",
        "timezone_id": "America/New_York",
    }
    
    if proxy:
        context_opts["proxy"] = {
            "server": proxy["server"],
            "username": proxy.get("username", ""),
            "password": proxy.get("password", ""),
        }
    elif PROXY_DEFAULT:
        context_opts["proxy"] = {"server": PROXY_DEFAULT}
    
    context = await browser.new_context(**context_opts)
    
    # Load saved cookies if profile exists
    if user_id and profile_name:
        profile_dir = get_profile_dir(user_id, profile_name)
        cookies_file = profile_dir / "cookies.json"
        storage_file = profile_dir / "storage.json"
        
        if cookies_file.exists():
            try:
                cookies = json.loads(cookies_file.read_text())
                await context.add_cookies(cookies)
                print(f"[profile] Loaded {len(cookies)} cookies for {user_id}/{profile_name}")
            except Exception as e:
                print(f"[profile] Failed to load cookies: {e}")
        
        if storage_file.exists():
            try:
                storage = json.loads(storage_file.read_text())
                # localStorage is set per-origin via page script
                context._storage_state = storage
            except Exception as e:
                print(f"[profile] Failed to load storage: {e}")
    
    return context


async def save_context_profile(
    context: BrowserContext,
    user_id: str,
    profile_name: str,
):
    """Save cookies and storage state from context."""
    profile_dir = get_profile_dir(user_id, profile_name)
    profile_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        cookies = await context.cookies()
        (profile_dir / "cookies.json").write_text(json.dumps(cookies, indent=2))
        
        # Save storage state
        storage = await context.storage_state()
        (profile_dir / "storage.json").write_text(json.dumps(storage, indent=2))
        
        print(f"[profile] Saved profile {user_id}/{profile_name} ({len(cookies)} cookies)")
    except Exception as e:
        print(f"[profile] Error saving profile: {e}")


# ── Endpoints ───────────────────────────────────────────────────────────
@app.get("/")
async def health():
    return {
        "status": "ok",
        "version": "2.0.0",
        "max_concurrent": MAX_CONCURRENT,
        "profiles_dir": str(PROFILES_DIR),
    }


@app.post("/run-task", dependencies=[Depends(verify_api_key)])
async def run_task(task: TaskRequest):
    """Execute a Playwright task with optional persistent profile."""
    
    async with browser_semaphore:
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-software-rasterizer",
                        "--disable-extensions",
                        "--single-process",  # saves RAM on 2GB VPS
                    ],
                )
                
                context = await create_context_with_profile(
                    browser, task.user_id, task.profile_name,
                    task.proxy, task.user_agent, task.viewport,
                )
                
                page = await context.new_page()
                
                # Navigate
                await page.goto(
                    task.url,
                    timeout=task.timeout_ms or 120000,
                    wait_until="domcontentloaded",
                )
                
                if task.wait_after_load_ms:
                    await asyncio.sleep(task.wait_after_load_ms / 1000)
                
                # Execute actions
                action_results = []
                if task.actions:
                    for act in task.actions:
                        try:
                            result = await execute_action(page, act)
                            action_results.append(result)
                        except Exception as e:
                            action_results.append({
                                "action": act.action,
                                "status": "error",
                                "detail": str(e)[:300],
                            })
                
                title = await page.title()
                current_url = page.url
                
                # Extract content
                page_text = ""
                extracted = []
                if task.extract_text:
                    if task.selector:
                        elements = await page.query_selector_all(task.selector)
                        for el in elements:
                            t = await el.text_content()
                            if t and t.strip():
                                extracted.append(t.strip())
                        page_text = "\n".join(extracted[:50])
                    else:
                        page_text = await page.inner_text("body")
                        page_text = (page_text or "")[:10000]
                
                # Save profile if requested
                if task.save_profile and task.user_id and task.profile_name:
                    await save_context_profile(context, task.user_id, task.profile_name)
                
                await browser.close()
                
                return {
                    "status": "success",
                    "url": current_url,
                    "title": title,
                    "content": page_text,
                    "extracted": extracted if extracted else None,
                    "action_results": action_results if action_results else None,
                    "content_length": len(page_text),
                    "profile_saved": bool(task.save_profile and task.user_id),
                }
        
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Task timed out")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)[:500])


@app.post("/agent-task", dependencies=[Depends(verify_api_key)])
async def agent_task(req: BrowserUseTaskRequest):
    """Run a Browser Use OSS agent-driven task with AI navigation."""
    
    async with browser_semaphore:
        try:
            # Import browser-use (installed on VPS)
            from browser_use import Agent
            from langchain_openai import ChatOpenAI
            
            llm = ChatOpenAI(
                model="gpt-4o",
                api_key=os.getenv("OPENAI_API_KEY", ""),
            )
            
            # Build browser config with persistent profile
            browser_config = {}
            if req.user_id and req.profile_name:
                profile_dir = get_profile_dir(req.user_id, req.profile_name)
                profile_dir.mkdir(parents=True, exist_ok=True)
                browser_config["user_data_dir"] = str(profile_dir / "chromium_data")
            
            if req.proxy:
                browser_config["proxy"] = req.proxy
            
            agent = Agent(
                task=req.task,
                llm=llm,
                max_steps=req.max_steps or 50,
                starting_url=req.url,
            )
            
            result = await agent.run()
            
            return {
                "status": "success",
                "result": str(result),
                "task": req.task,
                "profile_used": f"{req.user_id}/{req.profile_name}" if req.user_id else None,
            }
        
        except ImportError:
            raise HTTPException(
                status_code=501,
                detail="browser-use not installed. Run: pip install browser-use langchain-openai"
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)[:500])


@app.get("/profiles/{user_id}", dependencies=[Depends(verify_api_key)])
async def list_profiles(user_id: str):
    """List all saved profiles for a user."""
    safe_user = user_id.replace("-", "")[:32]
    user_dir = PROFILES_DIR / safe_user
    
    if not user_dir.exists():
        return {"profiles": []}
    
    profiles = []
    for p in user_dir.iterdir():
        if p.is_dir():
            cookies_file = p / "cookies.json"
            cookie_count = 0
            if cookies_file.exists():
                try:
                    cookie_count = len(json.loads(cookies_file.read_text()))
                except Exception:
                    pass
            
            profiles.append({
                "name": p.name,
                "cookies": cookie_count,
                "last_modified": os.path.getmtime(p),
            })
    
    return {"profiles": profiles}


@app.delete("/profiles/{user_id}/{profile_name}", dependencies=[Depends(verify_api_key)])
async def delete_profile(user_id: str, profile_name: str):
    """Delete a saved profile."""
    profile_dir = get_profile_dir(user_id, profile_name)
    if profile_dir.exists():
        shutil.rmtree(profile_dir)
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Profile not found")


@app.post("/profiles/check-login", dependencies=[Depends(verify_api_key)])
async def check_login_status(req: ProfileRequest):
    """Check if a profile is still logged into a site."""
    
    site_checks = {
        "linkedin": {
            "url": "https://www.linkedin.com/feed/",
            "logged_in_indicator": "feed",
            "login_redirect": "login",
        },
        "amazon": {
            "url": "https://www.amazon.com/gp/css/homepage.html",
            "logged_in_indicator": "Your Account",
            "login_redirect": "signin",
        },
        "indeed": {
            "url": "https://secure.indeed.com/settings",
            "logged_in_indicator": "settings",
            "login_redirect": "login",
        },
    }
    
    check = site_checks.get(req.profile_name.lower())
    if not check:
        return {"logged_in": None, "message": f"No check configured for {req.profile_name}"}
    
    async with browser_semaphore:
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
                context = await create_context_with_profile(
                    browser, req.user_id, req.profile_name
                )
                page = await context.new_page()
                
                await page.goto(check["url"], timeout=30000, wait_until="domcontentloaded")
                await asyncio.sleep(3)
                
                final_url = page.url
                title = await page.title()
                
                logged_in = (
                    check["login_redirect"] not in final_url.lower()
                    and check["logged_in_indicator"].lower() in (title + final_url).lower()
                )
                
                await browser.close()
                
                return {
                    "logged_in": logged_in,
                    "final_url": final_url,
                    "title": title,
                    "profile": f"{req.user_id}/{req.profile_name}",
                }
        except Exception as e:
            return {"logged_in": False, "error": str(e)[:200]}


async def execute_action(page, act: ActionStep) -> dict:
    """Execute a single browser action."""
    a = act.action
    sel = act.selector or ""
    val = act.value or ""
    t = act.timeout or 10000
    
    if a == "click" and sel:
        await page.click(sel, timeout=t)
    elif a == "type" and sel:
        await page.fill(sel, val, timeout=t)
    elif a == "slow_type" and sel:
        await page.click(sel, timeout=t)
        for char in val:
            await page.keyboard.type(char, delay=50 + (hash(char) % 100))
            await asyncio.sleep(0.05)
    elif a == "press":
        if sel:
            await page.press(sel, val or "Enter")
        else:
            await page.keyboard.press(val or "Enter")
    elif a == "wait":
        await asyncio.sleep(int(val or 2000) / 1000)
    elif a == "scroll":
        amount = int(val) if val else 500
        await page.evaluate(f"window.scrollBy(0, {amount})")
    elif a == "scroll_to_bottom":
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    elif a == "select" and sel:
        await page.select_option(sel, val, timeout=t)
    elif a == "wait_for_selector" and sel:
        await page.wait_for_selector(sel, timeout=t)
    elif a == "wait_for_navigation":
        await page.wait_for_load_state("domcontentloaded", timeout=t)
    elif a == "screenshot":
        screenshot_bytes = await page.screenshot(full_page=val == "full")
        import base64
        return {
            "action": a,
            "status": "ok",
            "screenshot_b64": base64.b64encode(screenshot_bytes).decode()[:5000],
        }
    elif a == "extract" and sel:
        elements = await page.query_selector_all(sel)
        texts = []
        for el in elements:
            txt = await el.text_content()
            if txt and txt.strip():
                texts.append(txt.strip())
        return {"action": a, "status": "ok", "extracted": texts}
    elif a == "evaluate":
        result = await page.evaluate(val)
        return {"action": a, "status": "ok", "result": str(result)[:2000]}
    elif a == "hover" and sel:
        await page.hover(sel, timeout=t)
    elif a == "upload" and sel:
        await page.set_input_files(sel, val)
    else:
        return {"action": a, "status": "skipped", "detail": f"Unknown action: {a}"}
    
    return {"action": a, "status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
