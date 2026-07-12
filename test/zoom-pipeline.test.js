import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { M } from '../src/math.js';
import { computeHPair, zoomMatrix } from '../src/homography.js';
import {
    SRC, normLerp, segName, zoomSource, followerSource,
    computeSampleMatrix, computeFollowerMatrix, easeInOutQuad,
} from '../src/zoom-pipeline.js';

const EPS = 1e-6;
const W = 1080, H = 1920;
const D = 3;

function assertVecClose(actual, expected, msg, eps = EPS) {
    assert.equal(actual.length, expected.length, `${msg}: length mismatch`);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(Math.abs(actual[i] - expected[i]) < eps,
            `${msg}: [${i}] got ${actual[i]}, expected ${expected[i]}`);
    }
}

/** Rig matching the app defaults: main fx=1500, sec1 fx=750, sec2 fx=7500. */
function makeRig({ withS2 = true } = {}) {
    const cam = (fx, pos) => ({
        intrinsics: { fx, fy: fx, cx: 540, cy: 960 },
        extrinsics: { position: pos, rotation_euler_deg: [0, 0, 0] },
        image_size: [W, H],
    });
    const p = {
        main_camera: cam(1500, [0, 0, 0]),
        secondary_camera: cam(750, [0.5, 0, 0]),
    };
    if (withS2) p.secondary_camera_2 = cam(7500, [-0.5, 0, 0]);
    return p;
}

function sample(z, over = {}) {
    return computeSampleMatrix({
        z, warp: true, D, params: makeRig(), prewarp1: 1, prewarp2: 1, w: W, h: H,
        ...over,
    });
}

/** Normalize a homography to h33 = 1 (for scale-invariant comparison). */
const norm = A => A.map(v => v / A[8]);

// ── normLerp ──

describe('normLerp', () => {
    const A = [2, 0, 0, 0, 2, 0, 0, 0, 2];              // = I after normalization
    const B = [1, 0, 100, 0, 1, 50, 0, 0, 1];

    it('t=0 returns A (normalized)', () => {
        assertVecClose(normLerp(A, B, 0), M.id(), 'normLerp t=0');
    });

    it('t=1 returns B (normalized)', () => {
        assertVecClose(normLerp(A, B, 1), B, 'normLerp t=1');
    });

    it('is invariant to projective scale of the inputs', () => {
        const A5 = A.map(v => v * 5), B3 = B.map(v => v * -3);
        assertVecClose(normLerp(A5, B3, 0.37), normLerp(A, B, 0.37), 'scale invariance');
    });

    it('output has h33 = 1', () => {
        assert.ok(Math.abs(normLerp(A, B, 0.5)[8] - 1) < EPS, 'h33 normalized');
    });
});

// ── segName / zoomSource ──

describe('segName', () => {
    it('maps zoom to segment labels with half-open boundaries', () => {
        assert.equal(segName(0.5), 'S1\u2192M');
        assert.equal(segName(0.99), 'S1\u2192M');
        assert.equal(segName(1.0), 'M');          // boundary → next camera
        assert.equal(segName(2.0), 'M');
        assert.equal(segName(2.01), 'M\u2192S2');
        assert.equal(segName(4.99), 'M\u2192S2');
        assert.equal(segName(5.0), 'S2');          // boundary → next camera
        assert.equal(segName(10), 'S2');
    });
});

describe('zoomSource', () => {
    it('selects source camera per half-open segment intervals', () => {
        assert.equal(zoomSource(0.5, true), SRC.SEC1);
        assert.equal(zoomSource(0.999, true), SRC.SEC1);
        assert.equal(zoomSource(1.0, true), SRC.MAIN);
        assert.equal(zoomSource(4.999, true), SRC.MAIN);
        assert.equal(zoomSource(5.0, true), SRC.SEC2);
        assert.equal(zoomSource(10, true), SRC.SEC2);
    });

    it('falls back to main when sec2 is missing', () => {
        assert.equal(zoomSource(5.0, false), SRC.MAIN);
        assert.equal(zoomSource(10, false), SRC.MAIN);
    });
});

// ── computeSampleMatrix: segment endpoints ──

