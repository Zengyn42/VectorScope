/**
 * @module camera-utils
 * @description
 * Shared camera-source utilities. Single source of truth for the
 * source-index enum and the SRC → camera-params lookups that were
 * previously redefined as local closures in zoom-pipeline.js and
 * sampling-hud.js.
 *
 * `SRC` lives here (not in zoom-pipeline.js) so this module has zero
 * imports; zoom-pipeline.js re-exports it, so existing
 * `import { SRC } from './zoom-pipeline.js'` call sites keep working.
 */

/** Source texture indices, matching the shader's `uSrc` uniform. */
export const SRC = { SEC1: 0, MAIN: 1, SEC2: 2 };

/**
 * Camera-params object key for a source index.
 * @param {number} s - SRC.* index
 * @returns {'secondary_camera'|'secondary_camera_2'|'main_camera'}
 */
export function paramKeyOf(s) {
    return s === SRC.SEC1 ? 'secondary_camera'
         : s === SRC.SEC2 ? 'secondary_camera_2'
         : 'main_camera';
}

/**
 * Camera-params block for a source index.
 * @param {object} params - full camera params ({main_camera, secondary_camera, ...})
 * @param {number} s - SRC.* index
 * @returns {object|undefined} the per-camera params block (undefined if absent)
 */
export function camOf(params, s) {
    return params?.[paramKeyOf(s)];
}

/**
 * Focal-length-ratio prewarps for the current rig:
 * - `prewarp1` = f_Main / f_UW   (warp-off crop for segment A on the UW RT;
 *    also 1/nominal zoom of the UW camera)
 * - `prewarp2` = f_Tele / f_Main (Tele nominal zoom; warp-off segment D crop)
 *
 * Uses fx (square pixels assumed, fx ≈ fy). Returns `null` for a ratio whose
 * cameras are missing or have a non-positive focal, so callers can leave the
 * corresponding slider untouched.
 *
 * @param {object} params - full camera params ({main_camera, secondary_camera, secondary_camera_2?})
 * @returns {{prewarp1: number|null, prewarp2: number|null}}
 */
export function focalPrewarps(params) {
    const mf = params?.main_camera?.intrinsics?.fx;
    const uf = params?.secondary_camera?.intrinsics?.fx;
    const tf = params?.secondary_camera_2?.intrinsics?.fx;
    return {
        prewarp1: (mf > 0 && uf > 0) ? mf / uf : null,
        prewarp2: (mf > 0 && tf > 0) ? tf / mf : null,
    };
}
