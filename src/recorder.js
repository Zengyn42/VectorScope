/**
 * @module recorder
 * @description
 * Trajectory recorder for VectorScope.
 *
 * While recording, every rendered frame's full state is captured into a
 * dense frame array — zoom, focusD, prewarp1/2, warp, lead/follower,
 * blendX, blendMode, blend state, sceneCam pose, camParams, and the
 * computed homography matrices. On stop, the captured data is packaged
 * as a trajectory JSON that can be immediately played back or exported.
 *
 * **What is NOT recorded** (per boss spec): object positions/animations.
 * The trajectory is scene-independent — it replays the rig, not the objects.
 *
 * Pure module — no DOM, no Three.js; fully unit-testable.
 */

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Trajectory Recording',
    order: 52,
    entries: [
        ['Rec button', 'Start/stop recording — captures every rendered frame into a trajectory'],
        ['Captured per frame', 'zoom, focusD, prewarp1/2, warp, lead/follower, blendX/mode/shape, sceneCam pose, camParams, homography matrices'],
        ['Not recorded', 'Object positions and animations — trajectories are scene-independent (rig only)'],
        ['Default name', 'traj_{datetime}_{framecount}f — auto-generated on stop'],
        ['After recording', 'Trajectory is added to the library and loaded into the transport for immediate playback'],
    ],
};

import { TRAJECTORY_VERSION } from './trajectory.js';
import { SRC } from './zoom-pipeline.js';

/** SRC index → camera name string */
const SRC_TO_CAM = { [SRC.SEC1]: 'uw', [SRC.MAIN]: 'main', [SRC.SEC2]: 'tele' };

/**
 * Create a recorder instance.
 *
 * Only captures **per-frame group** state — the controls that define the
 * Combined view's output at any given frame:
 *
 * | Per-frame field    | Source              |
 * |--------------------|---------------------|
 * | zoom               | Zoom slider         |
 * | focusD             | Focus D slider      |
 * | prewarp1, prewarp2 | Prewarp sliders     |
 * | warp               | Warp button         |
 * | blendX             | Blend slider        |
 * | blendMode          | Blend mode button   |
 * | lead, follower     | Derived from zoom   |
 * | blend              | blendCtl.isBlending |
 * | sceneCam           | Camera rig pose     |
 * | camParams          | Camera intrinsics/extrinsics |
 * | sampleM, followerM | Computed homography matrices |
 *
 * NOT recorded (session group): clipY, view mode, fps.
 * NOT recorded (trigger group): AF, Reset, Save/Load, Add/Delete.
 * NOT recorded (object group): object positions, animations.
 *
 * @param {object} deps
 * @param {() => object} deps.getState - returns the current per-frame state snapshot
 * @param {() => object} deps.getSceneCam - returns { position: [x,y,z], rotation_euler_deg: [rx,ry,rz] }
 * @param {() => number} deps.getFps - current render fps (trajectory-level metadata, not per-frame)
 * @returns {object} recorder API
 */
export function createRecorder({ getState, getSceneCam, getFps }) {
    let recording = false;
    let frames = [];
    let fps = 30;

    function start() {
        frames = [];
        fps = getFps();
        recording = true;
    }

    function stop() {
        recording = false;
        return buildTrajectory();
    }

    /** Call once per rendered frame while recording. */
    function capture() {
        if (!recording) return;
        const s = getState();
        const sceneCam = getSceneCam();

        frames.push({
            lead: SRC_TO_CAM[s.sampleSrc] || 'main',
            follower: SRC_TO_CAM[s.followerSrc] || 'uw',
            zoom: s.zoom,
            focusD: s.depthD,
            prewarp1: s.prewarpScale,
            prewarp2: s.prewarpScale2,
            warp: s.warp,
            blendX: s.blendX,
            blendMode: s.blendMode,
            blendShape: s.blendShape,
            blend: s.isBlending || false,
            sceneCam: {
                position: sceneCam.position.slice(),
                rotation_euler_deg: sceneCam.rotation_euler_deg.slice(),
            },
            camParams: s.camParams ? JSON.parse(JSON.stringify(s.camParams)) : null,
            // Homography matrices (for inspection / deterministic replay)
            sampleM: s.sampleM ? s.sampleM.slice() : null,
            followerM: s.followerM ? s.followerM.slice() : null,
        });
    }

    function buildTrajectory() {
        if (frames.length === 0) return null;

        // Validate: ensure lead !== follower; fix edge cases where both are same
        for (const f of frames) {
            if (f.lead === f.follower) {
                f.follower = f.lead === 'main' ? 'uw' : 'main';
            }
        }

        // Delta encode for compact JSON output
        const output = [];
        for (let i = 0; i < frames.length; i++) {
            if (i === 0) { output.push(frames[i]); continue; }
            const delta = {};
            for (const [k, v] of Object.entries(frames[i])) {
                if (JSON.stringify(v) !== JSON.stringify(frames[i - 1][k])) {
                    delta[k] = v;
                }
            }
            output.push(Object.keys(delta).length > 0 ? delta : { zoom: frames[i].zoom });
        }

        return {
            version: TRAJECTORY_VERSION,
            name: `traj_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}_${frames.length}f`,
            fps,
            frames: output,
        };
    }

    return {
        start,
        stop,
        capture,
        isRecording: () => recording,
        frameCount: () => frames.length,
    };
}
