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
import json
import os
import re
import sys

import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
ROOT = '/home/kingy/Projects/VectorScope'

# Resource preset folders (camera / trajectory presets shown in the UI).
RESOURCE_DIRS = {
    'camera': 'resource/camera_setting',
    'trajectory': 'resource/trajectory_setting',
}
MAX_PRESET_BYTES = 5_000_000


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        resp.headers['Cache-Control'] = 'no-cache'
        return resp


async def api_list(request):
    """GET /api/list?kind=camera|trajectory → {"files": ["name.json", ...]}"""
    d = RESOURCE_DIRS.get(request.query_params.get('kind', ''))
    if not d:
        return JSONResponse({'error': 'bad kind'}, status_code=400)
    path = os.path.join(ROOT, d)
    files = sorted(f for f in os.listdir(path) if f.endswith('.json')) \
        if os.path.isdir(path) else []
    return JSONResponse({'files': files})


async def api_save(request):
    """POST /api/save?kind=... body {"name": str, "data": obj} → write JSON.

    Filename is sanitized (word chars, dash, space only) — no path traversal.
    Writes only into the two whitelisted resource folders.
    """
    d = RESOURCE_DIRS.get(request.query_params.get('kind', ''))
    if not d:
        return JSONResponse({'error': 'bad kind'}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({'error': 'bad json'}, status_code=400)
    name = re.sub(r'[^\w\- ]', '', str(body.get('name', ''))).strip()[:64]
    data = body.get('data')
    if not name or data is None:
        return JSONResponse({'error': 'bad name/data'}, status_code=400)
    raw = json.dumps(data, indent=2)
    if len(raw) > MAX_PRESET_BYTES:
        return JSONResponse({'error': 'too large'}, status_code=413)
    folder = os.path.join(ROOT, d)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name + '.json'), 'w') as fh:
        fh.write(raw)
    return JSONResponse({'ok': True, 'file': name + '.json'})


app = Starlette(
    routes=[
        Route('/api/list', api_list, methods=['GET']),
        Route('/api/save', api_save, methods=['POST']),
        Mount('/', app=StaticFiles(directory=ROOT, html=True)),
    ],
    middleware=[Middleware(NoCacheMiddleware)],
)

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning', access_log=True)
