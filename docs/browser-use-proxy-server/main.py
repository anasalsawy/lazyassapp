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
RUNS_DIR = Path("./runs")
SESSIONS_DIR = Path("./sessions")
PROFILES_DIR = Path("./profiles")
RUNS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Playwright Bridge (Command Executor)")

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


class CommandModel(BaseModel):
    """A single Playwright command to execute."""
    action: str  # navigate, click, type, select, extract_text, extract_html, screenshot, wait, scroll, press, evaluate
    selector: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    timeout: Optional[int] = 10000
    wait_after: Optional[int] = 500  # ms to wait after action


class RunTaskRequest(BaseModel):
    """Execute a sequence of Playwright commands."""
    commands: List[CommandModel]
    proxy: Optional[ProxyModel] = None
    viewport_width: Optional[int] = 1280
    viewport_height: Optional[int] = 720


class LegacyRunTaskRequest(BaseModel):
    """Legacy: single natural-language task (now just navigates to URL)."""
    task: str
    max_steps: Optional[int] = 25
    start_url: Optional[str] = None
    profile_id: Optional[str] = None
    proxy: Optional[ProxyModel] = None
    model: Optional[str] = None
    extract_schema: Optional[Dict[str, Any]] = None


# ═══════════════════════════════════════════════════════════════════════
# In-memory run store
# ═══════════════════════════════════════════════════════════════════════
runs_store: Dict[str, Dict[str, Any]] = {}


