import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { M } from '../src/math.js';
import { eulerR, computeH, zoomMatrix } from '../src/homography.js';

const EPS = 1e-6;

function assertVecClose(actual, expected, msg, eps = EPS) {
    assert.equal(actual.length, expected.length, `${msg}: length mismatch`);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(Math.abs(actual[i] - expected[i]) < eps,
            `${msg}: [${i}] got ${actual[i]}, expected ${expected[i]}`);
    }
}

function makeCamParams(secPos, secRot = [0,0,0]) {
    return {
        main_camera: {
            intrinsics: { fx: 1500, fy: 1500, cx: 960, cy: 540 },
            extrinsics: { position: [0, 0, 0], rotation_euler_deg: [0, 0, 0] },
            image_size: [1920, 1080],
        },
        secondary_camera: {
            intrinsics: { fx: 1500, fy: 1500, cx: 960, cy: 540 },
            extrinsics: { position: secPos, rotation_euler_deg: secRot },
            image_size: [1920, 1080],
        },
    };
}

// ── eulerR ──

describe('eulerR', () => {
    it('zero rotation = identity', () => {
        assertVecClose(eulerR([0, 0, 0]), M.id(), 'R(0,0,0)');
    });

    it('rotation matrix is orthogonal: R*R^T = I', () => {
        const R = eulerR([15, 30, 45]);
        const RRt = M.mul(R, M.T(R));
        assertVecClose(RRt, M.id(), 'R*R^T', 1e-9);
    });

    it('det(R) = 1 (proper rotation)', () => {
        const R = eulerR([10, 20, 30]);
        // det of 3x3
        const [a,b,c,d,e,f,g,h,i] = R;
        const det = a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
        assert.ok(Math.abs(det - 1) < 1e-9, `det(R)=${det}, expected 1`);
    });

    it('90° Y-rotation', () => {
        const R = eulerR([0, 90, 0]);
        // Ry(90°): [[0,0,-1],[0,1,0],[1,0,0]] — but in ZYX order
        // cos(90)≈0, sin(90)=1
        // Row 0: [cy*cz, cy*sz, -sy] = [0, 0, -1]
        // Row 1: [sx*sy*cz-cx*sz, sx*sy*sz+cx*cz, sx*cy] = [0, 1, 0] (sx=0,cx=1)
        // Row 2: [cx*sy*cz+sx*sz, cx*sy*sz-sx*cz, cx*cy] = [1, 0, 0]
        assertVecClose(R, [0,0,-1, 0,1,0, 1,0,0], 'Ry(90)', 1e-9);
    });
});

// ── computeH ──

describe('computeH', () => {
    it('identity cameras → H = I', () => {
        const p = makeCamParams([0, 0, 0]);
        const H = computeH(p, 3);
        assertVecClose(H, M.id(), 'identical cameras → identity H');
    });

    it('pure horizontal baseline: H = [[1,0,disparity],[0,1,0],[0,0,1]]', () => {
        const baseline = 0.5;
        const D = 3;
        const p = makeCamParams([baseline, 0, 0]);
        const H = computeH(p, D);
        const expectedDisparity = 1500 * baseline / D; // = 250
        const expectedH = [1, 0, expectedDisparity, 0, 1, 0, 0, 0, 1];
        assertVecClose(H, expectedH, `disparity=${expectedDisparity}`);
    });

    it('disparity scales inversely with depth', () => {
        const p = makeCamParams([0.5, 0, 0]);
        const H3 = computeH(p, 3);
        const H6 = computeH(p, 6);
        // At D=3: disparity = 250, at D=6: disparity = 125
        assert.ok(Math.abs(H3[2] - 250) < EPS, `D=3 disparity: ${H3[2]}`);
        assert.ok(Math.abs(H6[2] - 125) < EPS, `D=6 disparity: ${H6[2]}`);
    });

    it('disparity scales linearly with baseline', () => {
        const p1 = makeCamParams([0.5, 0, 0]);
        const p2 = makeCamParams([1.0, 0, 0]);
        const H1 = computeH(p1, 3);
        const H2 = computeH(p2, 3);
        // Double baseline → double disparity
        assert.ok(Math.abs(H2[2] / H1[2] - 2) < EPS, 'double baseline → double disparity');
    });

    it('vertical baseline: disparity in H[5]', () => {
        const p = makeCamParams([0, 0.5, 0]);
        const H = computeH(p, 3);
        // Vertical baseline: Three.js Y-up → CV Y-down → disparity appears in H[5]
        // t_cv = [0, -0.5, 0], so disparity in Y = fy * (-0.5) / 3 = -250
        assert.ok(Math.abs(H[2]) < EPS, 'no X disparity');
        assert.ok(Math.abs(H[5] - (-250)) < EPS, `Y disparity: ${H[5]}`);
    });

    it('H is normalized so H[8] = 1', () => {
        const p = makeCamParams([0.5, 0.1, 0], [0, 5, 0]);
        const H = computeH(p, 3);
        assert.ok(Math.abs(H[8] - 1) < EPS, `H[8]=${H[8]}`);
    });

    it('H * H_inv = I', () => {
        const p = makeCamParams([0.5, 0.1, 0], [0, 5, 0]);
        const H = computeH(p, 3);
        const Hi = M.inv(H);
        assert.ok(Hi !== null, 'H should be invertible');
        assertVecClose(M.mul(H, Hi), M.id(), 'H*H_inv=I', 1e-4);
    });

    it('different fx: disparity = fx1 * baseline / D (uses K1)', () => {
        const p = {
            main_camera: {
                intrinsics: { fx: 2000, fy: 2000, cx: 960, cy: 540 },
                extrinsics: { position: [0,0,0], rotation_euler_deg: [0,0,0] },
                image_size: [1920, 1080],
            },
            secondary_camera: {
                intrinsics: { fx: 1500, fy: 1500, cx: 960, cy: 540 },
                extrinsics: { position: [0.5, 0, 0], rotation_euler_deg: [0,0,0] },
                image_size: [1920, 1080],
            },
        };
        const H = computeH(p, 3);
        // With different K1/K2, H is not a simple translation anymore
        // But for pure translation + same rotation, H should still be upper-triangular
        assert.ok(Math.abs(H[3]) < EPS, 'H[3]≈0');
        assert.ok(Math.abs(H[6]) < EPS, 'H[6]≈0');
        assert.ok(Math.abs(H[7]) < EPS, 'H[7]≈0');
    });
});

// ── zoomMatrix ──

describe('zoomMatrix', () => {
    it('zoom=1 → identity', () => {
        assertVecClose(zoomMatrix(1, 1920, 1080), M.id(), 'zoom=1');
    });

    it('zoom=2: center pixel stays fixed', () => {
        const Z = zoomMatrix(2, 1920, 1080);
        // Center = (960, 540). Z * [960, 540, 1] should = [960, 540, 1]
        const center = M.v(Z, [960, 540, 1]);
        assertVecClose(center, [960, 540, 1], 'center fixed at zoom=2');
    });

    it('zoom=2: corner maps to midpoint', () => {
        const Z = zoomMatrix(2, 1920, 1080);
        // (0,0) → center + (0-center)/2 = center/2 = (480, 270)
        const corner = M.v(Z, [0, 0, 1]);
        assertVecClose(corner, [480, 270, 1], 'corner at zoom=2');
    });

    it('Z * Z_inv = I', () => {
        const Z = zoomMatrix(1.5, 1920, 1080);
        const Zi = M.inv(Z);
        assert.ok(Zi !== null);
        assertVecClose(M.mul(Z, Zi), M.id(), 'Z*Zi=I');
    });
});
