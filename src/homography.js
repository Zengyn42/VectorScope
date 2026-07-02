/**
 * Homography computation.
 * Depends only on math.js (M object).
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
 * Convention: extrinsics are relative to main camera.
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
    const mc = p.main_camera, sc = p.secondary_camera;
    const K1 = M.K(mc.intrinsics.fx, mc.intrinsics.fy, mc.intrinsics.cx, mc.intrinsics.cy);
    const K2 = M.K(sc.intrinsics.fx, sc.intrinsics.fy, sc.intrinsics.cx, sc.intrinsics.cy);
    const K2i = M.inv(K2);
    const Flip = [1, 0, 0, 0, -1, 0, 0, 0, -1];

    // Convert both cameras' extrinsics to CV convention
    function toCV_R(euler_deg) {
        const R_threejs = eulerR(euler_deg);       // camera-to-parent rotation (Three.js)
        return M.mul(Flip, M.mul(R_threejs, Flip)); // rotation in CV convention
    }
    function toCV_pos(pos) {
        return [pos[0], -pos[1], -pos[2]];          // position in CV convention
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

    // Plane at depth D from cam1: n1=[0,0,1] in cam1 frame
    const n1 = [0, 0, 1];
    const n2 = M.v(M.T(R12), n1);                   // plane normal in cam2 frame
    const d2 = D - (n1[0] * t12[0] + n1[1] * t12[1] + n1[2] * t12[2]);

    // H = K1 · (R12 + t12·n2ᵀ/d2) · K2⁻¹
    const tn = M.out(t12, n2);
    const mid = M.add(R12, M.sc(tn, 1 / d2));
    const H = M.mul(K1, M.mul(mid, K2i));
    const s = H[8];
    if (Math.abs(s) > 1e-10) for (let i = 0; i < 9; i++) H[i] /= s;

    console.log('[VS] computeH: t12=', t12.map((v) => v.toFixed(4)),
        'd2=', d2.toFixed(4), 'H=', H.map((v) => v.toFixed(4)));
    return H;
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
