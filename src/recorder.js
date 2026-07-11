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

import { CAM_NAMES, TRAJECTORY_VERSION } from './trajectory.js';
import { SRC } from './zoom-pipeline.js';

/** SRC index → camera name string */
const SRC_TO_CAM = { [SRC.SEC1]: 'uw', [SRC.MAIN]: 'main', [SRC.SEC2]: 'tele' };

/**
 * Create a recorder instance.
 *
 * @param {object} deps
 * @param {() => object} deps.getState - returns the current frame state snapshot:
 *   { zoom, depthD, prewarpScale, prewarpScale2, warp, blendX, blendMode,
 *     sampleSrc, sampleM, followerSrc, followerM, camParams }
 * @param {() => object} deps.getSceneCam - returns { position: [x,y,z], rotation_euler_deg: [rx,ry,rz] }
 * @param {() => number} deps.getFps - current render fps
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
            name: `rec-${Date.now().toString(36)}`,
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
