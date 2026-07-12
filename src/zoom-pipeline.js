/**
 * @module zoom-pipeline
 * @description
 * Pure logic for the 4-segment continuous zoom pipeline of the Combined view.
 *
 * The Combined view hands over between three physical cameras as zoom changes.
 * All zoom/warp/prewarp logic is composed CPU-side into a single 3×3
 * **sampling matrix** (output px → source px); the shader is a dumb sampler.
 *
 * Segments (half-open — a boundary zoom belongs to the NEXT camera):
 * ```
 * A  [0.5, 1.0)x : source = sec1;  warp ON: normLerp(I, H(sec1←main), log t)
 * B  [1.0, 2.0]x : source = main;  plain crop(z)
 * C  (2.0, 5.0)x : source = main;  warp ON: normLerp(crop(2), H(main←sec2 view), log t)
 * D  [5.0, 10 ]x : source = sec2;  plain crop(z/5)
 * ```
 * So z=1.0 shows the main camera full frame and z=5.0 shows sec2 full frame.
 * Warp OFF: A → prewarp1·crop(z) on sec1; C → prewarp2·crop(z) on main —
 * the naive behavior that demonstrates why the warp is needed.
 *
 * Interpolation parameter t runs in **log-zoom space** so perceived zoom
 * speed is uniform; matrix elements are blended **linearly** after
 * normalizing h33 = 1 (see {@link normLerp}).
 *
 * Everything here is pure (no DOM, no Three.js) and unit-testable.
 */

import { M } from './math.js';
import { computeHPair, zoomMatrix } from './homography.js';

/** Source texture indices, matching the shader's `uSrc` uniform. */
export const SRC = { SEC1: 0, MAIN: 1, SEC2: 2 };

/** Help section (see src/help-registry.js) */
export const HELP = {
    title: 'Zoom Pipeline',
    order: 30,
    text: 'The Combined view hands over between the three cameras as zoom changes. '
        + 'Each camera renders at fixed resolution — zooming crops and magnifies its '
        + 'frame (digital zoom), so the image blurs near a handover and snaps sharp after it.',
    entries: [
        ['0.5 – 1.0x', 'UW camera, warped toward the Main view (homography interpolation)'],
        ['1.0 – 2.0x', 'Main camera, plain center crop'],
        ['2.0 – 5.0x', 'Main camera, warped toward the Tele view'],
        ['5.0 – 10x', 'Tele camera, plain center crop'],
    ],
};

/**
 * Normalize both homographies to h33 = 1, blend elementwise, renormalize.
 * Projective matrices are scale-equivalent, so blending without fixing the
 * scale first would weight the endpoints arbitrarily.
 *
 * @param {number[]} A - 3×3 row-major, t = 0 endpoint
 * @param {number[]} B - 3×3 row-major, t = 1 endpoint
 * @param {number} t - blend factor in [0, 1]
 * @returns {number[]} blended matrix, h33 = 1
 */
export function normLerp(A, B, t) {
    const a = A.map(v => v / A[8]);
    const b = B.map(v => v / B[8]);
    const o = a.map((v, i) => v + (b[i] - v) * t);
    const s = o[8];
    if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) o[i] /= s;
    return o;
}

/**
 * Human-readable segment name for a zoom level (used in panel labels).
 * @param {number} z - zoom factor
 * @returns {string} 'S1→M' | 'M' | 'M→S2' | 'S2'
 */
export function segName(z) {
    return z < 1 ? 'S1\u2192M' : z <= 2 ? 'M' : z < 5 ? 'M\u2192S2' : 'S2';
}

/**
 * Which camera sources the Combined view at a given zoom.
 * @param {number} z - zoom factor
 * @param {boolean} hasS2 - whether a second secondary camera exists
 * @returns {number} SRC.SEC1 | SRC.MAIN | SRC.SEC2
 */
export function zoomSource(z, hasS2) {
    if (z < 1.0 - 1e-9) return SRC.SEC1;   // at exactly 1.0x → main leads
    if (z < 5.0 || !hasS2) return SRC.MAIN;
    return SRC.SEC2;
}

