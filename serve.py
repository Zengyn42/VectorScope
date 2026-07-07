#!/usr/bin/env python3
"""VectorScope dev server — Starlette static files with Cache-Control: no-cache.

History:
- `python3 -m http.server` (HTTP/1.0, no Cache-Control): browsers cached stale
  ES modules, and the Tailscale funnel proxy intermittently got 502s / stalls
  when fanning parallel module requests into close-per-request backend
  connections.
- This version: uvicorn + Starlette StaticFiles — proper HTTP/1.1 keep-alive,
  async I/O, Range support — with forced revalidation on every request.
"""
import sys

import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
ROOT = '/home/kingy/Projects/VectorScope'


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        resp.headers['Cache-Control'] = 'no-cache'
        return resp


app = Starlette(
    routes=[Mount('/', app=StaticFiles(directory=ROOT, html=True))],
    middleware=[Middleware(NoCacheMiddleware)],
)

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning', access_log=True)
