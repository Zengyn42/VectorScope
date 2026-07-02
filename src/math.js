/**
 * 3×3 Matrix library (row-major float[9])
 * Pure math — zero dependencies.
 */
export const M = {
    /** Identity matrix */
    id: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],

    /** Matrix multiply A·B */
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

    /** Matrix inverse (returns null if singular) */
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

    /** Element-wise linear interpolation */
    lerp: (A, B, t) => A.map((a, i) => a * (1 - t) + B[i] * t),

    /** Transpose */
    T: (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]],

    /** Matrix-vector multiply (3-vector) */
    v: (m, v) => [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ],

    /** Outer product of two 3-vectors → 3×3 matrix */
    out: (a, b) => [
        a[0] * b[0], a[0] * b[1], a[0] * b[2],
        a[1] * b[0], a[1] * b[1], a[1] * b[2],
        a[2] * b[0], a[2] * b[1], a[2] * b[2],
    ],

    /** Element-wise addition */
    add: (A, B) => A.map((a, i) => a + B[i]),

    /** Scalar multiply */
    sc: (A, s) => A.map((a) => a * s),

    /** Camera intrinsic matrix from (fx, fy, cx, cy) */
    K: (fx, fy, cx, cy) => [fx, 0, cx, 0, fy, cy, 0, 0, 1],
};