/**
 * Which camera is the **follower** at a given zoom — the camera standing by
 * to take over at the nearest segment boundary (see docs/CAMERAS.md).
 * Half-open from above: at exactly 2.0x the follower is the Tele camera.
 *
 * | Zoom        | Leading (zoomSource) | Follower       |
 * |-------------|----------------------|----------------|
 * | [0.5, 1.0)x | SEC1 (UW)            | MAIN           |
 * | [1.0, 2.0)x | MAIN                 | SEC1 (UW)      |
 * | [2.0, 5.0)x | MAIN                 | SEC2 (Tele)    |
 * | [5.0, ∞ )x  | SEC2 (Tele)          | MAIN           |
 *
 * Without a second secondary camera the only boundary is 1.0x, so the
 * follower stays SEC1 for all z ≥ 1.
 *
 * @param {number} z - zoom factor
 * @param {boolean} hasS2 - whether the Tele camera exists
 * @returns {number} SRC.SEC1 | SRC.MAIN | SRC.SEC2
 */
export function followerSource(z, hasS2) {
    if (z < 1.0) return SRC.MAIN;
    if (z < 2.0 || !hasS2) return SRC.SEC1;
    return z < 5.0 ? SRC.SEC2 : SRC.MAIN;
}

/** Nominal magnification of each source (full-frame zoom factor). */
export const SRC_NOMINAL = { [SRC.SEC1]: 0.5, [SRC.MAIN]: 1, [SRC.SEC2]: 5 };

/**
 * {@link computeSampleMatrix} with an **explicit lead source** (trajectory
 * playback: the file states who leads — the zoom rules do not apply).
 *
 * When the requested lead matches what the zoom rules would pick anyway,
 * the full segment math (warp interpolation etc.) is used unchanged.
 * When the trajectory contradicts the rules (e.g. main leading at 0.8x),
 * there is no defined warp segment — the lead renders a plain center crop
 * at `z / nominal(lead)` (its residual digital zoom).
 *
 * @param {object} opts - same as computeSampleMatrix, plus:
 * @param {number} opts.leadSrc - SRC.* index that must lead
 * @returns {{src: number, m: number[]}}
 */
export function computeSampleMatrixExplicit(opts) {
    const hasS2 = !!opts.params.secondary_camera_2;
    const lead = (opts.leadSrc === SRC.SEC2 && !hasS2) ? SRC.MAIN : opts.leadSrc;
    if (lead === undefined || lead === zoomSource(opts.z, hasS2)) {
        return computeSampleMatrix(opts);
    }
    return { src: lead, m: zoomMatrix(opts.z / SRC_NOMINAL[lead], opts.w, opts.h) };
}

/**
 * Compute the **follower camera's** sampling matrix for dual-mode blending:
 * the matrix that samples the follower's RT so it aligns with the leading
 * camera's current Combined output.
 *
 *     M_follower = H(follower ← leading, D) ∘ M_leading
 *
 * where `M_leading` is {@link computeSampleMatrix} (output px → leading px)
 * and `H(follower ← leading, D)` is the plane-induced homography mapping
 * leading px → follower px at focus depth D
 * (`computeHPair(followerParams, leadingParams, D)`).
 *
 * Continuity (warp ON): approaching a segment boundary, the follower matrix
 * converges to the leading matrix on the far side of the boundary, so the
 * two blend layers align at the hand-off (exactly on the focus plane).
 *
 * @param {object} opts - same options as {@link computeSampleMatrix}, plus:
 * @param {number} [opts.leadSrc]     - explicit lead (trajectory mode)
 * @param {number} [opts.followerSrc] - explicit follower (trajectory mode);
 *        defaults to the zoom-rule follower
 * @returns {{src: number, m: number[]}} follower source index + 3×3
 *          row-major sampling matrix (output px → follower px)
 */
