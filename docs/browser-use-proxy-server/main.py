"""
Browser Use Proxy Bridge Server for Replit/Render
Exposes API endpoints that the Lovable edge function can call to run browser automation with custom proxies.
"""

import os
import asyncio
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uvicorn

# Browser Use imports
from browser_use import Agent, Browser, BrowserConfig
from browser_use.browser.context import BrowserContextConfig
from langchain_openai import ChatOpenAI

app = FastAPI(title="Browser Use Proxy Bridge")

# Simple API key auth
API_KEY = os.getenv("BRIDGE_API_KEY", "your-secret-key-here")

class ProxyConfig(BaseModel):
    server: str  # e.g., "http://proxy.example.com:8080"
    username: Optional[str] = None
    password: Optional[str] = None

class TaskRequest(BaseModel):
    task: str
    proxy: Optional[ProxyConfig] = None
    save_recording: bool = False
    max_steps: int = 50

class TaskResponse(BaseModel):
    success: bool
    result: Optional[str] = None
    error: Optional[str] = None
    recording_url: Optional[str] = None

def verify_api_key(authorization: str = Header(None)):
    if not authorization or authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Invalid API key")

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "browser-use-proxy-bridge"}

@app.post("/run-task", response_model=TaskResponse)
async def run_task(request: TaskRequest, authorization: str = Header(None)):
    """Run a browser automation task with optional custom proxy"""
    verify_api_key(authorization)
    
    try:
        # Build browser config with proxy if provided
        browser_config_args = {
            "headless": True,
            "disable_security": True,
        }
        
        if request.proxy:
            # Format proxy URL with auth if credentials provided
            proxy_url = request.proxy.server
            if request.proxy.username and request.proxy.password:
                # For authenticated proxies, we pass credentials separately
                browser_config_args["proxy"] = {
                    "server": proxy_url,
                    "username": request.proxy.username,
                    "password": request.proxy.password,
                }
            else:
                browser_config_args["proxy"] = {"server": proxy_url}
        
        browser_config = BrowserConfig(**browser_config_args)
        browser = Browser(config=browser_config)
        
        # Initialize the LLM (uses OPENAI_API_KEY from env)
        llm = ChatOpenAI(model="gpt-4o")
        
        # Create and run agent
        agent = Agent(
            task=request.task,
            llm=llm,
            browser=browser,
            max_steps=request.max_steps,
        )
        
        result = await agent.run()
        
        await browser.close()
        
        return TaskResponse(
            success=True,
            result=str(result) if result else "Task completed",
        )
        
    except Exception as e:
        return TaskResponse(
            success=False,
            error=str(e),
        )

@app.post("/test-proxy")
async def test_proxy(proxy: ProxyConfig, authorization: str = Header(None)):
    """Test if a proxy is working by checking IP"""
    verify_api_key(authorization)
    
    try:
        browser_config_args = {
            "headless": True,
            "disable_security": True,
        }
        
        if proxy.username and proxy.password:
            browser_config_args["proxy"] = {
                "server": proxy.server,
                "username": proxy.username,
                "password": proxy.password,
            }
        else:
            browser_config_args["proxy"] = {"server": proxy.server}
        
        browser_config = BrowserConfig(**browser_config_args)
        browser = Browser(config=browser_config)
        
        llm = ChatOpenAI(model="gpt-4o-mini")
        
        agent = Agent(
            task="Go to https://ipinfo.io/json and tell me the IP address and location shown.",
            llm=llm,
            browser=browser,
            max_steps=5,
        )
        
        result = await agent.run()
        await browser.close()
        
        return {
            "success": True,
            "result": str(result),
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
