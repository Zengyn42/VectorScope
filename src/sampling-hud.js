/**
 * @module sampling-hud
 * @description
 * Sampling-matrix refresh + H-matrix HUD for VectorScope.
 *
 * `refreshH` is the single place where the zoom pipeline's pure math
 * (src/zoom-pipeline.js) is pushed into live state: warp-shader uniforms
 * (uSrc/uHi), the per-frame blend inputs (S.sampleSrc/sampleM), the dual-mode
 * follower state (S.followerSrc/followerM), and the on-screen matrix HUD.
 *
 * {@link formatHMatrix} is a pure formatter so the HUD markup is unit-testable.
 */

import { computeSampleMatrixExplicit, computeFollowerMatrix, segName, SRC } from './zoom-pipeline.js';
import { M } from './math.js';

const SRC_NAME = { [SRC.SEC1]: 'UW', [SRC.MAIN]: 'Main', [SRC.SEC2]: 'Tele' };

/**
 * Format a 3x3 row-major matrix as the HUD's box-drawing HTML.
 *
 * @param {number[]} H - 9-element row-major matrix
 * @param {string} [label] - highlighted header label (default 'H')
 * @returns {string} innerHTML for the #hmat element
 */
export function formatHMatrix(H, label) {
    const f = v => (v >= 0 ? ' ' : '') + v.toFixed(4);
    return `<span style="color:#e94560">${label || 'H'}</span>\n` +
        `\u250C ${f(H[0])}  ${f(H[1])}  ${f(H[2])} \u2510\n` +
        `\u2502 ${f(H[3])}  ${f(H[4])}  ${f(H[5])} \u2502\n` +
        `\u2514 ${f(H[6])}  ${f(H[7])}  ${f(H[8])} \u2518`;
}

/**
 * Create the sampling refresh function.
 *
 * @param {object} opts
 * @param {object} opts.S       - shared app state (reads zoom/warp/depthD/
 *        prewarpScale/prewarpScale2/camParams; writes sampleSrc/sampleM/
 *        followerSrc/followerM)
 * @param {object} opts.R       - live camera rig (R.sec2 presence check)
 * @param {object} opts.matWarp - warp material (uSrc/uHi uniforms)
 * @param {number} opts.rtW     - RT width (px)
 * @param {number} opts.rtH     - RT height (px)
 * @param {Function} opts.onHud - receives the HUD innerHTML string
 * @param {Function} [opts.getOverride] - trajectory hook: returns null (free
 *        mode — zoom rules apply) or `{leadSrc, followerSrc, label}` to force
 *        the lead/follower sources (Play mode: read from the trajectory frame)
 * @returns {Function} refreshH — call after any zoom / warp / camera change
 */
export function createSamplingRefresh({ S, R, matWarp, rtW, rtH, onHud, getOverride = () => null }) {
    return function refreshH() {
        if (!S.camParams) return;
        const ov = getOverride();
        // If sec2 isn't materialized as a Three.js camera, hide it from the
        // pipeline so segments C/D fall back to a plain main-camera crop.
        const params = R.sec2 ? S.camParams : { ...S.camParams, secondary_camera_2: undefined };
        const opts = {
            z: S.zoom, warp: S.warp, D: S.depthD, params,
            prewarp1: S.prewarpScale, prewarp2: S.prewarpScale2,
            w: rtW, h: rtH,
            ...(ov ? { leadSrc: ov.leadSrc, followerSrc: ov.followerSrc } : {}),
        };
        const { src, m: Msamp } = computeSampleMatrixExplicit(opts);

        matWarp.uniforms.uSrc.value = src;
        matWarp.uniforms.uHi.value.set(...Msamp);
        // Stash the sampling state for the per-frame blend controller
        S.sampleSrc = src;
        S.sampleM = Msamp;
        // Live follower state for dual-mode blends (recomputed on every zoom /
        // camera-param change so the previous layer tracks the leading view).
        const fol = computeFollowerMatrix(opts);
        S.followerSrc = fol.src;
        S.followerM = fol.m;

        /* HUD: show lead/follower camera names + the inter-camera homography
           (M_follower × M_lead⁻¹) — after prewarp, this should be ≈ pure translation. */
        const leadName = SRC_NAME[src] || '?';
        const folName = SRC_NAME[fol.src] || '?';
        const header = `Lead: ${leadName}  Follower: ${folName}  `
            + `D=${S.depthD.toFixed(1)} Z=${S.zoom.toFixed(2)} `
            + `${ov?.label ?? segName(S.zoom)}${S.warp ? '' : ' raw'}`;

        // H_relative = M_follower × inv(M_lead) — the residual homography
        // between the two views after each has been sampled/warped.
        const Minv = M.inv(Msamp);
        let hudStr = `<span style="color:#e94560">${header}</span>\n`;
        if (Minv && src !== fol.src) {
            const Hrel = M.mul(fol.m, Minv);
            // Normalize so H[8] = 1
            const s = Hrel[8];
            if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) Hrel[i] /= s;
            hudStr += formatHMatrix(Hrel, `H(${folName}←${leadName})`);
        } else {
            // Same camera or singular — show the sampling matrix directly
            const H_disp = Msamp.slice();
            const s = H_disp[8];
            if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) H_disp[i] /= s;
            hudStr += formatHMatrix(H_disp, `M_${leadName}`);
        }
        onHud(hudStr);
    };
}
