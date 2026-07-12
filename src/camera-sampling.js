/**
 * @module camera-sampling
 * @description
 * Pure per-camera sampling matrix computation (warp-OFF / crop-only path).
 *
 * Each camera independently computes its own crop-based sampling matrix at a
 * given zoom. This is used for:
 *   - Warp-OFF mode: each camera's matrix = zoomMatrix(z / nominal)
 *   - Understanding the nominal/crop relationship per camera
 *   - The follower's warp-OFF path (prewarp-based approximate alignment)
 *
 * **Warp-ON alignment** (blending) requires the plane-induced homography
 * H(follower ← lead, D) to guarantee pixel alignment at focus depth D.
 * That computation lives in zoom-pipeline.js/computeFollowerMatrix.
 *
 * **Per-camera nominal zoom** (the zoom value where the camera shows full frame):
 *   - UW:    nominal = 1 / prewarp1  (e.g. prewarp1=2 → nominal=0.5x)
 *   - Main:  nominal = 1.0
 *   - Tele:  nominal = prewarp2      (e.g. prewarp2=5 → nominal=5.0x)
 *
 * Pure module — no DOM, no Three.js. Fully unit-testable.
 */

import { SRC } from './zoom-pipeline.js';
import { zoomMatrix } from './homography.js';
import { M } from './math.js';

/**
 * Compute the nominal zoom for a camera source.
 * Nominal = the zoom factor at which the camera shows its full frame.
 *
 * @param {number} src - SRC.SEC1 | SRC.MAIN | SRC.SEC2
 * @param {number} [prewarp1=1] - focal length ratio UW/Main
 * @param {number} [prewarp2=5] - focal length ratio Tele/Main
 * @returns {number} nominal zoom factor
 */
export function cameraNominal(src, prewarp1 = 1, prewarp2 = 5) {
    if (src === SRC.SEC1) return 1 / (prewarp1 || 1);
    if (src === SRC.SEC2) return prewarp2 || 5;
    return 1.0;
}

/**
 * Compute the crop factor for a camera at a given zoom.
 * crop = z / nominal — how much of the camera's RT is visible.
 * crop = 1.0 means full frame; crop = 2.0 means 2x digital zoom into the RT.
 *
 * @param {number} z - current zoom factor
 * @param {number} src - SRC.SEC1 | SRC.MAIN | SRC.SEC2
 * @param {number} [prewarp1=1]
 * @param {number} [prewarp2=5]
 * @returns {number} crop factor (>= 0)
 */
export function cameraCrop(z, src, prewarp1 = 1, prewarp2 = 5) {
    return z / cameraNominal(src, prewarp1, prewarp2);
}

/**
 * Compute the sampling matrix for a single camera at a given zoom (warp OFF).
 * This is the pure crop-only path — no homography correction.
 *
 * @param {object} opts
 * @param {number} opts.z - zoom factor
 * @param {number} opts.src - SRC.SEC1 | SRC.MAIN | SRC.SEC2
 * @param {number} opts.w - RT width
 * @param {number} opts.h - RT height
 * @param {number} [opts.prewarp1=1]
 * @param {number} [opts.prewarp2=5]
 * @returns {number[]} 3×3 row-major sampling matrix
 */
export function cameraSampleMatrix({ z, src, w, h, prewarp1 = 1, prewarp2 = 5 }) {
    const crop = cameraCrop(z, src, prewarp1, prewarp2);
    return zoomMatrix(crop, w, h);
}

/**
 * Compute lead and follower crop matrices (warp-OFF path).
 *
 * Both cameras compute their own crop independently using prewarp ratios.
 * This provides approximate alignment (prewarp = focal length ratio).
 *
 * NOTE: For warp-ON blending, use computeFollowerMatrix() from zoom-pipeline.js
 * which applies H(follower ← lead, D) × M_lead for exact alignment at depth D.
 *
 * @param {object} opts
 * @param {number} opts.z - zoom factor
 * @param {number} opts.leadSrc - lead camera SRC index
 * @param {number} opts.followerSrc - follower camera SRC index
 * @param {number} opts.w - RT width
 * @param {number} opts.h - RT height
 * @param {number} [opts.prewarp1=1]
 * @param {number} [opts.prewarp2=5]
 * @returns {{lead: {src, m}, follower: {src, m}}}
 */
export function computeBothCropMatrices({ z, leadSrc, followerSrc, w, h, prewarp1 = 1, prewarp2 = 5 }) {
    const leadM = cameraSampleMatrix({ z, src: leadSrc, w, h, prewarp1, prewarp2 });
    const followerM = cameraSampleMatrix({ z, src: followerSrc, w, h, prewarp1, prewarp2 });
    return {
        lead: { src: leadSrc, m: leadM },
        follower: { src: followerSrc, m: followerM },
    };
}
