/**
 * @module resource-presets
 * @description
 * Client for the repo `resource/` preset folders served by serve.py:
 * - GET  /api/list?kind=camera|trajectory   → { files: ["x.json", ...] }
 * - POST /api/save?kind=...  {name, data}   → { ok, file }
 * - static fetch of /resource/<dir>/<file>
 *
 * All functions fail SOFT (empty list / false) so the app still works when
 * served by a plain static host without the API endpoints.
 */

const DIR = { camera: 'camera_setting', trajectory: 'trajectory_setting' };

/** List preset filenames for a kind. Returns [] when unavailable. */
export async function listPresets(kind) {
    try {
        const r = await fetch(`/api/list?kind=${kind}`);
        if (!r.ok) return [];
        return (await r.json()).files || [];
    } catch { return []; }
}

/** Fetch and parse one preset JSON. Throws on HTTP/parse failure. */
export async function fetchPreset(kind, file) {
    const r = await fetch(`/resource/${DIR[kind]}/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`fetch ${file}: HTTP ${r.status}`);
    return r.json();
}

/** Save a preset via the server API. Returns saved filename or throws. */
export async function savePreset(kind, name, data) {
    const r = await fetch(`/api/save?kind=${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data }),
    });
    if (!r.ok) throw new Error(`save failed: HTTP ${r.status}`);
    return (await r.json()).file;
}

/** Delete a preset file via the server API. Throws on failure. */
export async function deletePreset(kind, file) {
    const r = await fetch(`/api/delete?kind=${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
    });
    if (!r.ok) throw new Error(`delete failed: HTTP ${r.status}`);
    return (await r.json()).file;
}