describe('computeSampleMatrix — segment A (warp ON)', () => {
    it('z=0.5 → identity sampling of sec1 (full frame)', () => {
        const { src, m } = sample(0.5);
        assert.equal(src, SRC.SEC1);
        assertVecClose(norm(m), M.id(), 'A @0.5x');
    });

    it('z→1⁻ → exactly H(main px → sec1 px)', () => {
        const p = makeRig();
        const Hm2s1 = computeHPair(p.secondary_camera, p.main_camera, D);
        const { m } = sample(1 - 1e-12);
        assertVecClose(norm(m), norm(Hm2s1), 'A @1x⁻', 1e-4);
    });

    it('t runs in log space: z=sqrt(0.5) → t=0.5', () => {
        const p = makeRig();
        const Hm2s1 = computeHPair(p.secondary_camera, p.main_camera, D);
        const { m } = sample(Math.sqrt(0.5));
        assertVecClose(norm(m), normLerp(M.id(), Hm2s1, 0.5), 'A midpoint');
    });
});

describe('computeSampleMatrix — segment B', () => {
    it('z=1.0 → identity crop of main (boundary belongs to main)', () => {
        const { src, m } = sample(1.0);
        assert.equal(src, SRC.MAIN);
        assertVecClose(norm(m), M.id(), 'B @1x');
    });

    it('z=1.5 → plain crop(1.5), warp state irrelevant', () => {
        const on = sample(1.5, { warp: true });
        const off = sample(1.5, { warp: false });
        assertVecClose(on.m, zoomMatrix(1.5, W, H), 'B crop');
        assertVecClose(on.m, off.m, 'B warp-independent');
    });
});

describe('computeSampleMatrix — segment C (warp ON)', () => {
    it('continuous at z=2: C start equals B end (crop(2))', () => {
        const b = sample(2.0);
        const c = sample(2 + 1e-12);
        assert.equal(b.src, SRC.MAIN);
        assert.equal(c.src, SRC.MAIN);
        assertVecClose(norm(c.m), norm(b.m), 'B/C boundary', 1e-4);
    });

    it('z→5⁻ → exactly H(sec2-view px → main px)', () => {
        const p = makeRig();
        const Hs2m = computeHPair(p.main_camera, p.secondary_camera_2, D);
        const { m } = sample(5 - 1e-12);
        assertVecClose(norm(m), norm(Hs2m), 'C @5x⁻', 1e-4);
    });
});

describe('computeSampleMatrix — segment D', () => {
    it('z=5.0 → identity sampling of sec2 (boundary belongs to sec2)', () => {
        const { src, m } = sample(5.0);
        assert.equal(src, SRC.SEC2);
        assertVecClose(norm(m), M.id(), 'D @5x');
    });

    it('z=10 → crop(2) on sec2', () => {
        const { src, m } = sample(10);
        assert.equal(src, SRC.SEC2);
        assertVecClose(m, zoomMatrix(2, W, H), 'D @10x');
    });
});

// ── computeSampleMatrix: warp OFF + prewarps ──

describe('computeSampleMatrix — warp OFF', () => {
    it('segment A: prewarp1 · crop(z/0.5) on sec1', () => {
        const { src, m } = sample(0.7, { warp: false, prewarp1: 1.3 });
        assert.equal(src, SRC.SEC1);
        // UW nominal = 0.5x, so crop relative to its FOV = z/0.5
        assertVecClose(m, M.mul(zoomMatrix(1.3, W, H), zoomMatrix(0.7 / 0.5, W, H)), 'A raw');
    });

    it('segment C: prewarp2 · crop(z) on main', () => {
        const { src, m } = sample(3, { warp: false, prewarp2: 0.8 });
        assert.equal(src, SRC.MAIN);
        assertVecClose(m, M.mul(zoomMatrix(0.8, W, H), zoomMatrix(3, W, H)), 'C raw');
    });

    it('segment B ignores both prewarps', () => {
        const { m } = sample(1.5, { warp: false, prewarp1: 2, prewarp2: 2 });
        assertVecClose(m, zoomMatrix(1.5, W, H), 'B ignores prewarp');
    });
});

// ── computeSampleMatrix: missing sec2 fallback ──

describe('computeSampleMatrix — no sec2', () => {
    it('segments C/D fall back to plain main crop', () => {
        for (const z of [3, 5, 10]) {
            const { src, m } = sample(z, { params: makeRig({ withS2: false }) });
            assert.equal(src, SRC.MAIN, `src @${z}x`);
            assertVecClose(m, zoomMatrix(z, W, H), `fallback crop @${z}x`);
        }
    });
});

// ── followerSource (docs/CAMERAS.md leading/follower table) ──

