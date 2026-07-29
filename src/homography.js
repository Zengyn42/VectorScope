/**
 * @module homography
 * @description
 * Plane-induced homography computation for stereo camera systems.
 *
 * This module implements the core math behind VectorScope's stereo visualization:
 * given two cameras and a fronto-parallel plane at depth D, it computes the 3×3
 * homography matrix H that maps pixels from camera 2 to camera 1.
 *
 * **Key formula:**
 * ```
 * H = K1 · (R12 + t12 · n2ᵀ / d2) · K2⁻¹
 * ```
 * where:
 * - `K1`, `K2` are camera intrinsic matrices
 * - `R12`, `t12` are the relative rotation and translation (cam2 → cam1)
 * - `n2` is the plane normal in cam2's frame
 * - `d2` is the signed distance from cam2 to the plane
 *
 * **Coordinate convention:**
 * Three.js uses Y-up, Z-toward-viewer. The homography formula uses the
 * standard computer vision convention (Y-down, Z-forward). A flip matrix
 * `diag(1, -1, -1)` converts between the two.
 *
 * Also provides a zoom matrix for pixel-space zoom/crop operations.
 *
 * @requires ./math.js
 *
 * @example
 * import { computeH, zoomMatrix } from './homography.js';
 * import { DEF_CAM } from './camera.js';
 *
 * const H = computeH(DEF_CAM, 3.0);  // homography at depth 3m
 * const Z = zoomMatrix(1.5, 1920, 1080);  // 1.5x zoom
 */
import { M } from './math.js';

/**
 * Euler angles (degrees) → 3×3 rotation matrix (row-major).
 * Rotation order: Ry · Rx · Rz (matching Three.js default YXZ).
 */
export function eulerR(deg) {
    const [rx, ry, rz] = deg.map((d) => (d * Math.PI) / 180);
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    return [
        cy * cz,           cy * sz,          -sy,
        sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy,
        cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy,
    ];
}

/**
 * Plane-induced homography: H maps cam2 pixel → cam1 pixel.
 *   H = K1 · (R12 + t12·n2ᵀ/d2) · K2⁻¹
 *
 * Full general formula — works for any R1, R2, t1, t2.
 * Convention: all camera extrinsics are relative to the rig frame.
 * Main camera extrinsics should be identity in normal use,
 * but the formula handles non-identity correctly.
 *
 * Coordinate conversion: Three.js (Y-up, Z-back) → CV (Y-down, Z-forward)
 * via Flip = diag(1,-1,-1).
 *
 * @param {object} p  Camera params (main_camera + secondary_camera)
 * @param {number} D  Plane depth from cam1
 * @returns {number[]} 3×3 homography matrix (row-major, normalized so H[8]=1)
 */
export function computeH(p, D) {
    return computeHPair(p.main_camera, p.secondary_camera, D);
}

/**
 * Generalized plane-induced homography between any two cameras of the rig.
 * Returns H mapping **cam2 pixel → cam1 pixel**.
 *
 * Both cameras' extrinsics are relative to the rig (main camera) frame.
 * The plane is fronto-parallel in the RIG frame at depth D
 * (i.e. defined w.r.t. the main camera, shared by all pairs).
 *
 * @param {object} mc  cam1 params ({ intrinsics, extrinsics })
 * @param {object} sc  cam2 params ({ intrinsics, extrinsics })
 * @param {number} D   Plane depth from the rig (main camera) frame
 * @returns {number[]} 3×3 homography (row-major, normalized so H[8]=1)
 */
export function computeHPair(mc, sc, D) {
    const K1 = M.K(mc.intrinsics.fx, mc.intrinsics.fy, mc.intrinsics.cx, mc.intrinsics.cy);
    const K2 = M.K(sc.intrinsics.fx, sc.intrinsics.fy, sc.intrinsics.cx, sc.intrinsics.cy);
    const K2i = M.inv(K2);
    const Flip = [1, 0, 0, 0, -1, 0, 0, 0, -1];

    // Convert both cameras' extrinsics to CV convention
    function toCV_R(euler_deg) {
        const R_threejs = eulerR(euler_deg);         // camera-to-parent rotation (Three.js)
        return M.mul(Flip, M.mul(R_threejs, Flip));  // rotation in CV convention
    }
    function toCV_pos(pos) {
        return [pos[0], -pos[1], -pos[2]];           // position in CV convention
    }

    // Camera 1 (main) — CV rotation and extrinsic translation
    const R1_cv = toCV_R(mc.extrinsics.rotation_euler_deg);
    const C1_cv = toCV_pos(mc.extrinsics.position);
    const t1 = M.v(R1_cv, C1_cv.map((v) => -v));   // t1 = R1·(-C1)

    // Camera 2 (secondary) — CV rotation and extrinsic translation
    const R2_cv = toCV_R(sc.extrinsics.rotation_euler_deg);
    const C2_cv = toCV_pos(sc.extrinsics.position);
    const t2 = M.v(R2_cv, C2_cv.map((v) => -v));   // t2 = R2·(-C2)

    // Relative pose: cam2 → cam1
    const R12 = M.mul(R1_cv, M.T(R2_cv));           // R12 = R1·R2ᵀ
    const t12 = [                                     // t12 = t1 - R12·t2
        t1[0] - (R12[0] * t2[0] + R12[1] * t2[1] + R12[2] * t2[2]),
        t1[1] - (R12[3] * t2[0] + R12[4] * t2[1] + R12[5] * t2[2]),
        t1[2] - (R12[6] * t2[0] + R12[7] * t2[1] + R12[8] * t2[2]),
    ];

    // Plane fronto-parallel in the RIG frame at depth D: n_r = [0,0,1].
    // Transform into cam1 frame: n1 = R1·n_r, d1 = D + n1ᵀt1
    // (reduces to n1=[0,0,1], d1=D when cam1 has identity extrinsics).
    const n1 = M.v(R1_cv, [0, 0, 1]);
    const d1 = D + (n1[0] * t1[0] + n1[1] * t1[1] + n1[2] * t1[2]);
    const n2 = M.v(M.T(R12), n1);                   // plane normal in cam2 frame
    const d2 = d1 - (n1[0] * t12[0] + n1[1] * t12[1] + n1[2] * t12[2]);

    // H = K1 · (R12 + t12·n2ᵀ/d2) · K2⁻¹
    const tn = M.out(t12, n2);
    const mid = M.add(R12, M.sc(tn, 1 / d2));
    const H = M.mul(K1, M.mul(mid, K2i));
    const s = H[8];
    if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) H[i] /= s;

    if (globalThis.VS_DEBUG_H) {
        console.log('[VS] computeH: t12=', t12.map((v) => v.toFixed(4)),
            'd2=', d2.toFixed(4), 'H=', H.map((v) => v.toFixed(4)));
    }
    return H;
}

