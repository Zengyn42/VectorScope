/**
 * @module math
 * @description
 * 3×3 Matrix library using row-major flat arrays (`float[9]`).
 *
 * All matrices are stored as 9-element arrays in row-major order:
 * ```
 * [a00, a01, a02,   ← row 0
 *  a10, a11, a12,   ← row 1
 *  a20, a21, a22]   ← row 2
 * ```
 *
 * This module is the foundation for all linear algebra in VectorScope.
 * It has **zero dependencies** — no THREE.js, no DOM, no Node APIs.
 * Used by `homography.js` for plane-induced homography computation,
 * and by `index.html` for zoom/prewarp matrix operations.
 *
 * @example
 * import { M } from './math.js';
 *
 * const A = M.K(1500, 1500, 960, 540);   // camera intrinsic matrix
 * const Ainv = M.inv(A);                  // inverse
 * const I = M.mul(A, Ainv);               // should ≈ identity
 * const px = M.v(A, [0, 0, 1]);           // project origin → [960, 540, 1]
 */
export const M = {
    /**
     * Returns a 3×3 identity matrix.
     * @returns {number[]} `[1,0,0, 0,1,0, 0,0,1]`
     */
    id: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],

    /**
     * Matrix multiply `A · B` (both 3×3, row-major).
     * @param {number[]} A - Left matrix (9 elements)
     * @param {number[]} B - Right matrix (9 elements)
     * @returns {number[]} Product matrix `C = A·B` (9 elements)
     */
    mul: (A, B) => {
        const C = [];
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                C[i * 3 + j] =
                    A[i * 3] * B[j] +
                    A[i * 3 + 1] * B[3 + j] +
                    A[i * 3 + 2] * B[6 + j];
        return C;
    },

    /**
     * Matrix inverse using cofactor expansion.
     * @param {number[]} m - 3×3 matrix (9 elements)
     * @returns {number[]|null} Inverse matrix, or `null` if singular (det < 1e-12)
     */
    inv: (m) => {
        const [a, b, c, d, e, f, g, h, i] = m;
        const D = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (Math.abs(D) < 1e-12) return null;
        const k = 1 / D;
        return [
            (e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k,
            (f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k,
            (d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k,
        ];
    },

    /**
     * Element-wise linear interpolation between two matrices.
     * @param {number[]} A - Start matrix
     * @param {number[]} B - End matrix
     * @param {number} t - Interpolation factor (0 = A, 1 = B)
     * @returns {number[]} Interpolated matrix
     */
    lerp: (A, B, t) => A.map((a, i) => a * (1 - t) + B[i] * t),

    /**
     * Matrix transpose.
     * @param {number[]} m - 3×3 matrix
     * @returns {number[]} Transposed matrix
     */
    T: (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]],

    /**
     * Matrix-vector multiply: `m · v` where `v` is a 3-element vector.
     * @param {number[]} m - 3×3 matrix
     * @param {number[]} v - 3-element vector
     * @returns {number[]} Result 3-element vector
     */
    v: (m, v) => [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ],

    /**
     * Outer product of two 3-vectors → 3×3 matrix: `a ⊗ b`.
     * @param {number[]} a - Column vector (3 elements)
     * @param {number[]} b - Row vector (3 elements)
     * @returns {number[]} 3×3 matrix where `M[i][j] = a[i] * b[j]`
     */
    out: (a, b) => [
        a[0] * b[0], a[0] * b[1], a[0] * b[2],
        a[1] * b[0], a[1] * b[1], a[1] * b[2],
        a[2] * b[0], a[2] * b[1], a[2] * b[2],
    ],

    /**
     * Element-wise matrix addition.
     * @param {number[]} A - First matrix
     * @param {number[]} B - Second matrix
     * @returns {number[]} Sum matrix `A + B`
     */
    add: (A, B) => A.map((a, i) => a + B[i]),

    /**
     * Scalar multiply: every element of `A` multiplied by `s`.
     * @param {number[]} A - Matrix
     * @param {number} s - Scalar
     * @returns {number[]} Scaled matrix `s·A`
     */
    sc: (A, s) => A.map((a) => a * s),

    /**
     * Build a 3×3 camera intrinsic matrix K from focal lengths and principal point.
     * ```
     * K = [fx,  0, cx,
     *       0, fy, cy,
     *       0,  0,  1]
     * ```
     * @param {number} fx - Horizontal focal length (pixels)
     * @param {number} fy - Vertical focal length (pixels)
     * @param {number} cx - Principal point x (pixels)
     * @param {number} cy - Principal point y (pixels)
     * @returns {number[]} 3×3 intrinsic matrix (row-major)
     */
    K: (fx, fy, cx, cy) => [fx, 0, cx, 0, fy, cy, 0, 0, 1],
};
