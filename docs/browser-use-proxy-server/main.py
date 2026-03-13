import os
import re
import uuid
import json
import shutil
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any

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

app = FastAPI(title="Browser-Use Bridge")

# Try to import browser_use components; if not available, we will fallback to playwright
try:
    from browser_use import Browser
    from browser_use.browser.profile import BrowserProfile, ProxySettings
    HAVE_BROWSER_USE = True
except Exception:
    HAVE_BROWSER_USE = False

# Fallback: try playwright directly
try:
    from playwright.async_api import async_playwright
    HAVE_PLAYWRIGHT = True
except Exception:
    HAVE_PLAYWRIGHT = False


def check_auth(request: Request):
    if not BRIDGE_API_KEY:
        # no auth configured, allow
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
    profile_id: Optional[str] = None
    proxy: Optional[ProxyModel] = None


@app.post("/health")
async def health(req: Request):
    try:
        check_auth(req)
    except HTTPException:
        # health should be accessible without auth in many setups; return 200
        return JSONResponse({"status": "ok"})
    return JSONResponse({"status": "ok"})


def _extract_first_url(text: str) -> Optional[str]:
    m = re.search(r"https?://[\w-.~:/?#\[\]@!$&'()*+,;=%]+", text)
    if m:
        return m.group(0)
    return None


