/**
 * @module trajectory
 * @description
 * Camera trajectory data model for Play mode.
 *
 * A trajectory is a **frame-indexed script** that drives the whole rig:
 * every frame states who leads, who follows, the zoom, the focus depth,
 * the rig pose and (optionally) full camera parameters. It is completely
 * independent of any scene — the same trajectory can play over different
 * scenes (objects are not referenced anywhere).
 *
 * **File schema** (JSON):
 * ```jsonc
 * {
 *   "version": 1,
 *   "name": "dolly-zoom-01",          // optional
 *   "fps": 30,                        // playback rate (fixed for the file)
 *   "frames": [
 *     {
 *       "lead": "main",               // 'uw' | 'main' | 'tele'
 *       "follower": "uw",             // 'uw' | 'main' | 'tele'
 *       "zoom": 1.0,                  // combined-view zoom factor
 *       "focusD": 3.0,                // focus plane depth (m)
 *       "blend": false,               // cross-fade layer active this frame
 *       "sceneCam": {                 // rig base pose in world (THE trajectory)
 *         "position": [0, 1.4, 4],
 *         "rotation_euler_deg": [0, 0, 0]
 *       },
 *       "camParams": { ... }          // optional: full intrinsics/extrinsics
 *                                     // (same shape as DEF_CAM); heavy, so
 *                                     // usually only on frames where it changes
 *     },
 *     { "zoom": 1.02 },               // sparse frame: unspecified fields
 *                                     // carry over from the previous frame
 *     ...
 *   ]
 * }
 * ```
 *
 * **Delta encoding**: any field omitted from a frame is inherited from the
 * previous frame. Frame 0 must therefore be complete (all required fields).
 * `parseTrajectory` expands this into dense per-frame records once, at load
 * time — playback then reads `frameAt(n)` with zero per-frame allocation.
 *
 * **Blend runs**: `blend` is a per-frame boolean in the file. For rendering,
 * a cross-fade needs a progress value, so consecutive `blend: true` frames
 * are grouped into runs at parse time and each frame gets
 * `blendT = (indexInRun + 1) / runLength` (reaches exactly 1 on the last
 * frame of the run). Frames with `blend: false` get `blendT = null`.
 * Seeking to any frame therefore reproduces the exact blend state.
 *
 * Pure module — no DOM, no Three.js; fully unit-testable.
 */

/** Camera name → SRC index used by the zoom pipeline / shader. */
export const CAM_NAMES = ['uw', 'main', 'tele'];
export const CAM_TO_SRC = { uw: 0, main: 1, tele: 2 };   // matches SRC in zoom-pipeline.js

export const TRAJECTORY_VERSION = 1;

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Camera Trajectory (Play mode)',
    order: 45,
    text: 'A trajectory file scripts the rig frame by frame: lead/follower camera, zoom, '
        + 'Focus D, rig pose and blend state are all read from the file instead of the '
        + 'built-in zoom rules. The built-in rules apply only in free mode (no trajectory playing).',
    entries: [
        ['Load Traj', 'Load a trajectory JSON file (fps + per-frame records; omitted fields carry over from the previous frame)'],
        ['Play / Pause', 'Play at the trajectory\'s own fps; Pause freezes on the current frame'],
        ['Progress bar', 'Shows the current frame; click or drag to seek'],
        ['Step \u25C0 / \u25B6', 'Step exactly one frame backward / forward (objects\' animations follow the frame clock)'],
    ],
};

const REQUIRED_FRAME0 = ['lead', 'follower', 'zoom', 'focusD', 'sceneCam'];

/**
 * Parse + validate a trajectory JSON object into a dense playback model.
 *
 * @param {object} json - parsed trajectory file content
 * @returns {{name: string, fps: number, length: number,
 *            frameAt: (n: number) => object}}
 *          `frameAt(n)` returns the dense frame record
 *          `{lead, follower, zoom, focusD, blend, blendT, sceneCam, camParams}`
 *          (n is clamped to [0, length-1]).
 * @throws {Error} on schema violations (message says what and where)
 */
