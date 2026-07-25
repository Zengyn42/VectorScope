/**
 * @module keyboard-camera
 * @description
 * WASDQE keyboard controller for the rig base pose (SCENE_CAM).
 * Extracted from the index.html inline keydown handler.
 *
 * Semantics (unchanged from the inline version):
 * - Plain keys translate: W/S = forward/back along the MAIN camera's
 *   forward axis, A/D = left/right along its right axis, Q/E = world
 *   down/up. Step 0.1 m.
 * - Shift+keys rotate SCENE_CAM euler ('ZYX' order, degrees):
 *   A/D = yaw ±, W/S = pitch ±, Q/E = roll ±. Step 2°.
 * - Modifies the rig BASE pose, so all cameras move together;
 *   inter-camera relative extrinsics are untouched → homography is
 *   unaffected.
 *
 * Pure math (quatRotate from camera-preset.js) — no THREE dependency,
 * unit-testable in Node. DOM concerns (event guards, preventDefault,
 * re-applying the pose) stay with the caller.
 */

import { quatRotate } from './camera-preset.js';

/**
 * Apply one WASDQE key to a scene-cam pose (mutates `sceneCam`).
 *
 * @param {string} key - `event.key` (any case)
 * @param {boolean} shift - rotate instead of translate
 * @param {{position:number[], rotation_euler_deg:number[]}} sceneCam
 *        rig base pose, mutated in place
 * @param {{x:number,y:number,z:number,w:number}|number[]} mainQuat
 *        MAIN camera world quaternion (THREE.Quaternion or [x,y,z,w]) —
 *        defines the forward/right translation axes
 * @param {{step?: number, deg?: number}} [opts] - step sizes
 * @returns {boolean} true if the key was handled (pose changed)
 */
export function applyCameraKey(key, shift, sceneCam, mainQuat, { step = 0.1, deg = 2 } = {}) {
    if (typeof key !== 'string' || key.length !== 1) return false;
    const k = key.toLowerCase();
    if (!'adwsqe'.includes(k)) return false;

    if (shift) {
        const r = sceneCam.rotation_euler_deg;
        if (k === 'a') r[1] += deg;
        if (k === 'd') r[1] -= deg;
        if (k === 'w') r[0] += deg;
        if (k === 's') r[0] -= deg;
        if (k === 'q') r[2] += deg;
        if (k === 'e') r[2] -= deg;
    } else {
        const q = Array.isArray(mainQuat)
            ? mainQuat
            : [mainQuat.x, mainQuat.y, mainQuat.z, mainQuat.w];
        const fwd = quatRotate(q, [0, 0, -1]);
        const right = quatRotate(q, [1, 0, 0]);
        const p = sceneCam.position;
        const add = (v, s) => { p[0] += v[0] * s; p[1] += v[1] * s; p[2] += v[2] * s; };
        if (k === 'a') add(right, -step);
        if (k === 'd') add(right, +step);
        if (k === 'w') add(fwd, +step);
        if (k === 's') add(fwd, -step);
        if (k === 'q') p[1] -= step;
        if (k === 'e') p[1] += step;
    }
    return true;
}