export function computeFollowerMatrix(opts) {
    const p = opts.params;
    const hasS2 = !!p.secondary_camera_2;
    const lead = computeSampleMatrixExplicit(opts);
    let src = opts.followerSrc ?? followerSource(opts.z, hasS2);
    if (src === SRC.SEC2 && !hasS2) src = SRC.MAIN;
    if (src === lead.src) return { src, m: lead.m.slice() };   // degenerate: same view
    const D = opts.D;

    // H(follower ← leading): computeHPair(cam1, cam2) maps cam2 px → cam1 px,
    // so cam1 = follower, cam2 = leading.
    const camOf = (s) => s === SRC.SEC1 ? p.secondary_camera
                       : s === SRC.SEC2 ? p.secondary_camera_2
                       : p.main_camera;
    const Hlf = computeHPair(camOf(src), camOf(lead.src), D);
    return { src, m: M.mul(Hlf, lead.m) };
}

/**
 * Compute the sampling matrix (output px → source px) and source index
 * for the Combined view.
 *
 * @param {object} opts
 * @param {number}  opts.z        - zoom factor (0.5 … 10)
 * @param {boolean} opts.warp     - warp correction on/off
 * @param {number}  opts.D        - focus plane depth (m, rig frame)
 * @param {object}  opts.params   - camera params ({main_camera, secondary_camera, secondary_camera_2?})
 * @param {number}  opts.prewarp1 - manual prewarp scale for sec1 (warp-off, segment A)
 * @param {number}  opts.prewarp2 - manual prewarp scale for main (warp-off, segment C)
 * @param {number}  opts.w        - render target width (px)
 * @param {number}  opts.h        - render target height (px)
 * @returns {{src: number, m: number[]}} source index + 3×3 row-major sampling matrix
 */
export function computeSampleMatrix({ z, warp, D, params: p, prewarp1 = 1, prewarp2 = 1, w, h }) {
    const hasS2 = !!p.secondary_camera_2;

    if (z < 1.0) {
        /* ── Segment A: sec1 → main handover ── */
        if (warp) {
            // Endpoint @1.0x: main px → sec1 px (computeHPair(cam1, cam2) maps cam2 px → cam1 px)
            const Hm2s1 = computeHPair(p.secondary_camera, p.main_camera, D);
            const t = Math.log(z / 0.5) / Math.log(2);   // log-space t: 0 @0.5x → 1 @1.0x
            return { src: SRC.SEC1, m: normLerp(M.id(), Hm2s1, t) };
        }
        // UW nominal = 0.5x; crop relative to its FOV = z/0.5 = 2z
        return { src: SRC.SEC1, m: M.mul(zoomMatrix(prewarp1, w, h), zoomMatrix(z / 0.5, w, h)) };
    }

    if (z <= 2.0 || !hasS2) {
        /* ── Segment B: main plain crop (also fallback when no sec2) ── */
        return { src: SRC.MAIN, m: zoomMatrix(z, w, h) };
    }

    if (z < 5.0) {
        /* ── Segment C: main → sec2 handover ── */
        if (warp) {
            // Start @2.0x: crop(2); endpoint @5.0x: sec2-view px → main px
            const Hs2m = computeHPair(p.main_camera, p.secondary_camera_2, D);
            const t = Math.log(z / 2) / Math.log(2.5);   // log-space t: 0 @2x → 1 @5x
            return { src: SRC.MAIN, m: normLerp(zoomMatrix(2, w, h), Hs2m, t) };
        }
        return { src: SRC.MAIN, m: M.mul(zoomMatrix(prewarp2, w, h), zoomMatrix(z, w, h)) };
    }

    /* ── Segment D: sec2 direct, residual crop ── */
    return { src: SRC.SEC2, m: zoomMatrix(z / 5, w, h) };
}

/**
 * Symmetric ease-in-out (quadratic) for zoom preset animation.
 * @param {number} t - progress in [0, 1]
 * @returns {number} eased progress in [0, 1]
 */
export function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