/**
 * {@link computeHPair} expressed in **window pixel space**.
 *
 * `image_size` is the SENSOR extent; the displayed output is a 1:1,
 * center-anchored winW×winH window of the sensor — never a scale.
 * Landscape: the window map is a pure center-aligned translation.
 * Portrait: the sensor image is additionally rotated +90° CCW on screen
 * (phone rotated CCW; the display rotation keeps world content upright,
 * and the sensor-x baseline parallax appears VERTICAL on screen).
 *
 * The raw {@link computeHPair} H works in sensor px (K uses absolute
 * cx/cy). This wrapper conjugates it into window px:
 * ```
 * H_win = W(mc) · H · W(sc)⁻¹
 * ```
 * where `W(c)` maps c's sensor px → window px (translation, plus the 90°
 * rotation in portrait). In landscape with image_size == window, W = I
 * and this is exactly computeHPair. H_win depends on the optical center
 * only through its offset from the SENSOR center (cx − imgW/2) —
 * enlarging the sensor with a centered cx does not change the homography
 * (nor the display).
 *
 * @param {object} mc  cam1 params ({ intrinsics, extrinsics, image_size })
 * @param {object} sc  cam2 params ({ intrinsics, extrinsics, image_size })
 * @param {number} D   Plane depth from the rig (main camera) frame
 * @param {number} winW  window width (px) — the shared output/RT width
 * @param {number} winH  window height (px)
 * @returns {number[]} 3×3 homography (row-major, normalized so H[8]=1)
 *          mapping cam2 WINDOW px → cam1 WINDOW px
 */
export function computeHPairWin(mc, sc, D, winW, winH) {
    /* Sensor H is orientation-independent: since both cameras share the same
       rig rotation, R12 is the same regardless of rig pose. Only the
       sensor→window coordinate mapping (W matrix) differs per orientation.

       Landscape (winW ≥ winH): sensor pixel ↔ window pixel is a pure
       center-aligned translation.
         u_w = u_s + (winW − imgW) / 2
         v_w = v_s + (winH − imgH) / 2
       Portrait (winW < winH): the rig is rotated Rz(+90°) CCW so sensor x
       (width) maps to display vertical. The sensor→window mapping is:
         u_w = v_s + (winW − imgH) / 2
         v_w = −u_s + imgW/2 + winH/2
    */
    const H = computeHPair(mc, sc, D);
    const [iw1, ih1] = mc.image_size ?? [winW, winH];
    const [iw2, ih2] = sc.image_size ?? [winW, winH];
    const portrait = winW < winH;

    /* W(c): sensor px → window px (formulas in the block above).
       Landscape: pure center-aligned translation.
       Portrait: +90° CCW display rotation composed with the center
       alignment — the sensor image is rotated back so world content stays
       upright while the (sensor-x) baseline parallax becomes vertical on
       screen. W2i is the exact inverse of W(sc) (window → sensor px). */
    const W1 = portrait
        ? [0, 1, (winW - ih1) / 2,   -1, 0, (winH + iw1) / 2,   0, 0, 1]
        : [1, 0, (winW - iw1) / 2,    0, 1, (winH - ih1) / 2,   0, 0, 1];
    const W2i = portrait
        ? [0, -1, (winH + iw2) / 2,   1, 0, (ih2 - winW) / 2,   0, 0, 1]
        : [1, 0, (iw2 - winW) / 2,    0, 1, (ih2 - winH) / 2,   0, 0, 1];

    const Hw = M.mul(W1, M.mul(H, W2i));
    const s = Hw[8];
    if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) Hw[i] /= s;
    return Hw;
}

/**
 * Zoom matrix in pixel space: output pixel → zoomed pixel.
 *   px = center + (p - center) / zoom
 *   Z = [[1/z, 0, cx*(1-1/z)], [0, 1/z, cy*(1-1/z)], [0, 0, 1]]
 *
 * @param {number} zoom  Zoom factor
 * @param {number} w     Image width
 * @param {number} h     Image height
 * @returns {number[]} 3×3 zoom matrix (row-major)
 */
export function zoomMatrix(zoom, w, h) {
    const iz = 1 / zoom, cx = w / 2, cy = h / 2;
    return [iz, 0, cx * (1 - iz), 0, iz, cy * (1 - iz), 0, 0, 1];
}