describe('followerSource', () => {
    it('matches the leading/follower table (half-open from above)', () => {
        assert.equal(followerSource(0.5, true), SRC.MAIN);    // leading UW
        assert.equal(followerSource(0.999, true), SRC.MAIN);
        assert.equal(followerSource(1.0, true), SRC.SEC1);    // leading main
        assert.equal(followerSource(1.999, true), SRC.SEC1);
        assert.equal(followerSource(2.0, true), SRC.SEC2);    // 2.0x exact → Tele
        assert.equal(followerSource(4.999, true), SRC.SEC2);
        assert.equal(followerSource(5.0, true), SRC.MAIN);    // leading Tele
        assert.equal(followerSource(10, true), SRC.MAIN);
    });

    it('follower is never the leading source', () => {
        for (const z of [0.5, 0.9, 1.0, 1.5, 2.0, 3, 4.9, 5.0, 10]) {
            assert.notEqual(followerSource(z, true), zoomSource(z, true), `z=${z}`);
        }
    });

    it('without sec2 stays SEC1 for z ≥ 1 (only boundary is 1.0x)', () => {
        assert.equal(followerSource(0.7, false), SRC.MAIN);
        for (const z of [1.0, 1.5, 2.0, 3, 5, 10]) {
            assert.equal(followerSource(z, false), SRC.SEC1, `z=${z}`);
        }
    });
});

// ── computeFollowerMatrix (dual-mode blend layer) ──

function follower(z, over = {}) {
    return computeFollowerMatrix({
        z, warp: true, D, params: makeRig(), prewarp1: 1, prewarp2: 1, w: W, h: H,
        ...over,
    });
}

describe('computeFollowerMatrix', () => {
    it('is H(follower←leading, D) ∘ M_leading', () => {
        const p = makeRig();
        const z = 1.5;                                     // leading main, follower UW
        const lead = sample(z);
        const Hlf = computeHPair(p.secondary_camera, p.main_camera, D);
        const { src, m } = follower(z);
        assert.equal(src, SRC.SEC1);
        assertVecClose(norm(m), norm(M.mul(Hlf, lead.m)), 'composition');
    });

    it('boundary 1.0x: M_follower(1⁻) ≈ M_leading(1⁺) = I on main', () => {
        const f = follower(1 - 1e-9);
        assert.equal(f.src, SRC.MAIN);
        assertVecClose(norm(f.m), M.id(), 'follower @1x⁻ ≈ I', 1e-4);
    });

    it('boundary 1.0x: M_follower(1⁺) ≈ M_leading(1⁻) on UW', () => {
        const f = follower(1.0);                           // leading main, follower UW
        const leadBelow = sample(1 - 1e-9);                // leading UW just below 1x
        assert.equal(f.src, SRC.SEC1);
        assert.equal(leadBelow.src, SRC.SEC1);
        assertVecClose(norm(f.m), norm(leadBelow.m), 'follower @1x⁺ ≈ leading @1x⁻', 1e-4);
    });

    it('boundary 5.0x: M_follower(5⁻) ≈ M_leading(5⁺) = I on Tele', () => {
        const f = follower(5 - 1e-9);
        assert.equal(f.src, SRC.SEC2);
        assertVecClose(norm(f.m), M.id(), 'follower @5x⁻ ≈ I', 1e-4);
    });

    it('boundary 5.0x: M_follower(5⁺) ≈ M_leading(5⁻) on main', () => {
        const f = follower(5.0);                           // leading Tele, follower main
        const leadBelow = sample(5 - 1e-9);                // leading main just below 5x
        assert.equal(f.src, SRC.MAIN);
        assert.equal(leadBelow.src, SRC.MAIN);
        assertVecClose(norm(f.m), norm(leadBelow.m), 'follower @5x⁺ ≈ leading @5x⁻', 1e-4);
    });

    it('no sec2: works for z ≥ 1 with follower = UW', () => {
        const { src, m } = follower(3, { params: makeRig({ withS2: false }) });
        assert.equal(src, SRC.SEC1);
        assert.equal(m.length, 9);
        assert.ok(m.every(Number.isFinite), 'finite matrix');
    });
});

// ── easeInOutQuad ──

describe('easeInOutQuad', () => {
    it('fixes endpoints and midpoint', () => {
        assert.equal(easeInOutQuad(0), 0);
        assert.equal(easeInOutQuad(1), 1);
        assert.equal(easeInOutQuad(0.5), 0.5);
    });

    it('is monotonically increasing on [0,1]', () => {
        let prev = -1;
        for (let t = 0; t <= 1.0001; t += 0.01) {
            const v = easeInOutQuad(t);
            assert.ok(v >= prev, `monotone at t=${t}`);
            prev = v;
        }
    });
});