async def _run_browser_task(task: str, outdir: Path, profile_id: Optional[str], proxy: Optional[Dict[str, Any]]):
    status_file = outdir / "status.json"

    def write_status(s: Dict[str, Any]):
        try:
            with open(status_file, 'w', encoding='utf-8') as f:
                json.dump(s, f, indent=2)
        except Exception:
            pass

    write_status({'status': 'starting', 'task': task})

    # Determine URL to visit
    url = _extract_first_url(task)
    if not url:
        # perform search via DuckDuckGo when no explicit URL
        q = task.replace('"', '')
        url = f"https://duckduckgo.com/?q={q}".replace(' ', '+')

    write_status({'status': 'launching_browser', 'target_url': url})

    # prepare profile dir
    profile_dir = None
    if profile_id:
        profile_dir = PROFILES_DIR / profile_id
        profile_dir.mkdir(parents=True, exist_ok=True)
    else:
        profile_dir = outdir / 'profile'
        profile_dir.mkdir(parents=True, exist_ok=True)

    screenshot_path = outdir / 'screenshot.png'

    # Use browser_use if available
    if HAVE_BROWSER_USE:
        try:
            bp = None
            if proxy:
                bp = BrowserProfile(proxy=ProxySettings(
                    server=proxy.get('server'),
                    username=proxy.get('username'),
                    password=proxy.get('password')
                ))
            # ensure user_data_dir if supported
            try:
                bp.user_data_dir = str(profile_dir)
            except Exception:
                try:
                    bp = BrowserProfile(
                        user_data_dir=str(profile_dir),
                        proxy=(bp.proxy if bp else None)
                    )
                except Exception:
                    bp = bp

            browser = Browser(headless=True, browser_profile=bp)
            await browser.start()
            page = await browser.new_page()
            await page.goto(url)
            # small wait for network
            await asyncio.sleep(2)
            try:
                data = await page.screenshot()
                if isinstance(data, (bytes, bytearray)):
                    with open(screenshot_path, 'wb') as f:
                        f.write(data)
                elif isinstance(data, str):
                    import base64
                    s = data
                    if s.startswith('data:'):
                        s = s.split(',', 1)[1]
                    try:
                        b = base64.b64decode(s)
                        with open(screenshot_path, 'wb') as f:
                            f.write(b)
                    except Exception:
                        pass
            except Exception:
                pass
            write_status({'status': 'finished', 'screenshot': str(screenshot_path)})
            try:
                await browser.stop()
            except Exception:
                pass
            return
        except Exception as e:
            write_status({'status': 'error', 'error': str(e)})
            return

    # Fallback to playwright
    if HAVE_PLAYWRIGHT:
        try:
            async with async_playwright() as p:
                launch_kwargs = {"headless": True}
                # pass proxy settings to playwright launch if provided
                if proxy:
                    # playwright expects proxy dict with server, username, password
                    launch_kwargs['proxy'] = {
                        'server': proxy.get('server')
                    }
                    if proxy.get('username'):
                        launch_kwargs['proxy']['username'] = proxy.get('username')
                    if proxy.get('password'):
                        launch_kwargs['proxy']['password'] = proxy.get('password')
                # add common args for containerized env
                launch_kwargs.setdefault('args', ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
                browser = await p.chromium.launch(**launch_kwargs)
                context = await browser.new_context(accept_downloads=True)
                page = await context.new_page()
                await page.goto(url)
                await asyncio.sleep(2)
                try:
                    await page.screenshot(path=str(screenshot_path))
                except TypeError:
                    # some wrappers may return bytes
                    data = await page.screenshot()
                    if isinstance(data, (bytes, bytearray)):
                        with open(screenshot_path, 'wb') as f:
                            f.write(data)
                await browser.close()
                write_status({'status': 'finished', 'screenshot': str(screenshot_path)})
                return
        except Exception as e:
            write_status({'status': 'error', 'error': str(e)})
            return

    write_status({'status': 'error', 'error': 'no browser backend available'})


@app.post("/run-task")
async def run_task(req: Request, body: RunTaskRequest, background: BackgroundTasks):
    check_auth(req)
    run_id = uuid.uuid4().hex
    outdir = RUNS_DIR / run_id
    outdir.mkdir(parents=True, exist_ok=True)
    # write initial status
    with open(outdir / 'status.json', 'w', encoding='utf-8') as f:
        json.dump({'status': 'queued', 'task': body.task}, f)

    proxy_dict = None
    if body.proxy:
        proxy_dict = body.proxy.dict()

    # schedule background task
    background.add_task(_run_browser_task, body.task, outdir, body.profile_id, proxy_dict)

    return JSONResponse({
        'run_id': run_id,
        'status_url': f"/runs/{run_id}/status",
        'screenshot_url': f"/runs/{run_id}/screenshot"
    })


@app.get('/runs/{run_id}/status')
def run_status(run_id: str):
    sf = RUNS_DIR / run_id / 'status.json'
    if sf.exists():
        try:
            return JSONResponse(json.loads(open(sf, 'r', encoding='utf-8').read()))
        except Exception:
            raise HTTPException(status_code=500, detail='status read error')
    raise HTTPException(status_code=404, detail='run not found')


@app.get('/runs/{run_id}/screenshot')
def run_screenshot(run_id: str):
    p = RUNS_DIR / run_id / 'screenshot.png'
    if p.exists():
        return FileResponse(str(p), media_type='image/png')
    raise HTTPException(status_code=404, detail='screenshot not found')


# Sessions endpoints (human-in-the-loop)

@app.post('/sessions')
async def create_session(req: Request, background: BackgroundTasks, profile_id: Optional[str] = None, proxy: Optional[ProxyModel] = None):
    check_auth(req)
    sid = uuid.uuid4().hex
    sdir = SESSIONS_DIR / sid
    sdir.mkdir(parents=True, exist_ok=True)
    # spawn a background headless session that saves screenshots for live view
    task_text = profile_id or 'interactive-session'
    proxy_dict = proxy.dict() if proxy else None
    background.add_task(_run_browser_task, task_text, sdir, profile_id, proxy_dict)
    base = str(req.base_url).rstrip('/')
    live_url = f"{base}/sessions/{sid}/live"
    return JSONResponse({'session_id': sid, 'liveViewUrl': live_url})


@app.get('/sessions/{sid}/live')
def session_live(sid: str):
    p = SESSIONS_DIR / sid / 'screenshot.png'
    if p.exists():
        return FileResponse(str(p), media_type='image/png')
    # show a small JSON status if screenshot missing
    sf = SESSIONS_DIR / sid / 'status.json'
    if sf.exists():
        try:
            return JSONResponse(json.loads(open(sf, 'r', encoding='utf-8').read()))
        except Exception:
            pass
    raise HTTPException(status_code=404, detail='session not ready')


@app.post('/sessions/{sid}/complete')
def complete_session(sid: str, req: Request, body: Optional[Dict[str, Any]] = None):
    check_auth(req)
    sdir = SESSIONS_DIR / sid
    if not sdir.exists():
        raise HTTPException(status_code=404, detail='session not found')
    profile_id = uuid.uuid4().hex
    target = PROFILES_DIR / profile_id
    try:
        shutil.copytree(sdir / 'profile', target)
    except Exception:
        # if no profile dir exists, create empty profile
        target.mkdir(parents=True, exist_ok=True)
    return JSONResponse({'profile_id': profile_id})


# Profiles endpoints (retrieve and delete saved profiles)

@app.get('/profiles/{profile_id}')
def get_profile(profile_id: str, req: Request):
    check_auth(req)
    pdir = PROFILES_DIR / profile_id
    if not pdir.exists() or not pdir.is_dir():
        raise HTTPException(status_code=404, detail='profile not found')
    # Create a ZIP of the profile directory and return it
    zip_base = PROFILES_DIR / f"{profile_id}"
    zip_path = PROFILES_DIR / f"{profile_id}.zip"
    try:
        # remove existing zip if present
        if zip_path.exists():
            zip_path.unlink()
        shutil.make_archive(str(zip_base), 'zip', root_dir=str(pdir))
        return FileResponse(str(zip_path), media_type='application/zip', filename=f'profile_{profile_id}.zip')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'failed to create zip: {e}')


@app.delete('/profiles/{profile_id}')
def delete_profile(profile_id: str, req: Request):
    check_auth(req)
    pdir = PROFILES_DIR / profile_id
    if not pdir.exists() or not pdir.is_dir():
        raise HTTPException(status_code=404, detail='profile not found')
    try:
        shutil.rmtree(pdir)
        # also remove any zip file
        z = PROFILES_DIR / f"{profile_id}.zip"
        if z.exists():
            z.unlink()
        return JSONResponse({'deleted': profile_id})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'failed to delete profile: {e}')


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', '8000'))
    uvicorn.run('main:app', host='0.0.0.0', port=port, log_level='info')
