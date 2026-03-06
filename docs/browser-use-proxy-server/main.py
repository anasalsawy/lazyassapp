import asyncio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from playwright.async_api import async_playwright

app = FastAPI()


class TaskRequest(BaseModel):
    url: str
    extract_text: Optional[bool] = True
    selector: Optional[str] = None
    actions: Optional[List[dict]] = None  # optional: [{"action":"click","selector":"#btn"}]


@app.get("/")
async def health():
    return {"status": "ok"}


@app.post("/run-task")
async def run_task(task: TaskRequest):
    url = task.url

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = await context.new_page()
            await page.goto(url, timeout=60000, wait_until="domcontentloaded")

            # Execute optional actions
            action_results = []
            if task.actions:
                for act in task.actions:
                    a = act.get("action", "")
                    sel = act.get("selector", "")
                    val = act.get("value", "")
                    try:
                        if a == "click" and sel:
                            await page.click(sel, timeout=10000)
                        elif a == "type" and sel:
                            await page.fill(sel, val, timeout=10000)
                        elif a == "press":
                            if sel:
                                await page.press(sel, val or "Enter")
                            else:
                                await page.keyboard.press(val or "Enter")
                        elif a == "wait":
                            await asyncio.sleep(int(val or 2000) / 1000)
                        elif a == "scroll":
                            await page.evaluate("window.scrollBy(0, 500)")
                        elif a == "select" and sel:
                            await page.select_option(sel, val, timeout=10000)
                        elif a == "wait_for_selector" and sel:
                            await page.wait_for_selector(sel, timeout=int(val or 10000))
                        action_results.append({"action": a, "status": "ok"})
                    except Exception as e:
                        action_results.append({"action": a, "status": "error", "detail": str(e)[:200]})

            title = await page.title()
            current_url = page.url

            # Extract content
            page_text = ""
            extracted = []
            if task.extract_text:
                if task.selector:
                    elements = await page.query_selector_all(task.selector)
                    texts = []
                    for el in elements:
                        t = await el.text_content()
                        if t and t.strip():
                            texts.append(t.strip())
                    extracted = texts
                    page_text = "\n".join(texts[:50])
                else:
                    page_text = await page.inner_text("body")
                    page_text = page_text[:8000] if page_text else ""

            await browser.close()

            return {
                "status": "success",
                "url": current_url,
                "title": title,
                "content": page_text,
                "extracted": extracted if extracted else None,
                "action_results": action_results if action_results else None,
                "content_length": len(page_text),
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