export function parseTrajectory(json) {
    if (!json || typeof json !== 'object') throw new Error('trajectory: not an object');
    if (json.version !== TRAJECTORY_VERSION) {
        throw new Error(`trajectory: unsupported version ${json.version} (expected ${TRAJECTORY_VERSION})`);
    }
    if (!(Number.isFinite(json.fps) && json.fps > 0)) throw new Error('trajectory: fps must be a positive number');
    if (!Array.isArray(json.frames) || json.frames.length === 0) throw new Error('trajectory: frames must be a non-empty array');

    for (const k of REQUIRED_FRAME0) {
        if (json.frames[0][k] === undefined) throw new Error(`trajectory: frame 0 must define '${k}'`);
    }

    /* Expand delta encoding into dense records */
    const frames = [];
    let prev = { blend: false, camParams: null, prewarp1: null, prewarp2: null,
        warp: null, blendX: null, blendMode: null, blendShape: null, sampleM: null, followerM: null };
    json.frames.forEach((f, i) => {
        const rec = {
            lead: f.lead ?? prev.lead,
            follower: f.follower ?? prev.follower,
            zoom: f.zoom ?? prev.zoom,
            focusD: f.focusD ?? prev.focusD,
            blend: f.blend ?? prev.blend,
            sceneCam: f.sceneCam ?? prev.sceneCam,
            camParams: f.camParams ?? prev.camParams,
            blendT: null,               // filled by the run pass below
            // Extended fields (optional — recorded trajectories include these)
            prewarp1: f.prewarp1 ?? prev.prewarp1,
            prewarp2: f.prewarp2 ?? prev.prewarp2,
            warp: f.warp ?? prev.warp,
            blendX: f.blendX ?? prev.blendX,
            blendMode: f.blendMode ?? prev.blendMode,
            blendShape: f.blendShape ?? prev.blendShape,
            sampleM: f.sampleM ?? prev.sampleM,
            followerM: f.followerM ?? prev.followerM,
        };
        if (!CAM_NAMES.includes(rec.lead)) throw new Error(`trajectory: frame ${i}: bad lead '${rec.lead}'`);
        if (!CAM_NAMES.includes(rec.follower)) throw new Error(`trajectory: frame ${i}: bad follower '${rec.follower}'`);
        if (rec.lead === rec.follower) throw new Error(`trajectory: frame ${i}: lead and follower are both '${rec.lead}'`);
        if (!(Number.isFinite(rec.zoom) && rec.zoom > 0)) throw new Error(`trajectory: frame ${i}: bad zoom`);
        if (!(Number.isFinite(rec.focusD) && rec.focusD > 0)) throw new Error(`trajectory: frame ${i}: bad focusD`);
        if (!Array.isArray(rec.sceneCam?.position) || rec.sceneCam.position.length !== 3
            || !Array.isArray(rec.sceneCam?.rotation_euler_deg) || rec.sceneCam.rotation_euler_deg.length !== 3) {
            throw new Error(`trajectory: frame ${i}: sceneCam needs position[3] + rotation_euler_deg[3]`);
        }
        frames.push(rec);
        prev = rec;
    });

    /* Blend runs → per-frame progress (deterministic under seek) */
    let runStart = -1;
    for (let i = 0; i <= frames.length; i++) {
        const inBlend = i < frames.length && frames[i].blend;
        if (inBlend && runStart < 0) runStart = i;
        if (!inBlend && runStart >= 0) {
            const len = i - runStart;
            for (let j = runStart; j < i; j++) frames[j].blendT = (j - runStart + 1) / len;
            runStart = -1;
        }
    }

    return {
        name: json.name || 'trajectory',
        fps: json.fps,
        length: frames.length,
        frameAt: (n) => frames[Math.max(0, Math.min(frames.length - 1, n | 0))],
    };
}
