"""
Uvicorn startup script with Windows compatibility.

Sets the Windows ProactorEventLoop policy before uvicorn starts,
ensuring subprocess support works correctly on Windows.
"""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