def write_run(run_id: str, data: Dict[str, Any]):
    runs_store[run_id] = data
    outdir = RUNS_DIR / run_id
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "status.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def read_run(run_id: str) -> Optional[Dict[str, Any]]:
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
# Command Executor — pure Playwright, no AI
# ═══════════════════════════════════════════════════════════════════════
async def execute_commands(
    run_id: str,
    commands: List[CommandModel],
    proxy: Optional[Dict[str, Any]] = None,
    viewport_width: int = 1280,
    viewport_height: int = 720,
):
    """Execute a sequence of Playwright commands and capture results."""
    outdir = RUNS_DIR / run_id
    outdir.mkdir(parents=True, exist_ok=True)

    write_run(run_id, {
        "status": "starting",
        "total_commands": len(commands),
        "steps_taken": 0,
        "action_history": [],
        "has_screenshot": False,
    })

    if not HAVE_PLAYWRIGHT:
        write_run(run_id, {"status": "error", "error": "playwright not installed"})
        return

    action_history = []
    current_url = None
    page_title = None
    extracted_data = []

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
            context = await browser.new_context(
                viewport={"width": viewport_width, "height": viewport_height},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = await context.new_page()

            for i, cmd in enumerate(commands):
                step_num = i + 1
                step_result = {"step": step_num, "action": cmd.action, "status": "ok", "detail": None}

                try:
                    if cmd.action == "navigate":
                        url = cmd.url or cmd.value
                        if not url:
                            step_result["status"] = "error"
                            step_result["detail"] = "No URL provided"
                        else:
                            await page.goto(url, timeout=cmd.timeout, wait_until="domcontentloaded")
                            step_result["detail"] = f"Navigated to {page.url}"

                    elif cmd.action == "click":
                        if not cmd.selector:
                            step_result["status"] = "error"
                            step_result["detail"] = "No selector"
                        else:
                            await page.click(cmd.selector, timeout=cmd.timeout)
                            step_result["detail"] = f"Clicked {cmd.selector}"

                    elif cmd.action == "type":
                        if not cmd.selector or cmd.value is None:
                            step_result["status"] = "error"
                            step_result["detail"] = "Need selector and value"
                        else:
                            await page.fill(cmd.selector, cmd.value, timeout=cmd.timeout)
                            step_result["detail"] = f"Typed into {cmd.selector}"

                    elif cmd.action == "press":
                        key = cmd.value or "Enter"
                        if cmd.selector:
                            await page.press(cmd.selector, key, timeout=cmd.timeout)
                        else:
                            await page.keyboard.press(key)
                        step_result["detail"] = f"Pressed {key}"

                    elif cmd.action == "select":
                        if not cmd.selector or cmd.value is None:
                            step_result["status"] = "error"
                            step_result["detail"] = "Need selector and value"
                        else:
                            await page.select_option(cmd.selector, cmd.value, timeout=cmd.timeout)
                            step_result["detail"] = f"Selected {cmd.value} in {cmd.selector}"

                    elif cmd.action == "wait":
                        ms = int(cmd.value or "2000")
                        await asyncio.sleep(ms / 1000)
                        step_result["detail"] = f"Waited {ms}ms"

                    elif cmd.action == "wait_for_selector":
                        if not cmd.selector:
                            step_result["status"] = "error"
                            step_result["detail"] = "No selector"
                        else:
                            await page.wait_for_selector(cmd.selector, timeout=cmd.timeout)
                            step_result["detail"] = f"Selector appeared: {cmd.selector}"

                    elif cmd.action == "scroll":
                        direction = cmd.value or "down"
                        amount = 500
                        if direction == "down":
                            await page.evaluate(f"window.scrollBy(0, {amount})")
                        elif direction == "up":
                            await page.evaluate(f"window.scrollBy(0, -{amount})")
                        elif direction == "bottom":
                            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        elif direction == "top":
                            await page.evaluate("window.scrollTo(0, 0)")
                        step_result["detail"] = f"Scrolled {direction}"

                    elif cmd.action == "screenshot":
                        ss_path = outdir / f"screenshot_step_{step_num}.png"
                        latest_path = outdir / "screenshot.png"
                        await page.screenshot(path=str(ss_path), full_page=(cmd.value == "full"))
                        shutil.copy2(str(ss_path), str(latest_path))
                        step_result["detail"] = "Screenshot captured"

                    elif cmd.action == "extract_text":
                        if cmd.selector:
                            elements = await page.query_selector_all(cmd.selector)
                            texts = []
                            for el in elements:
                                t = await el.text_content()
                                if t and t.strip():
                                    texts.append(t.strip())
                            step_result["detail"] = texts
                            extracted_data.append({"selector": cmd.selector, "texts": texts})
                        else:
                            body_text = await page.inner_text("body")
                            step_result["detail"] = body_text[:8000]
                            extracted_data.append({"selector": "body", "texts": [body_text[:8000]]})

                    elif cmd.action == "extract_html":
                        if cmd.selector:
                            html = await page.inner_html(cmd.selector)
                        else:
                            html = await page.content()
                        step_result["detail"] = html[:10000]
                        extracted_data.append({"selector": cmd.selector or "page", "html": html[:10000]})

                    elif cmd.action == "extract_attribute":
                        if cmd.selector and cmd.value:
                            elements = await page.query_selector_all(cmd.selector)
                            attrs = []
                            for el in elements:
                                a = await el.get_attribute(cmd.value)
                                if a:
                                    attrs.append(a)
                            step_result["detail"] = attrs
                            extracted_data.append({"selector": cmd.selector, "attribute": cmd.value, "values": attrs})

                    elif cmd.action == "evaluate":
                        if cmd.value:
                            result = await page.evaluate(cmd.value)
                            step_result["detail"] = str(result)[:5000] if result else None
                            extracted_data.append({"js": cmd.value[:200], "result": str(result)[:5000] if result else None})

                    elif cmd.action == "hover":
                        if cmd.selector:
                            await page.hover(cmd.selector, timeout=cmd.timeout)
                            step_result["detail"] = f"Hovered {cmd.selector}"

                    elif cmd.action == "check":
                        if cmd.selector:
                            await page.check(cmd.selector, timeout=cmd.timeout)
                            step_result["detail"] = f"Checked {cmd.selector}"

                    elif cmd.action == "uncheck":
                        if cmd.selector:
                            await page.uncheck(cmd.selector, timeout=cmd.timeout)
                            step_result["detail"] = f"Unchecked {cmd.selector}"

                    elif cmd.action == "upload_file":
                        if cmd.selector and cmd.value:
                            await page.set_input_files(cmd.selector, cmd.value, timeout=cmd.timeout)
                            step_result["detail"] = f"Uploaded {cmd.value}"

                    elif cmd.action == "get_url":
                        step_result["detail"] = page.url

                    elif cmd.action == "get_title":
                        step_result["detail"] = await page.title()

                    else:
                        step_result["status"] = "error"
                        step_result["detail"] = f"Unknown action: {cmd.action}"

                except Exception as e:
                    step_result["status"] = "error"
                    step_result["detail"] = str(e)[:500]

                action_history.append(step_result)

                # Wait after action
                if cmd.wait_after and cmd.wait_after > 0 and step_result["status"] == "ok":
                    await asyncio.sleep(cmd.wait_after / 1000)

                # Update progress
                current_url = page.url
                try:
                    page_title = await page.title()
                except Exception:
                    pass

                write_run(run_id, {
                    "status": "running",
                    "total_commands": len(commands),
                    "steps_taken": step_num,
                    "action_history": action_history,
                    "current_url": current_url,
                    "page_title": page_title,
                    "has_screenshot": (outdir / "screenshot.png").exists(),
                    "latest_screenshot_step": step_num if (outdir / f"screenshot_step_{step_num}.png").exists() else None,
                })

                # Stop on error if it's critical (navigate failure)
                if step_result["status"] == "error" and cmd.action == "navigate":
                    break

            # Final screenshot if none taken
            final_ss = outdir / "screenshot.png"
            if not final_ss.exists():
                try:
                    await page.screenshot(path=str(final_ss))
                except Exception:
                    pass

            # Get final page content (text only, truncated)
            page_content = None
            try:
                page_content = await page.inner_text("body")
                page_content = page_content[:8000] if page_content else None
            except Exception:
                pass

            current_url = page.url
            try:
                page_title = await page.title()
            except Exception:
                pass

            await browser.close()

            failed_steps = [s for s in action_history if s["status"] == "error"]

            write_run(run_id, {
                "status": "completed",
                "total_commands": len(commands),
                "steps_taken": len(action_history),
                "action_history": action_history,
                "current_url": current_url,
                "page_title": page_title,
                "has_screenshot": final_ss.exists(),
                "latest_screenshot_step": len(action_history),
                "extracted_data": extracted_data,
                "page_content": page_content,
                "errors": failed_steps if failed_steps else None,
                "result": extracted_data if extracted_data else f"Executed {len(action_history)} commands on {current_url}",
            })

    except Exception as e:
        write_run(run_id, {
            "status": "error",
            "error": str(e),
            "action_history": action_history,
        })


# ═══════════════════════════════════════════════════════════════════════
# Legacy: simple navigate-and-screenshot for backward compat
# ═══════════════════════════════════════════════════════════════════════
async def run_legacy_task(
    run_id: str,
    task: str,
    start_url: Optional[str] = None,
    proxy: Optional[Dict[str, Any]] = None,
):
    """Legacy fallback: extract URL from task string, navigate, screenshot."""
    url = start_url
    if not url:
        m = re.search(r"https?://[\w\-.~:/?#\[\]@!$&'()*+,;=%]+", task)
        url = m.group(0) if m else f"https://duckduckgo.com/?q={task.replace(' ', '+')}"

    commands = [
        CommandModel(action="navigate", url=url),
        CommandModel(action="wait", value="2000"),
        CommandModel(action="screenshot"),
        CommandModel(action="extract_text"),
        CommandModel(action="get_title"),
    ]
    await execute_commands(run_id, commands, proxy)


# ═══════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@app.post("/health")
@app.get("/health")
async def health():
    return JSONResponse({
        "status": "ok",
        "engine": "playwright_direct",
        "has_playwright": HAVE_PLAYWRIGHT,
    })


@app.post("/execute")
async def execute(req: Request, body: RunTaskRequest, background: BackgroundTasks):
    """Primary endpoint: execute a sequence of Playwright commands."""
    check_auth(req)
    run_id = uuid.uuid4().hex

    proxy_dict = body.proxy.dict() if body.proxy else None

    background.add_task(
        execute_commands,
        run_id=run_id,
        commands=body.commands,
        proxy=proxy_dict,
        viewport_width=body.viewport_width or 1280,
        viewport_height=body.viewport_height or 720,
    )

    write_run(run_id, {"status": "queued", "total_commands": len(body.commands)})

    return JSONResponse({
        "run_id": run_id,
        "mode": "playwright_direct",
        "status_url": f"/runs/{run_id}/status",
        "screenshot_url": f"/runs/{run_id}/screenshot",
    })


@app.post("/run-task")
async def run_task(req: Request, background: BackgroundTasks):
    """Legacy endpoint: accepts task string, converts to commands."""
    check_auth(req)
    raw = await req.json()
    run_id = uuid.uuid4().hex

    # Check if it's new-style (has commands) or legacy (has task)
    if "commands" in raw:
        commands = [CommandModel(**c) for c in raw["commands"]]
        proxy = ProxyModel(**raw["proxy"]) if raw.get("proxy") else None
        proxy_dict = proxy.dict() if proxy else None
        background.add_task(
            execute_commands,
            run_id=run_id,
            commands=commands,
            proxy=proxy_dict,
            viewport_width=raw.get("viewport_width", 1280),
            viewport_height=raw.get("viewport_height", 720),
        )
        mode = "playwright_direct"
    else:
        # Legacy: natural language task
        proxy_dict = None
        if raw.get("proxy"):
            proxy_dict = raw["proxy"]
        background.add_task(
            run_legacy_task,
            run_id=run_id,
            task=raw.get("task", ""),
            start_url=raw.get("start_url"),
            proxy=proxy_dict,
        )
        mode = "legacy_navigate"

    write_run(run_id, {"status": "queued"})

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
def run_screenshot(run_id: str, step: Optional[int] = None):
    if step:
        p = RUNS_DIR / run_id / f"screenshot_step_{step}.png"
    else:
        p = RUNS_DIR / run_id / "screenshot.png"
    if p.exists():
        return FileResponse(str(p), media_type="image/png")
    raise HTTPException(status_code=404, detail="screenshot not found")


# ═══════════════════════════════════════════════════════════════════════
# Sessions (human-in-the-loop compatibility)
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
