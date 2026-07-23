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

import { computeSampleMatrixExplicit, computeFollowerMatrix, followerSource, SRC } from './zoom-pipeline.js';
import { computeHPair } from './homography.js';
import { M } from './math.js';
import { camDisplayName } from './camera.js';
import { segmentLabel } from './segment-config.js';

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
export function createSamplingRefresh({ S, R, matWarp, rtW: rtWInit, rtH: rtHInit, onHud,
        getOverride = () => null, getSegCfg = () => null, getWarpCurve = () => null,
        getRTSize = null }) {
    let _rtW = rtWInit, _rtH = rtHInit;
    return function refreshH() {
        if (!S.camParams) return;
        if (getRTSize) { const sz = getRTSize(); _rtW = sz[0]; _rtH = sz[1]; }
        const ov = getOverride();
        // If sec2 isn't materialized as a Three.js camera, hide it from the
        // pipeline so segments C/D fall back to a plain main-camera crop.
        const params = R.sec2 ? S.camParams : { ...S.camParams, secondary_camera_2: undefined };
        // In free mode, derive leadSrc/followerSrc from segment config so
        // custom segment assignments take effect. In play mode, trajectory
        // overrides everything.
        const segCfg = getSegCfg();
        const hasS2 = !!params.secondary_camera_2;
        let explicitSrcs = {};
        // Effective warp = global master switch AND per-segment flag.
        // Global warp OFF → no warp anywhere. Global ON → each segment's own flag.
        let effectiveWarp = S.warp;
        if (ov) {
            explicitSrcs = { leadSrc: ov.leadSrc, followerSrc: ov.followerSrc };
        } else if (segCfg) {
            explicitSrcs = {
                leadSrc: segCfg.getLeadSource(S.zoom, hasS2),
                followerSrc: segCfg.getFollowerSource(S.zoom, hasS2),
            };
            if (S.warp) effectiveWarp = segCfg.getSegmentWarp(S.zoom);
        }
        const segRange = segCfg ? segCfg.getSegmentRange(S.zoom) : null;
        const opts = {
            z: S.zoom, warp: effectiveWarp, D: S.depthD, params,
            prewarp1: S.prewarpScale, prewarp2: S.prewarpScale2,
            w: _rtW, h: _rtH, warpCurve: getWarpCurve(), segRange,
            ...explicitSrcs,
        };
        const { src, m: Msamp } = computeSampleMatrixExplicit(opts);

        matWarp.uniforms.uSrc.value = src;
        matWarp.uniforms.uHi.value.set(...Msamp);
        // Stash the sampling state for the per-frame blend controller
        S.sampleSrc = src;
        S.sampleM = Msamp;
        // Live follower state for dual-mode blends.
        // The follower matrix must be H(fol←lead, D) × M_lead_actual, where
        // M_lead_actual is the SAME lead matrix the shader uses (Msamp).
        // We compute it directly here instead of calling computeFollowerMatrix
        // (which would re-derive the lead with potentially different warp flags).
        const paramKeyOf = (s) => s === SRC.SEC1 ? 'secondary_camera'
                                : s === SRC.SEC2 ? 'secondary_camera_2' : 'main_camera';
        const camOf = (s) => params[paramKeyOf(s)];
        const folSrc = opts.followerSrc ?? followerSource(S.zoom, hasS2);
        if (S.warp && folSrc !== src && params[paramKeyOf(folSrc)]) {
            const Hlf = computeHPair(camOf(folSrc), camOf(src), S.depthD);
            S.followerSrc = folSrc;
            S.followerM = M.mul(Hlf, Msamp);
        } else {
            // Warp OFF or degenerate: use computeFollowerMatrix with matching warp
            const fol = computeFollowerMatrix({ ...opts, warp: effectiveWarp });
            S.followerSrc = fol.src;
            S.followerM = fol.m;
        }

        /* Live sampling matrix for EVERY available camera at the current
           zoom (output px → that camera's RT px). Used by single-mode
           blends: the outgoing camera's RT pixels stay frozen, but its
           sampling matrix is looked up here each frame, so the frozen
           frame keeps scaling/warping with the zoom during the cross-fade
           (mirrors the dual-mode follower matrix, minus the re-render). */
        S.liveM = {};
        for (const s of [SRC.MAIN, SRC.SEC1, SRC.SEC2]) {
            if (!params[paramKeyOf(s)]) continue;
            if (s === src) { S.liveM[s] = Msamp; continue; }
            if (S.warp) {
                const Hs = computeHPair(camOf(s), camOf(src), S.depthD);
                S.liveM[s] = M.mul(Hs, Msamp);
            } else {
                S.liveM[s] = computeFollowerMatrix(
                    { ...opts, warp: effectiveWarp, followerSrc: s }).m;
            }
        }

        /* HUD: show lead/follower names + their homographies (geometric
           correction component only — prewarp crop factored out).
           H = M_current × inv(M_prewarp_only)
           In warp-off mode: M_current = M_prewarp_only → H = Identity.
           In warp-on mode: H shows the pure geometric correction. */
        const leadName = camDisplayName(src);
        const folName = camDisplayName(S.followerSrc);
        const header = `Lead: ${leadName}  Fol: ${folName}  `
            + `D=${S.depthD.toFixed(1)} Z=${S.zoom.toFixed(2)} `
            + `${ov?.label ?? segmentLabel(S.zoom, getSegCfg()).text}${effectiveWarp ? '' : ' raw'}`;

        // Compute the prewarp-only base (warp=false) for both cameras
        const baseOpts = { ...opts, warp: false };
        const leadBase = computeSampleMatrixExplicit(baseOpts);
        const folBase = computeFollowerMatrix(baseOpts);

        function extractH(M_current, M_base) {
            const inv = M.inv(M_base);
            if (!inv) return M.id();
            const H = M.mul(M_current, inv);
            const s = H[8];
            if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) H[i] /= s;
            return H;
        }

        const H_lead = extractH(Msamp, leadBase.m);
        const H_fol = extractH(S.followerM, folBase.m);

        let hudStr = `<span style="color:#e94560">${header}</span>\n`;
        hudStr += formatHMatrix(H_lead, `H_${leadName}`) + '\n';
        hudStr += formatHMatrix(H_fol, `H_${folName}`);
        onHud(hudStr);
    };
}
